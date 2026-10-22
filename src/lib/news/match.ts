// Привязка новости к продуктам по ключевым словам и короткое описание по правилам (этап 60). Чистые функции.
//
// Слово ловится по началу слова: «страхов» в «страхование», «вклад» в «вкладов». Для коротких латинских и
// кириллических аббревиатур («РСА», «ВСС») того же правила хватает: они стоят отдельным словом. В словосочетании
// каждое слово ловится по началу, слово в кавычках только целиком.
// Строгая привязка (общие деловые ленты: Интерфакс, ТАСС, РБК): к продукту нужно два разных признака, одного мало.
// Описание без Claude: начало анонса источника дословно, одна-две фразы, не длиннее 240 знаков, без повторения
// заголовка. Адреса, почта, телефоны и призывы перейти вырезаются: и из анонса, и из ответа модели.

import { foldText, keywordBody } from "./keywords";
import { tidyText } from "./feed";

export const SUMMARY_LIMIT = 240;

/** Буквы и цифры любого алфавита: по ним определяется начало слова */
const WORD_CHAR = "\\p{L}\\p{N}";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp | null>();

function patternOf(keyword: string): RegExp | null {
  const key = foldText(keyword);
  let re = patternCache.get(key);
  if (re === undefined) {
    const { body, exact } = keywordBody(keyword);
    const words = body.split(" ").filter(Boolean).map(escapeRegExp);
    // Начало слова: начало строки или не буква перед. Без кавычек конец не ограничен: ловим словоформы,
    // в словосочетании у каждого слова. В кавычках слово целиком
    re = words.length ? new RegExp(`(?:^|[^${WORD_CHAR}])${words.join(exact ? "\\s+" : `[${WORD_CHAR}]*\\s+`)}${exact ? `(?![${WORD_CHAR}])` : ""}`, "u") : null;
    if (patternCache.size > 5000) patternCache.clear();
    patternCache.set(key, re);
  }
  return re;
}

/** Какие ключевые слова продукта найдены в тексте */
export function matchedKeywords(text: string, keywords: string[]): string[] {
  const folded = foldText(text);
  if (!folded) return [];
  return keywords.filter((k) => patternOf(k)?.test(folded) ?? false);
}

/**
 * Слова продуктов без названия самой ленты: на ленте Банки.ру «Банки.ру» стоит в каждой новости и признаком
 * партнёрки не считается. Слово снимается, если оно целиком стоит в названии источника или в имени его сайта
 */
export function withoutOwnName(keywords: Record<string, string[]>, source: { name: string; url: string }): Record<string, string[]> {
  let host = "";
  try {
    host = new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = "";
  }
  const name = foldText(source.name);
  const own = (k: string) => {
    const { body } = keywordBody(k);
    if (body.length < 2) return false;
    const re = new RegExp(`(?:^|[^${WORD_CHAR}])${escapeRegExp(body)}(?![${WORD_CHAR}])`, "u");
    return re.test(name) || (body.includes(".") && host === body);
  };
  return Object.fromEntries(Object.entries(keywords).map(([code, list]) => [code, list.filter((k) => !own(k))]));
}

/** Сколько разных признаков нужно продукту: обычно один, на общей деловой ленте (строгая привязка) два */
export const STRICT_MIN_MATCHES = 2;

/**
 * Коды продуктов, к которым относится новость, в порядке списка продуктов. Заголовок весит столько же,
 * сколько анонс: достаточно одного слова в любом из них. strict: нужно два разных слова продукта
 */
export function matchDirections(item: { title: string; description: string }, keywords: Record<string, string[]>, order: string[] = Object.keys(keywords), options: { strict?: boolean } = {}): string[] {
  const text = `${item.title}\n${item.description}`;
  const need = options.strict ? STRICT_MIN_MATCHES : 1;
  return order.filter((code) => new Set(matchedKeywords(text, keywords[code] ?? []).map((k) => keywordBody(k).body)).size >= need);
}

/** Разбить текст на фразы по точке, восклицательному и вопросительному знакам. Сокращения вроде «млн.» не рвём */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest) {
    const m = /[.!?…]+(?=\s+[А-ЯA-Z«"(]|\s*$)/u.exec(rest);
    if (!m) {
      out.push(rest.trim());
      break;
    }
    const end = m.index + m[0].length;
    const s = rest.slice(0, end).trim();
    if (s) out.push(s);
    rest = rest.slice(end).trim();
  }
  return out;
}

/** Призывы перейти, позвонить, написать: такую фразу из описания убираем целиком. Только повелительные формы */
const CALL_TO_ACTION =
  /(?:^|[^\p{L}])(?:перейдите|переходите|перейти по ссылке|перейти на сайт|жмите|нажмите|кликните|кликайте|звоните|позвоните|пишите|напишите|подписывайтесь|подпишитесь|скачайте|установите|оставьте заявку|читайте также|читайте подробнее|подробнее на сайте|подробнее по ссылке|по ссылке|click|visit|subscribe|call us)(?![\p{L}])/iu;
/**
 * Служебные хвосты анонса после вырезания адресов и телефонов: «Подробности на сайте.», «Тел.:», «Источник: ...»,
 * «Фото: ...». Такая фраза уходит целиком
 */
const SERVICE_TAIL =
  /^(?:(?:подробност\p{L}*|подробнее)(?:[\s.:!]*|\s+(?:на|по|в|во|у|читайте|смотрите|можно|узнайте)(?![\p{L}])[\s\S]{0,60})|(?:читать|читайте) (?:далее|полностью)[\s\S]{0,40}|(?:тел\.?|телефон\p{L}*|факс|e-?mail|эл\.? ?почта|почта|сайт|источник|фото|видео|реклама|erid)\s*:[\s\S]{0,60}|тел\.)$/iu;
const DANGLING = /(?:[,;:]?\s*(?:тел\.?|телефон|факс|e-?mail|эл\.? ?почта|сайт|подробности|подробнее)\s*[:.]?\s*)+$/iu;

/** Адреса: со схемой или www, домены с латинскими зонами, домены .рф только с путём (ДОМ.РФ в тексте остаётся) */
const URL_LIKE =
  /(?:https?:\/\/|www\.)\S+|(?<![\p{L}\d-])[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.(?:ru|su|com|net|org|info|biz|io|me|pro|app|site|online|xyz|top|link|click|shop)(?![\p{L}\d-])(?:\/\S*)?|(?<![\p{L}\d-])[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.рф\/\S*/giu;
const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}/giu;
const PHONE = /(?:\+\d{1,3}|(?<!\d)8)[\s(-]{0,3}\d{3}[\s)-]{0,3}\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;

/**
 * Описание без адресов, почты, телефонов и призывов перейти. Анонс чужой ленты и ответ модели могут содержать
 * ссылку на фишинговый сайт или «позвоните по номеру»: в ресурс и письма это не попадает
 */
export function sanitizeSummary(text: string): string {
  const cleaned = tidyText(text.replace(EMAIL, " ").replace(URL_LIKE, " ").replace(PHONE, " "));
  return sentencesOf(cleaned)
    .filter((s) => !CALL_TO_ACTION.test(s))
    .map((s) => s.replace(DANGLING, "").trim())
    .filter((s) => s && !/^[\p{P}\s]*$/u.test(s) && !SERVICE_TAIL.test(s.replace(/^[\p{P}\s]+/u, "")))
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Короткое описание по правилам: одна-две фразы анонса в пределах лимита. Пустой анонс даёт пустое описание */
export function ruleSummary(item: { title: string; description: string }, limit = SUMMARY_LIMIT): string {
  // Нужны только первые фразы: длинный анонс дальше не разбираем
  const description = sanitizeSummary(item.description.slice(0, 2000));
  if (!description) return "";
  const title = foldText(item.title);
  const sentences = sentencesOf(description).filter((s) => foldText(s).replace(/[.!?…]+$/, "") !== title.replace(/[.!?…]+$/, ""));
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > limit) break;
    out = next;
  }
  if (!out) {
    const first = sentences[0] ?? description;
    out = first.length > limit ? `${first.slice(0, limit - 1).replace(/\s+\S*$/, "")}…` : first;
  }
  return out;
}

/** Обрезать описание из любого источника до предела: без тире, стрелок и точки-разделителя, пробелы схлопнуты */
export function clampSummary(text: string, limit = SUMMARY_LIMIT * 2): string {
  const flat = tidyText(text);
  return flat.length > limit ? `${flat.slice(0, limit - 1).replace(/\s+\S*$/, "")}…` : flat;
}
