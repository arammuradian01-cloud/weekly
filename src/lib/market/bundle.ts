// Пакет рынка КАСКО и ОСАГО (этап 62): один JSON-файл с кодом страницы дашборда и наборами данных.
// { "kind": "weekly-market-bundle", "version": 1, "files": { "index.html": "...", "ui.js": "...", "d3.min.js": "..." },
//   "datasets": { "<имя>": { "title": "...", "description": "...", "rows": [ { ... } ] } } }
// Проверка чистая, без базы: её считают и обработчик загрузки, и тесты. Ошибки понятные, по-русски.
// Цифры и код дашборда живут только в базе: в репозитории их нет.

export const MARKET_BUNDLE_KIND = "weekly-market-bundle";
export const MARKET_BUNDLE_VERSION = 1;
/** Предел файла пакета: 25 МБ */
export const MARKET_MAX_BYTES = 25 * 1024 * 1024;
/** Имя набора данных: строчная латиница, цифры, подчёркивание */
export const DATASET_NAME = /^[a-z0-9_]{1,40}$/;
/** Имя файла кода: латиница, цифры, точка, дефис, подчёркивание; страница, скрипт или стили */
export const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(html|js|css)$/;
/** Файл библиотеки графиков: подключается до кода страницы, если он есть в пакете */
export const D3_FILE = "d3.min.js";

const MAX_FILES = 30;
const MAX_DATASETS = 100;
const MAX_ROWS_TOTAL = 1_000_000;
const MAX_KEYS = 200;
const MAX_KEY_LENGTH = 100;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
/** Имена полей, которые в JavaScript ломают объекты: такие строки не принимаются */
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type MarketValue = string | number | boolean | null;
export type MarketRow = Record<string, MarketValue>;
export type MarketDatasetInput = { title: string; description: string; rows: MarketRow[] };
export type MarketBundleInput = {
  files: Record<string, string>;
  datasets: Record<string, MarketDatasetInput>;
  datasetsCount: number;
  rowsTotal: number;
};

/** Ошибка проверки пакета: текст показывается владельцу как есть */
export class MarketBundleError extends Error {}

const fail = (message: string): never => {
  throw new MarketBundleError(message);
};

const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export const megabytes = (bytes: number) => (Math.round((bytes / 1024 / 1024) * 10) / 10).toString().replace(".", ",");

/** Размер текста в байтах UTF-8 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Адреса подключённых скриптов и стилей страницы: <script src> и <link rel="stylesheet" href> */
export function linkedFiles(html: string): { tag: "script" | "style"; src: string }[] {
  const out: { tag: "script" | "style"; src: string }[] = [];
  // Теги стилей ищутся только в разметке: текст встроенных скриптов не разбирается, в нём бывают строки с тегами
  const links = (part: string) => {
    for (const m of part.matchAll(/<link\b([^>]*)>/gi)) {
      const attrs = m[1] ?? "";
      if (!/^stylesheet$/i.test(attr(attrs, "rel") ?? "")) continue;
      const href = attr(attrs, "href");
      if (href !== null) out.push({ tag: "style", src: href });
    }
  };
  let at = 0;
  for (const m of html.matchAll(SCRIPT_ELEMENT)) {
    links(html.slice(at, m.index));
    const src = attr(m[1] ?? "", "src");
    if (src !== null) out.push({ tag: "script", src });
    at = m.index + m[0].length;
  }
  links(html.slice(at));
  return out;
}

/** Элемент скрипта целиком: открывающий тег с атрибутами, текст и закрывающий тег */
export const SCRIPT_ELEMENT = /<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi;

/** Значение атрибута тега или null */
export function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? "").trim();
}

/** Внешний адрес: со схемой или с двух косых. Внутри пакета файлы подключаются только по имени */
const external = (src: string) => /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//");

function checkFiles(raw: unknown): Record<string, string> {
  if (!isPlain(raw)) return fail("В пакете нет кода страницы: нужен раздел files с файлом index.html");
  const names = Object.keys(raw);
  if (names.length > MAX_FILES) fail(`В пакете ${names.length} файлов кода, можно не больше ${MAX_FILES}`);
  const files: Record<string, string> = {};
  for (const name of names) {
    if (!FILE_NAME.test(name)) fail(`Имя файла «${name.slice(0, 80)}» не подходит: латиница, цифры, точка или дефис и расширение .html, .js или .css`);
    const text = raw[name];
    if (typeof text !== "string") fail(`Файл ${name}: ожидается текст файла`);
    files[name] = text as string;
  }
  const index = files["index.html"];
  if (!index || !index.trim()) fail("В пакете нет страницы index.html: без неё рынок не показать");
  for (const { src } of linkedFiles(index!)) {
    const name = src.replace(/^\.\//, "");
    if (external(src)) fail(`index.html подключает внешний адрес ${src.slice(0, 120)}: всё нужное должно лежать в пакете`);
    if (!Object.prototype.hasOwnProperty.call(files, name)) fail(`index.html подключает ${name.slice(0, 80)}, а такого файла в пакете нет`);
  }
  return files;
}

function checkRows(name: string, raw: unknown): MarketRow[] {
  if (!Array.isArray(raw)) return fail(`Набор ${name}: rows должен быть списком строк`);
  raw.forEach((row, i) => {
    if (!isPlain(row)) fail(`Набор ${name}, строка ${i + 1}: ожидается объект с полями`);
    const keys = Object.keys(row as object);
    if (keys.length > MAX_KEYS) fail(`Набор ${name}, строка ${i + 1}: полей ${keys.length}, можно не больше ${MAX_KEYS}`);
    for (const key of keys) {
      if (!key || key.length > MAX_KEY_LENGTH || BAD_KEYS.has(key)) fail(`Набор ${name}, строка ${i + 1}: имя поля «${key.slice(0, 40)}» не принимается`);
      const v = (row as Record<string, unknown>)[key];
      const ok = v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
      if (!ok) fail(`Набор ${name}, строка ${i + 1}, поле ${key}: допустимы текст, число, да или нет и пусто`);
    }
  });
  return raw as MarketRow[];
}

function checkDatasets(raw: unknown): Record<string, MarketDatasetInput> {
  if (!isPlain(raw)) return fail("В пакете нет наборов данных: нужен раздел datasets");
  const names = Object.keys(raw);
  if (!names.length) fail("В пакете нет ни одного набора данных");
  if (names.length > MAX_DATASETS) fail(`В пакете ${names.length} наборов данных, можно не больше ${MAX_DATASETS}`);
  const out: Record<string, MarketDatasetInput> = {};
  for (const name of names) {
    if (!DATASET_NAME.test(name)) fail(`Имя набора «${name.slice(0, 60)}» не подходит: строчная латиница, цифры и подчёркивание, до 40 знаков`);
    const set = raw[name];
    if (!isPlain(set)) fail(`Набор ${name}: ожидается объект с title, description и rows`);
    const s = set as Record<string, unknown>;
    if (s.title !== undefined && typeof s.title !== "string") fail(`Набор ${name}: название (title) должно быть текстом`);
    if (s.description !== undefined && typeof s.description !== "string") fail(`Набор ${name}: описание (description) должно быть текстом`);
    out[name] = {
      title: ((s.title as string | undefined) ?? "").trim().slice(0, MAX_TITLE) || name,
      description: ((s.description as string | undefined) ?? "").trim().slice(0, MAX_DESCRIPTION),
      rows: checkRows(name, s.rows),
    };
  }
  return out;
}

/** Проверка разобранного JSON. Возвращает файлы и наборы или бросает MarketBundleError с понятным текстом */
export function validateBundle(raw: unknown): MarketBundleInput {
  if (!isPlain(raw)) return fail(`Это не пакет рынка: ожидается JSON-объект с отметкой kind «${MARKET_BUNDLE_KIND}»`);
  if (raw.kind !== MARKET_BUNDLE_KIND) fail(`Это не пакет рынка: в файле нет отметки kind «${MARKET_BUNDLE_KIND}»`);
  if (raw.version !== MARKET_BUNDLE_VERSION) fail(`Версия пакета ${String(raw.version).slice(0, 20)} не поддерживается: нужна версия ${MARKET_BUNDLE_VERSION}`);
  const files = checkFiles(raw.files);
  const datasets = checkDatasets(raw.datasets);
  const rowsTotal = Object.values(datasets).reduce((sum, d) => sum + d.rows.length, 0);
  if (rowsTotal > MAX_ROWS_TOTAL) fail(`В пакете ${rowsTotal} строк, можно не больше ${MAX_ROWS_TOTAL}`);
  return { files, datasets, datasetsCount: Object.keys(datasets).length, rowsTotal };
}

/** Текст файла пакета: размер, JSON и проверка */
export function parseBundle(text: string, bytes = byteLength(text)): MarketBundleInput {
  if (!text.trim()) fail("Файл пустой: выберите файл пакета рынка .json");
  if (bytes > MARKET_MAX_BYTES) fail(`Файл ${megabytes(bytes)} МБ, пакет рынка может быть не больше 25 МБ`);
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return fail("Файл не читается как JSON: выберите файл пакета рынка .json");
  }
  return validateBundle(raw);
}
