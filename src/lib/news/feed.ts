// Разбор лент RSS 2.0 и Atom (этап 60). Чистые функции без сети и базы: ленту сюда приносит транспорт.
//
// Берём только то, что храним: заголовок, ссылку, идентификатор, дату и короткий текст анонса. Разметку
// из описания снимаем, сущности раскрываем, длинное тире заменяем дефисом (правило текстов ресурса).
// Разбор терпимый: чужая лента бывает кривой, поэтому запись без заголовка или ссылки просто пропускается,
// а запись без даты получает время забора.

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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "-", ndash: "-", hellip: "...", rsquo: "'", lsquo: "'", ldquo: "«", rdquo: "»" };

/** Раскрыть сущности HTML и XML: именованные, десятичные и шестнадцатеричные */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
    if (body[0] === "#") {
      const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[body.toLowerCase()] ?? all;
  });
}

/** Снять CDATA, разметку и лишние пробелы. Длинное тире и стрелки не допускаются в текстах ресурса */
export function cleanText(raw: string): string {
  const noCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Разметка в ленте бывает и как есть, и экранированной (Atom type="html"): раскрываем сущности до снятия тегов
  const noTags = decodeEntities(noCdata).replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, " ").replace(/<[^>]+>/g, "");
  return decodeEntities(noTags)
    .replace(/[—–]/g, "-")
    .replace(/[→←⇒]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Содержимое первого тега с таким именем внутри блока или null. Префиксы пространств имён не важны */
function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    const re = new RegExp(`<(?:[a-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${name}\\s*>`, "i");
    const m = re.exec(block);
    if (m) return m[1]!;
  }
  return null;
}

/** Значение атрибута у первого тега с таким именем и условием на атрибуты */
function attr(block: string, name: string, attribute: string, where?: (attrs: string) => boolean): string | null {
  const re = new RegExp(`<(?:[a-z0-9]+:)?${name}\\b([^>]*)\\/?>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const attrs = m[1] ?? "";
    if (where && !where(attrs)) continue;
    const v = new RegExp(`\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
    if (v) return decodeEntities(v[1] ?? v[2] ?? "");
  }
  return null;
}

/** Ссылка записи Atom: rel="alternate" или без rel, иначе первая */
function atomLink(block: string): string | null {
  const alt = attr(block, "link", "href", (a) => !/\brel\s*=/i.test(a) || /\brel\s*=\s*["']alternate["']/i.test(a));
  return alt ?? attr(block, "link", "href");
}

export function parseDate(text: string | null): Date | null {
  if (!text) return null;
  const t = cleanText(text);
  if (!t) return null;
  // Русские ленты иногда пишут часовой пояс словом: MSK
  const fixed = t.replace(/\bMSK\b/i, "+0300").replace(/\bGMT\+0?(\d)\b/, "+0$100");
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[a-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-z0-9]+:)?${name}\\s*>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]!);
  return out;
}

/** Заголовок ленты: первый <title> вне записей */
function feedTitle(xml: string, items: string[]): string {
  let head = xml;
  for (const i of items) head = head.replace(i, "");
  return cleanText(tag(head, ["title"]) ?? "");
}

const MAX_TITLE = 300;
const MAX_DESCRIPTION = 4000;

/** Разобрать ленту. Пустой результат, если это не RSS и не Atom */
export function parseFeed(xml: string): Feed {
  const text = xml.replace(/^﻿/, "");
  const rssItems = blocks(text, "item");
  const atomEntries = rssItems.length ? [] : blocks(text, "entry");
  const atom = !rssItems.length && atomEntries.length > 0;
  const raw = atom ? atomEntries : rssItems;
  const items: FeedItem[] = [];
  for (const block of raw) {
    const title = cleanText(tag(block, ["title"]) ?? "").slice(0, MAX_TITLE);
    const url = atom ? atomLink(block) : cleanText(tag(block, ["link"]) ?? "") || attr(block, "link", "href");
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;
    const idRaw = atom ? tag(block, ["id"]) : tag(block, ["guid"]);
    const guid = cleanText(idRaw ?? "") || url;
    const description = cleanText(atom ? (tag(block, ["summary", "content"]) ?? "") : (tag(block, ["description", "encoded", "summary"]) ?? "")).slice(0, MAX_DESCRIPTION);
    const publishedAt = parseDate(atom ? (tag(block, ["published", "updated"]) ?? null) : (tag(block, ["pubDate", "date", "published", "updated"]) ?? null));
    items.push({ guid, url: url.trim(), title, description, publishedAt });
  }
  return { title: feedTitle(text, raw), items };
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
