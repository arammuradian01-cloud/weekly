// Безопасная подготовка .xlsx борда до чтения таблицей (этап 31). Без базы.
//
// Библиотека чтения разбирает все листы файла целиком, поэтому до неё файл перекладывается: листы, которые не
// нужны (зарплаты, мотивация, сырые данные), заменяются пустыми и в память не попадают совсем. Каждая часть архива
// распаковывается с ограничением: архив, который при распаковке раздувается, отклоняется по ходу, а не после.
// Объединение огромного диапазона ячеек на листе целей тоже отклоняется: библиотека создала бы каждую ячейку.

import JSZip from "jszip";

/** Одна часть архива после распаковки не больше этого */
const PART_MAX = 20 * 1024 * 1024;
/** Все оставленные части вместе не больше этого */
const TOTAL_MAX = 60 * 1024 * 1024;
/** Все объединения листа целей вместе не больше этого числа ячеек */
const MERGE_MAX = 100_000;

const EMPTY_SHEET = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>';
const EMPTY_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

export class XlsxError extends Error {}

type Chunks = { on(event: "data", fn: (chunk: Uint8Array) => void): Chunks; on(event: "end", fn: () => void): Chunks; on(event: "error", fn: (e: Error) => void): Chunks; resume(): Chunks; pause(): Chunks };

/** Распаковать часть архива, но не больше max: дальше распаковка останавливается */
function readLimited(file: JSZip.JSZipObject, max: number, what: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let done = false;
    const stream = (file as unknown as { internalStream(type: "uint8array"): Chunks }).internalStream("uint8array");
    stream
      .on("data", (chunk) => {
        if (done) return;
        size += chunk.length;
        if (size > max) {
          done = true;
          stream.pause();
          reject(new XlsxError(`${what} слишком большая после распаковки: удалите из копии борда лишние вкладки и скачайте снова`));
          return;
        }
        chunks.push(chunk);
      })
      .on("error", (e) => {
        if (done) return;
        done = true;
        reject(e);
      })
      .on("end", () => {
        if (done) return;
        done = true;
        const out = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          out.set(c, at);
          at += c.length;
        }
        resolve(out);
      })
      .resume();
  });
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** Номер колонки по буквам: A 1, Z 26, AA 27 */
function column(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const LETTERS = (n: number) => {
  let out = "";
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) out = String.fromCharCode(65 + ((v - 1) % 26)) + out;
  return out;
};

/** Объединение «A1:J1048576» или «$A$1:$J$10»: границы, иначе null. Строже библиотеки чтения: лишние знаки не пропускаем */
export function mergeRange(ref: string): { from: [number, number]; to: [number, number] } | null {
  const m = ref.replace(/\$/g, "").match(/^([A-Za-z]{1,3})(\d{1,7})(?::([A-Za-z]{1,3})(\d{1,7}))?$/);
  if (!m) return null;
  const a: [number, number] = [column(m[1]!), Number(m[2])];
  const b: [number, number] = m[3] ? [column(m[3]), Number(m[4])] : a;
  const ok = (p: [number, number]) => p[0] >= 1 && p[0] <= 16_384 && p[1] >= 1 && p[1] <= 1_048_576;
  if (!ok(a) || !ok(b)) return null;
  return { from: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], to: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
}

/** Сколько ячеек в объединении «A1:J1048576». Непонятная ссылка: бесконечно много, такой лист не читаем */
export function mergeArea(ref: string): number {
  const r = mergeRange(ref);
  return r ? (r.to[0] - r.from[0] + 1) * (r.to[1] - r.from[1] + 1) : Number.POSITIVE_INFINITY;
}

/** Листы книги: имя и путь к части архива */
function sheetsOf(workbook: string, rels: string): { name: string; path: string }[] {
  const targets = new Map<string, string>();
  for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(tag, "Id");
    const target = attr(tag, "Target");
    if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  return (workbook.match(/<sheet\b[^>]*>/g) ?? []).flatMap((tag) => {
    const name = attr(tag, "name");
    const id = attr(tag, "r:id") ?? tag.match(/\s[\w]+:id="([^"]*)"/)?.[1];
    const path = id ? targets.get(id) : undefined;
    return name && path ? [{ name: unescape(name), path }] : [];
  });
}

/**
 * Лист целей без лишнего: только ячейки и объединения. Ширины колонок, проверки данных, условное форматирование,
 * ссылки, примечания и рисунки библиотека разворачивает по каждой ячейке диапазона, для целей они не нужны.
 * Объединения собираются заново из разобранных границ: библиотека не видит исходных ссылок
 */
export function slimSheet(xml: string, sheet: string): string {
  const open = xml.match(/<(\w+:)?worksheet\b[^>]*>/);
  if (!open) throw new XlsxError("not-xlsx");
  const prefix = open[1] ?? "";
  const part = (tag: string) => xml.match(new RegExp(`<${prefix}${tag}\\b[^>]*/>|<${prefix}${tag}\\b[^>]*>[\\s\\S]*?</${prefix}${tag}>`))?.[0] ?? "";
  const refs = (part("mergeCells").match(/<(\w+:)?mergeCell\b[^>]*>/g) ?? []).map((tag) => attr(tag, "ref") ?? "");
  let area = 0;
  const merges: string[] = [];
  for (const ref of refs) {
    const r = mergeRange(ref);
    if (!r) throw new XlsxError(`Во вкладке «${sheet}» непонятное объединение ячеек: разъедините его в копии борда`);
    area += (r.to[0] - r.from[0] + 1) * (r.to[1] - r.from[1] + 1);
    if (area > MERGE_MAX) throw new XlsxError(`Во вкладке «${sheet}» объединено слишком много ячеек: разъедините их в копии борда`);
    merges.push(`<${prefix}mergeCell ref="${LETTERS(r.from[0])}${r.from[1]}:${LETTERS(r.to[0])}${r.to[1]}"/>`);
  }
  const mergeCells = merges.length ? `<${prefix}mergeCells count="${merges.length}">${merges.join("")}</${prefix}mergeCells>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${open[0]}${part("sheetData") || `<${prefix}sheetData/>`}${mergeCells}</${prefix}worksheet>`;
}

/**
 * Оглавление книги без лишнего: только список листов и признак дат от 1904 года. Именованные диапазоны и фильтры
 * библиотека разворачивает по каждой ячейке: фильтр на большой вкладке с сырыми данными занял бы всю память
 */
export function slimWorkbook(xml: string): string {
  const open = xml.match(/<(\w+:)?workbook\b[^>]*>/);
  if (!open) throw new XlsxError("not-xlsx");
  const prefix = open[1] ?? "";
  const prTag = xml.match(new RegExp(`<${prefix}workbookPr\\b[^>]*>`))?.[0] ?? "";
  const date1904 = /^(1|true)$/i.test(attr(prTag, "date1904") ?? "");
  const pr = date1904 ? `<${prefix}workbookPr date1904="1"/>` : "";
  const sheets = xml.match(new RegExp(`<${prefix}sheets\\b[^>]*>[\\s\\S]*?</${prefix}sheets>`))?.[0];
  if (!sheets) throw new XlsxError("not-xlsx");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${open[0]}${pr}${sheets}</${prefix}workbook>`;
}

/**
 * Файл, который можно отдать библиотеке чтения: ненужные листы пустые, части архива в пределах, объединения на листах
 * целей разумные. keep: какие листы читать по имени
 */
export async function prepareXlsx(data: ArrayBuffer, keep: (sheet: string) => boolean): Promise<Uint8Array> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new XlsxError("not-xlsx");
  }
  const workbook = zip.file("xl/workbook.xml");
  const workbookRels = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbook || !workbookRels) throw new XlsxError("not-xlsx");
  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  const workbookXml = decode(await readLimited(workbook, PART_MAX, "Оглавление книги"));
  const sheets = sheetsOf(workbookXml, decode(await readLimited(workbookRels, PART_MAX, "Оглавление книги")));
  const skip = new Set(sheets.filter((s) => !keep(s.name)).map((s) => s.path));
  const kept = new Map(sheets.filter((s) => keep(s.name)).map((s) => [s.path, s.name]));
  const relsOf = (path: string) => path.replace(/([^/]+)$/, "_rels/$1.rels");
  // Связи листов (рисунки, примечания, ссылки) не нужны ни одному листу: у оставленных они тоже пустые
  const sheetRels = new Set(sheets.map((s) => relsOf(s.path)));

  const out = new JSZip();
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const name = entry.name.startsWith("/") ? entry.name.slice(1) : entry.name;
    if (skip.has(name)) {
      out.file(name, EMPTY_SHEET);
      continue;
    }
    if (name === "xl/workbook.xml") {
      out.file(name, slimWorkbook(workbookXml));
      continue;
    }
    if (sheetRels.has(name)) {
      out.file(name, EMPTY_RELS);
      continue;
    }
    // Примечания, рисунки, картинки, сводные таблицы и внешние ссылки не нужны: в примечаниях бывают личные пометки,
    // а картинки и сводные таблицы только занимают память
    if (/^xl\/(comments\d*|drawings\/|threadedComments\/|persons\/|media\/|pivotCache\/|pivotTables\/|externalLinks\/|printerSettings\/|tables\/)/.test(name)) continue;
    const sheet = kept.get(name);
    const content = await readLimited(entry, PART_MAX, sheet ? `Вкладка «${sheet}»` : "Часть файла");
    total += content.length;
    if (total > TOTAL_MAX) throw new XlsxError("Файл слишком большой после распаковки: удалите из копии борда лидера лишние вкладки и скачайте снова");
    out.file(name, sheet ? slimSheet(decode(content), sheet) : content);
  }
  // Без сжатия: файл живёт только в памяти до чтения
  return out.generateAsync({ type: "uint8array", compression: "STORE" });
}
