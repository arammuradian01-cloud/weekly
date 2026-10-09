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
/** Объединение на листе целей не больше этого числа ячеек */
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

/** Сколько ячеек в объединении «A1:J1048576» */
export function mergeArea(ref: string): number {
  const m = ref.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
  if (!m) return 1;
  return (Math.abs(column(m[3]!) - column(m[1]!)) + 1) * (Math.abs(Number(m[4]) - Number(m[2])) + 1);
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
  const sheets = sheetsOf(decode(await readLimited(workbook, PART_MAX, "Оглавление книги")), decode(await readLimited(workbookRels, PART_MAX, "Оглавление книги")));
  const skip = new Set(sheets.filter((s) => !keep(s.name)).map((s) => s.path));
  const kept = new Map(sheets.filter((s) => keep(s.name)).map((s) => [s.path, s.name]));
  const relsOf = (path: string) => path.replace(/([^/]+)$/, "_rels/$1.rels");
  const skipRels = new Set([...skip].map(relsOf));

  const out = new JSZip();
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const name = entry.name.startsWith("/") ? entry.name.slice(1) : entry.name;
    if (skip.has(name)) {
      out.file(name, EMPTY_SHEET);
      continue;
    }
    if (skipRels.has(name)) {
      out.file(name, EMPTY_RELS);
      continue;
    }
    const sheet = kept.get(name);
    const content = await readLimited(entry, PART_MAX, sheet ? `Вкладка «${sheet}»` : "Часть файла");
    total += content.length;
    if (total > TOTAL_MAX) throw new XlsxError("Файл слишком большой после распаковки: удалите из копии борда лишние вкладки и скачайте снова");
    if (sheet) {
      for (const tag of decode(content).match(/<mergeCell\b[^>]*>/g) ?? []) {
        if (mergeArea(attr(tag, "ref") ?? "") > MERGE_MAX) throw new XlsxError(`Во вкладке «${sheet}» объединён слишком большой диапазон ячеек: разъедините его в копии борда`);
      }
    }
    out.file(name, content);
  }
  // Без сжатия: файл живёт только в памяти до чтения
  return out.generateAsync({ type: "uint8array", compression: "STORE" });
}
