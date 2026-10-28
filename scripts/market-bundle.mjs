// Сборка пакета рынка КАСКО и ОСАГО (этап 62) из выгрузки дашборда-артефакта. Пакет: один файл JSON, который
// владелец загружает на странице «Рынок» кнопкой «Загрузить пакет рынка».
//
// node scripts/market-bundle.mjs <папка выгрузки> --out <файл пакета.json> [--d3 <путь к d3.min.js>]
//
// Рядом с пакетом скрипт кладёт его сжатую копию <файл пакета.json.gz> (этап 83): её и стоит загружать на ресурсе,
// она весит примерно в десять раз меньше и проходит через предел на размер запроса у прокси хостинга.
//
// Папка выгрузки:
//   datasets/<имя>.json   описание набора: title, description, source.url вида /_blob/<id>
//   blobs/<id>.json       строки набора: список объектов
//   files2/files/ или files/  код страницы: index.html, ui.js и другие, текстом или в JSON с полем text
// Библиотека графиков d3 берётся из node_modules/d3/dist/d3.min.js, иначе из пути --d3.
//
// Скрипт только читает файлы выгрузки как данные (JSON.parse) и ничего из них не запускает. Пакет с цифрами
// в репозиторий не кладём: путь --out внутри папки репозитория скрипт не принимает (и через ссылки на папки тоже),
// имя market-bundle*.json вдобавок в .gitignore.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Папка репозитория: на уровень выше папки scripts, где лежит этот скрипт */
const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

const DATASET_NAME = /^[a-z0-9_]{1,40}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(html|js|css)$/;
const MAX_BYTES = 25 * 1024 * 1024;

function fail(message) {
  console.error(`Пакет рынка не собран: ${message}`);
  process.exit(1);
}

function args(argv) {
  const out = { dir: null, out: null, d3: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out.out = argv[++i] ?? null;
    else if (a === "--d3") out.d3 = argv[++i] ?? null;
    else if (!a.startsWith("--") && !out.dir) out.dir = a;
    else fail(`непонятный параметр ${a}`);
  }
  if (!out.dir) fail("укажите папку выгрузки: node scripts/market-bundle.mjs <папка> --out <файл.json> [--d3 <d3.min.js>]");
  if (!out.out) fail("укажите, куда сохранить пакет: --out <файл.json> (не в папку репозитория)");
  return out;
}

/** Внутри ли путь папки репозитория. Папка с именем вроде «..данные» внутри репозитория тоже внутри */
function insideRepo(real) {
  const rel = relative(REPO, real);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * Файл пакета вне репозитория: настоящий путь папки (ссылки на папки раскрыты) плюс имя файла не внутри REPO. Если
 * по этому пути уже лежит ссылка, скрипт отказывает: запись пошла бы туда, куда она ведёт
 */
function outsideRepo(out) {
  const path = resolve(out);
  const dir = dirname(path);
  if (!existsSync(dir)) fail(`папки ${dir} нет: создайте её или укажите другую для --out`);
  const real = join(realpathSync(dir), basename(path));
  let link = false;
  try {
    link = lstatSync(real).isSymbolicLink();
  } catch {
    link = false;
  }
  if (link) fail(`--out ${path} это ссылка: укажите обычный файл вне папки проекта`);
  if (insideRepo(real)) {
    fail(`--out ${path} внутри репозитория ${REPO}: цифры рынка не должны попасть в git. Сохраните пакет вне папки проекта, например в домашнюю папку`);
  }
  return real;
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail(`${what} не читается как JSON: ${path}`);
  }
}

/** Код страницы: файл .json с полем text или сам текст */
function readCode(dir) {
  const files = {};
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (!statSync(path).isFile()) continue;
    let name = entry;
    let text;
    if (entry.endsWith(".json")) {
      name = entry.slice(0, -".json".length);
      const raw = readJson(path, `Файл кода ${entry}`);
      if (!raw || typeof raw.text !== "string") fail(`в файле кода ${entry} нет поля text`);
      text = raw.text;
    } else {
      text = readFileSync(path, "utf8");
    }
    if (!FILE_NAME.test(name)) {
      console.warn(`Пропущен файл ${entry}: не страница, не скрипт и не стили`);
      continue;
    }
    files[name] = text;
  }
  return files;
}

function d3Source(explicit) {
  const candidates = [explicit, join(process.cwd(), "node_modules", "d3", "dist", "d3.min.js")].filter(Boolean);
  for (const path of candidates) if (existsSync(path)) return readFileSync(path, "utf8");
  return fail("не найден d3.min.js: поставьте пакет d3 (npm install) или укажите путь --d3 <d3.min.js>");
}

function main() {
  const opt = args(process.argv.slice(2));
  // Куда сохранять, проверяется до чтения выгрузки
  const out = outsideRepo(opt.out);
  const dir = resolve(opt.dir);
  const codeDir = [join(dir, "files2", "files"), join(dir, "files")].find((p) => existsSync(p));
  if (!codeDir) fail(`в папке ${dir} нет files2/files или files с кодом страницы`);
  const files = readCode(codeDir);
  if (!files["index.html"]) fail(`в ${codeDir} нет index.html`);
  files["d3.min.js"] = d3Source(opt.d3);

  const datasets = {};
  let rowsTotal = 0;
  const metaDir = join(dir, "datasets");
  if (!existsSync(metaDir)) fail(`в папке ${dir} нет datasets`);
  for (const entry of readdirSync(metaDir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const name = basename(entry, ".json");
    if (!DATASET_NAME.test(name)) fail(`имя набора ${name} не подходит: строчная латиница, цифры и подчёркивание`);
    const meta = readJson(join(metaDir, entry), `Описание набора ${name}`);
    const url = meta?.source?.url;
    const id = typeof url === "string" ? url.split("/").pop() : null;
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) fail(`у набора ${name} нет ссылки на строки (source.url)`);
    const rows = readJson(join(dir, "blobs", `${id}.json`), `Строки набора ${name}`);
    if (!Array.isArray(rows)) fail(`строки набора ${name} не список`);
    datasets[name] = { title: typeof meta.title === "string" ? meta.title : name, description: typeof meta.description === "string" ? meta.description : "", rows };
    rowsTotal += rows.length;
  }
  if (!Object.keys(datasets).length) fail("в папке datasets нет наборов");

  const text = JSON.stringify({ kind: "weekly-market-bundle", version: 1, files, datasets });
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_BYTES) fail(`пакет ${(bytes / 1024 / 1024).toFixed(1)} МБ, на ресурс загружается не больше 25 МБ`);
  writeFileSync(out, text);
  // Сжатая копия рядом: её и загружают на ресурсе, большой пакет иначе не проходит через прокси хостинга
  const packedPath = `${out}.gz`;
  const packed = gzipSync(Buffer.from(text, "utf8"), { level: 9 });
  writeFileSync(packedPath, packed);
  console.log(`Пакет рынка собран: ${out}`);
  console.log(`Файлов кода ${Object.keys(files).length} (${Object.keys(files).join(", ")}), наборов ${Object.keys(datasets).length}, строк ${rowsTotal}, ${(bytes / 1024 / 1024).toFixed(1)} МБ`);
  console.log(`Сжатая копия для загрузки: ${packedPath}, ${(packed.length / 1024 / 1024).toFixed(1)} МБ`);
}

main();
