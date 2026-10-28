// Этап 83: чтение тела запроса с пакетом рынка. Пакет принимается и обычным JSON, и сжатым gzip: сжатие
// распознаётся по заголовку Content-Encoding и по сигнатуре в начале тела. Распаковка идёт потоком, пределов
// два: на то, что пришло по сети, и на распакованный пакет, чтобы сжатая бомба не съела память.
// Данные выдуманные: настоящие цифры рынка в репозитории не лежат
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isUploadFail, looksGzip, readUploadBody, saysGzip } from "@/lib/market/upload-body";

const PLAIN = JSON.stringify({ kind: "weekly-market-bundle", version: 1, datasets: { k_demo: { rows: [{ год: 2026, премия: 123 }] } } });
const LIMITS = { wire: 1024 * 1024, plain: 4 * 1024 * 1024 };

function ask(body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/market/upload", { method: "POST", headers, body, duplex: "half" } as RequestInit);
}

/** Тело кусками: проверяем, что распознавание и распаковка не зависят от нарезки */
function chunked(bytes: Uint8Array, size: number) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.subarray(at, Math.min(at + size, bytes.length)));
      controller.close();
    },
  });
}

describe("распознавание сжатия", () => {
  it("заголовок и сигнатура", () => {
    expect(saysGzip("gzip")).toBe(true);
    expect(saysGzip("GZIP, identity")).toBe(true);
    expect(saysGzip("br")).toBe(false);
    expect(saysGzip(null)).toBe(false);
    expect(looksGzip(new Uint8Array([0x1f, 0x8b, 0x08]))).toBe(true);
    expect(looksGzip(new Uint8Array([0x7b, 0x22]))).toBe(false);
    expect(looksGzip(new Uint8Array([0x1f]))).toBe(false);
  });
});

describe("чтение тела пакета", () => {
  it("обычный JSON читается как раньше", async () => {
    const r = await readUploadBody(ask(PLAIN), LIMITS);
    expect(isUploadFail(r)).toBe(false);
    if (isUploadFail(r)) return;
    expect(r.gzip).toBe(false);
    expect(r.text).toBe(PLAIN);
    expect(r.bytes).toBe(Buffer.byteLength(PLAIN));
  });

  it("сжатый файл распознаётся по сигнатуре без заголовка и распаковывается", async () => {
    const packed = gzipSync(Buffer.from(PLAIN, "utf8"));
    const r = await readUploadBody(ask(chunked(new Uint8Array(packed), 7)), LIMITS);
    expect(isUploadFail(r)).toBe(false);
    if (isUploadFail(r)) return;
    expect(r.gzip).toBe(true);
    expect(r.text).toBe(PLAIN);
    expect(r.bytes).toBe(Buffer.byteLength(PLAIN));
    expect(r.wireBytes).toBe(packed.byteLength);
  });

  it("большой однообразный пакет в gzip весит сильно меньше и читается целиком", async () => {
    const long = JSON.stringify({ kind: "weekly-market-bundle", version: 1, datasets: { k_demo: { rows: Array.from({ length: 5000 }, (_, i) => ({ год: 2026, строка: i, премия: 1000 })) } } });
    const packed = gzipSync(Buffer.from(long, "utf8"));
    const r = await readUploadBody(ask(chunked(new Uint8Array(packed), 8192)), { wire: 1024 * 1024, plain: 4 * 1024 * 1024 });
    expect(isUploadFail(r)).toBe(false);
    if (isUploadFail(r)) return;
    expect(r.text).toBe(long);
    expect(r.wireBytes * 5).toBeLessThan(r.bytes);
  });

  it("сжатый файл с заголовком Content-Encoding: gzip", async () => {
    const packed = gzipSync(Buffer.from(PLAIN, "utf8"));
    const r = await readUploadBody(ask(new Uint8Array(packed), { "content-encoding": "gzip" }), LIMITS);
    expect(isUploadFail(r)).toBe(false);
    if (isUploadFail(r)) return;
    expect(r.text).toBe(PLAIN);
  });

  it("обрезанный сжатый файл: отказ, а не половина пакета", async () => {
    const packed = gzipSync(Buffer.from(PLAIN, "utf8"));
    const cut = new Uint8Array(packed.subarray(0, Math.floor(packed.byteLength / 2)));
    expect(await readUploadBody(ask(cut), LIMITS)).toEqual({ fail: "bad-gzip" });
  });

  it("не сжатый файл с заголовком gzip: отказ по распаковке", async () => {
    expect(await readUploadBody(ask(PLAIN, { "content-encoding": "gzip" }), LIMITS)).toEqual({ fail: "bad-gzip" });
  });

  it("пустое тело: пустой текст, без отказа", async () => {
    const r = await readUploadBody(ask(new Uint8Array(0)), LIMITS);
    expect(r).toEqual({ text: "", bytes: 0, wireBytes: 0, gzip: false });
  });

  it("обычный файл больше предела: чтение обрывается", async () => {
    const big = new Uint8Array(300_000).fill(32);
    expect(await readUploadBody(ask(chunked(big, 50_000)), { wire: 100_000, plain: 100_000 })).toEqual({ fail: "too-big" });
  });

  it("сжатый файл больше предела на файл: отказ по размеру файла", async () => {
    const packed = gzipSync(Buffer.alloc(2_000_000, 0x61));
    expect(await readUploadBody(ask(new Uint8Array(packed)), { wire: 500, plain: 100 * 1024 * 1024 })).toEqual({ fail: "too-big" });
  });

  it("сжатая бомба: распакованное больше предела, в память всё не читается", async () => {
    // Сто мегабайт нулей сжимаются в сотню килобайт: по сети предел проходит, по распакованному нет
    const bomb = gzipSync(Buffer.alloc(100 * 1024 * 1024, 0));
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    expect(await readUploadBody(ask(new Uint8Array(bomb)), { wire: 25 * 1024 * 1024, plain: 4 * 1024 * 1024 })).toEqual({ fail: "too-big-plain" });
  });
});
