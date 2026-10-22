// Разбор лент RSS 2.0 и Atom (этап 60). Чистые функции без сети и базы: ленту сюда приносит транспорт.
//
// Берём только то, что храним: заголовок, ссылку, идентификатор, дату и короткий текст анонса. Разметку
// из описания снимаем, сущности раскрываем, длинное тире заменяем дефисом (правило текстов ресурса).
// Разбор терпимый: чужая лента бывает кривой, поэтому запись без заголовка или ссылки просто пропускается,
// а запись без даты получает время забора.
//
// Разбор линейный (проверка 21.10): один проход по тегам через indexOf, без регулярных выражений с ленивым
// поиском закрывающего тега. Незакрытая запись кончается там, где начинается следующая. DTD и внешние сущности
// не разбираются, раскрываются только стандартные сущности из таблицы ниже. Читаем не больше 1 МБ текста
// и не больше 200 записей: однопоточный веб-процесс не должен зависнуть на патологической ленте.

export type FeedItem = {
  /** guid, id или ссылка, если идентификатора нет */
  guid: string;
  url: string;
  title: string;
  /** Анонс без разметки, может быть пустым */
  description: string;
  /** null: в ленте даты нет или её не разобрать */
  publishedAt: Date | null;
};

export type Feed = { title: string; items: FeedItem[] };

/** Сколько знаков ленты разбираем и сколько записей берём из одной ленты */
export const MAX_PARSE_CHARS = 1024 * 1024;
export const MAX_FEED_ITEMS = 200;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "-", ndash: "-", hellip: "...", rsquo: "'", lsquo: "'", ldquo: "«", rdquo: "»" };

/** Раскрыть сущности HTML и XML: именованные, десятичные и шестнадцатеричные */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,8}|#\d{1,9}|[a-z]{2,10});/gi, (all, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** Содержимое секций CDATA как текст. Через indexOf: незакрытая секция идёт до конца строки */
function stripCdata(text: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const a = text.indexOf("<![CDATA[", i);
    if (a < 0) return out + text.slice(i);
    out += text.slice(i, a);
    const b = text.indexOf("]]>", a + 9);
    if (b < 0) return out + text.slice(a + 9);
    out += text.slice(a + 9, b);
    i = b + 3;
  }
}

/** Снять CDATA, разметку и лишние пробелы. Длинное тире и стрелки не допускаются в текстах ресурса */
export function cleanText(raw: string): string {
  // Разметка в ленте бывает и как есть, и экранированной (Atom type="html"): раскрываем сущности до снятия тегов.
  // Тег ищется до ближайшей угловой скобки любого вида, поэтому одиночная «<» не тянет поиск до конца текста
  const noTags = decodeEntities(stripCdata(raw))
    .replace(/<br\s{0,10}\/?>|<\/(?:p|div|li)>/gi, " ")
    .replace(/<[^<>]*>/g, "");
  return tidyText(decodeEntities(noTags));
}

/**
 * Символы, которых нет в текстах ресурса: длинное и среднее тире, стрелки, точка-разделитель и маркеры
 * списков. Заменяются дефисом, как тире. Общая функция для лент и ответа Claude
 */
export function tidyText(text: string): string {
  return text
    .replace(/[—–―‒·•∙⋅]/g, "-")
    .replace(/[\u2190-\u21ff\u27f0-\u27ff\u2900-\u297f\u2b00-\u2b2f➔➜➝➞➟➠➡➢➣➤►▶▸▹]/g, "-")
    .replace(/(?:\s*-\s*){2,}/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^\s*-\s*|\s*-\s*$/g, "")
    .trim();
}

type Tag = {
  /** Имя без префикса пространства имён, строчными */
  local: string;
  close: boolean;
  selfClose: boolean;
  /** Позиция «<» и позиция сразу после «>» */
  start: number;
  end: number;
  attrs: string;
};

const isNameChar = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 58 || c === 95 || c === 45 || c === 46;

/**
 * Теги текста по порядку, один проход. CDATA и комментарии пропускаются целиком, объявления и инструкции
 * (<!DOCTYPE>, <?xml?>) тоже. «<», за которым не имя, считается текстом. Каждый символ смотрится конечное число раз
 */
function* tagsOf(text: string, from: number, to: number): Generator<Tag> {
  let i = from;
  while (i < to) {
    const lt = text.indexOf("<", i);
    if (lt < 0 || lt >= to) return;
    const c = text.charCodeAt(lt + 1);
    if (c === 33 /* ! */) {
      const [open, close] = text.startsWith("<![CDATA[", lt) ? ["<![CDATA[", "]]>"] : text.startsWith("<!--", lt) ? ["<!--", "-->"] : ["<!", ">"];
      const e = text.indexOf(close, lt + open.length);
      if (e < 0 || e >= to) return;
      i = e + close.length;
      continue;
    }
    if (c === 63 /* ? */) {
      const e = text.indexOf("?>", lt + 2);
      if (e < 0 || e >= to) return;
      i = e + 2;
      continue;
    }
    const close = c === 47; /* / */
    const nameStart = lt + (close ? 2 : 1);
    let j = nameStart;
    while (j < to && isNameChar(text.charCodeAt(j))) j++;
    if (j === nameStart) {
      i = lt + 1;
      continue;
    }
    const gt = text.indexOf(">", j);
    if (gt < 0 || gt >= to) return;
    const name = text.slice(nameStart, j).toLowerCase();
    const selfClose = !close && text.charCodeAt(gt - 1) === 47;
    yield { local: name.slice(name.lastIndexOf(":") + 1), close, selfClose, start: lt, end: gt + 1, attrs: close ? "" : text.slice(j, selfClose ? gt - 1 : gt) };
    i = gt + 1;
  }
}

/** Сколько сырого текста поля берём до очистки: заголовок короткий, анонс режется после очистки */
const RAW_LIMIT = { title: 4_000, text: 20_000, date: 200 };
const MAX_LINKS = 20;

/**
 * Поля записи за один проход по её тегам: содержимое первого элемента каждого имени (до его первого закрывающего
 * тега) и атрибуты первых тегов link. Префиксы пространств имён не важны: dc:date и content:encoded тоже находятся
 */
function fieldsOf(text: string, from: number, to: number) {
  const opened = new Map<string, number>();
  const content = new Map<string, [number, number]>();
  const links: string[] = [];
  for (const t of tagsOf(text, from, to)) {
    if (t.local === "link" && !t.close && links.length < MAX_LINKS) links.push(t.attrs);
    if (!t.close) {
      if (!t.selfClose && !opened.has(t.local)) opened.set(t.local, t.end);
      continue;
    }
    const o = opened.get(t.local);
    if (o !== undefined && !content.has(t.local)) content.set(t.local, [o, t.start]);
  }
  return {
    get(names: string[], limit: number): string | null {
      for (const n of names) {
        const r = content.get(n);
        if (r) return text.slice(r[0], Math.min(r[1], r[0] + limit));
      }
      return null;
    },
    links,
  };
}

function attrValue(attrs: string, name: string): string | null {
  const v = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return v ? decodeEntities(v[1] ?? v[2] ?? "") : null;
}

/** Ссылка записи Atom: rel="alternate" или без rel, иначе первая с адресом */
function atomLink(links: string[]): string | null {
  const alt = links.find((a) => !/(?:^|\s)rel\s*=/i.test(a) || /(?:^|\s)rel\s*=\s*["']alternate["']/i.test(a));
  const href = alt ? attrValue(alt, "href") : null;
  if (href) return href;
  for (const a of links) {
    const h = attrValue(a, "href");
    if (h) return h;
  }
  return null;
}

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC|UT|EST|EDT|CST|CDT|MST|MDT|PST|PDT))$/i;

/** Дата записи. Без часового пояса читается как UTC: так результат не зависит от пояса сервера */
export function parseDate(text: string | null): Date | null {
  if (!text) return null;
  const t = cleanText(text.slice(0, RAW_LIMIT.date));
  if (!t) return null;
  // Русские ленты иногда пишут часовой пояс словом: MSK, GMT+3
  let fixed = t.replace(/\bMSK$/i, "+0300").replace(/\bGMT([+-])(\d{1,2})(?::?(\d{2}))?$/i, (_, sign: string, h: string, m?: string) => `${sign}${h.padStart(2, "0")}${m ?? "00"}`);
  if (!HAS_ZONE.test(fixed) && /\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(fixed)) {
    fixed = /^\d{4}-\d{2}-\d{2}[T ]/.test(fixed) ? `${fixed.replace(" ", "T")}Z` : `${fixed} +0000`;
  }
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 4000;

/** Разобрать ленту. Пустой результат, если это не RSS и не Atom */
export function parseFeed(xml: string): Feed {
  const text = xml.slice(0, MAX_PARSE_CHARS).replace(/^﻿/, "");
  // Один проход по тегам: границы записей. Вид ленты по первой встреченной записи: item (RSS) или entry (Atom)
  let kind: "item" | "entry" | null = null;
  let headEnd = text.length;
  let open = -1;
  const ranges: [number, number][] = [];
  for (const t of tagsOf(text, 0, text.length)) {
    if (t.local !== "item" && t.local !== "entry") continue;
    if (kind === null) {
      if (t.close || t.selfClose) continue;
      kind = t.local;
      headEnd = t.start;
    }
    if (t.local !== kind || t.selfClose) continue;
    if (!t.close) {
      // Незакрытая запись кончается там, где начинается следующая
      if (open >= 0) ranges.push([open, t.start]);
      open = t.end;
    } else if (open >= 0) {
      ranges.push([open, t.start]);
      open = -1;
    }
    if (ranges.length >= MAX_FEED_ITEMS) {
      open = -1;
      break;
    }
  }
  if (open >= 0) ranges.push([open, text.length]);
  const atom = kind === "entry";

  const items: FeedItem[] = [];
  for (const [from, to] of ranges) {
    const f = fieldsOf(text, from, to);
    const title = cleanText(f.get(["title"], RAW_LIMIT.title) ?? "").slice(0, MAX_TITLE);
    const rssLink = cleanText(f.get(["link"], RAW_LIMIT.title) ?? "");
    const url = (atom ? atomLink(f.links) : rssLink || atomLink(f.links))?.trim() ?? "";
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    const guid = cleanText(f.get(atom ? ["id"] : ["guid"], RAW_LIMIT.title) ?? "") || url;
    const description = cleanText(f.get(atom ? ["summary", "content"] : ["description", "encoded", "summary"], RAW_LIMIT.text) ?? "").slice(0, MAX_DESCRIPTION);
    const publishedAt = parseDate(f.get(atom ? ["published", "updated"] : ["pubdate", "date", "published", "updated"], RAW_LIMIT.date));
    items.push({ guid, url, title, description, publishedAt });
  }
  // Заголовок ленты: первый <title> до первой записи
  const head = fieldsOf(text, 0, headEnd);
  return { title: cleanText(head.get(["title"], RAW_LIMIT.title) ?? "").slice(0, MAX_TITLE), items };
}

/** Ключ адреса для защиты от дублей: без схемы, www, utm-меток, якоря и завершающего слэша */
export function urlKeyOf(url: string): string {
  try {
    const u = new URL(url.trim());
    const params = [...u.searchParams.entries()].filter(([k]) => !/^(utm_|yclid|gclid|fbclid|from$|ref$)/i.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${query}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
