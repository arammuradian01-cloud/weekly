// Чтение тела запроса с пакетом рынка (этап 83). Пакет можно отправлять как обычный JSON и как сжатый gzip:
// несжатый пакет весит около 16 МБ и прокси хостинга отказывает ему по размеру, в gzip он весит около 1,6 МБ.
// Сжатие распознаётся по заголовку Content-Encoding: gzip или по сигнатуре gzip в начале тела (0x1f 0x8b).
// Читается и распаковывается потоком, с двумя пределами: на сам файл и отдельно на распакованный размер,
// чтобы сжатая бомба не съела память. Содержимое в лог не пишется: в нём цифры рынка.

/** Сигнатура файла gzip: первые два байта */
const GZIP_MAGIC = [0x1f, 0x8b];

export type UploadBody = {
  /** Текст пакета */
  text: string;
  /** Размер пакета в байтах после распаковки: он и записывается как размер пакета */
  bytes: number;
  /** Сколько байт пришло по сети */
  wireBytes: number;
  /** Пакет пришёл сжатым */
  gzip: boolean;
};

/** Почему тело не прочиталось: файл больше предела, распакованный пакет больше предела, файл не распаковывается */
export type UploadBodyFail = { fail: "too-big" } | { fail: "too-big-plain" } | { fail: "bad-gzip" };

export type UploadBodyResult = UploadBody | UploadBodyFail;

export const isUploadFail = (r: UploadBodyResult): r is UploadBodyFail => "fail" in r;

/** Заголовок говорит, что тело сжато gzip */
export const saysGzip = (contentEncoding: string | null | undefined): boolean =>
  (contentEncoding ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .includes("gzip");

/** Начало тела похоже на файл gzip */
export const looksGzip = (head: Uint8Array): boolean => head.length >= 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];

type Limits = {
  /** Предел на то, что пришло по сети */
  wire: number;
  /** Предел на распакованный пакет */
  plain: number;
};

/**
 * Тело запроса с пакетом: обычный JSON или gzip. Чтение обрывается, как только любой из пределов превышен,
 * поэтому в память не попадает ни большой файл, ни то, что из него распаковалось
 */
export async function readUploadBody(request: Request, limits: Limits): Promise<UploadBodyResult> {
  const reader = request.body?.getReader();
  if (!reader) return { text: "", bytes: 0, wireBytes: 0, gzip: false };
  const forced = saysGzip(request.headers.get("content-encoding"));

  // Первый кусок: по нему видно, сжат ли пакет
  let head: Uint8Array | null = null;
  let wireBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    wireBytes += value.byteLength;
    if (wireBytes > limits.wire) return stop(reader, { fail: "too-big" });
    if (value.byteLength) {
      head = value;
      break;
    }
  }
  if (!head) return { text: "", bytes: 0, wireBytes: 0, gzip: false };
  const gzip = forced || looksGzip(head);

  if (!gzip) {
    const chunks: Uint8Array[] = [head];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      wireBytes += value.byteLength;
      if (wireBytes > limits.wire || wireBytes > limits.plain) return stop(reader, { fail: "too-big" });
      chunks.push(value);
    }
    return { text: decode(join(chunks, wireBytes)), bytes: wireBytes, wireBytes, gzip: false };
  }

  return unpack(reader, head, wireBytes, limits);
}

/** Распаковка потока gzip с пределами на сжатый и на распакованный размер */
async function unpack(reader: ReadableStreamDefaultReader<Uint8Array>, head: Uint8Array, already: number, limits: Limits): Promise<UploadBodyResult> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  const out = stream.readable.getReader();
  let wireBytes = already;
  let plainBytes = 0;
  let overWire = false;
  let overPlain = false;

  // Типы веб-потоков требуют буфер поверх ArrayBuffer, куски тела приходят с общим типом буфера
  const put = (chunk: Uint8Array) => writer.write(chunk as unknown as BufferSource);
  // Подача идёт отдельной задачей: иначе запись ждала бы чтения, а чтение подачи
  const feed = (async () => {
    try {
      await put(head);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        wireBytes += value.byteLength;
        if (wireBytes > limits.wire) {
          overWire = true;
          break;
        }
        await put(value);
      }
      if (overWire) await writer.abort(new Error("предел размера"));
      else await writer.close();
    } catch {
      // Чтение распакованного оборвалось или файл битый: подача больше не нужна
      await writer.abort(new Error("подача остановлена")).catch(() => undefined);
    }
  })();

  const chunks: Uint8Array[] = [];
  let bad = false;
  try {
    for (;;) {
      const { done, value } = await out.read();
      if (done) break;
      plainBytes += value.byteLength;
      if (plainBytes > limits.plain) {
        overPlain = true;
        break;
      }
      chunks.push(value);
    }
  } catch {
    bad = true;
  }
  if (overPlain || overWire) await out.cancel().catch(() => undefined);
  await reader.cancel().catch(() => undefined);
  await feed;

  if (overWire) return { fail: "too-big" };
  if (overPlain) return { fail: "too-big-plain" };
  if (bad) return { fail: "bad-gzip" };
  return { text: decode(join(chunks, plainBytes)), bytes: plainBytes, wireBytes, gzip: true };
}

async function stop(reader: ReadableStreamDefaultReader<Uint8Array>, result: UploadBodyFail): Promise<UploadBodyFail> {
  await reader.cancel().catch(() => undefined);
  return result;
}

function join(chunks: Uint8Array[], total: number): Uint8Array {
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return all;
}

const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);
