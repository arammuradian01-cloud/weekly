// Привязка новости к продуктам по ключевым словам и короткое описание по правилам (этап 60). Чистые функции.
//
// Слово ловится по началу слова: «страхов» в «страхование», «вклад» в «вкладов». Для коротких латинских и
// кириллических аббревиатур («РСА», «ВСС») того же правила хватает: они стоят отдельным словом.
// Описание: первые одна-две фразы анонса, не длиннее предела, без разметки и без повторения заголовка.

import { foldText } from "./keywords";

export const SUMMARY_LIMIT = 240;

/** Буквы и цифры любого алфавита: по ним определяется начало слова */
const WORD_CHAR = "\\p{L}\\p{N}";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const patternCache = new Map<string, RegExp>();

function patternOf(keyword: string): RegExp {
  const key = foldText(keyword);
  let re = patternCache.get(key);
  if (!re) {
    // Начало слова: начало строки или не буква перед. Конец не ограничен: ловим словоформы
    re = new RegExp(`(?:^|[^${WORD_CHAR}])${escapeRegExp(key).replace(/ /g, "\\s+")}`, "u");
    patternCache.set(key, re);
  }
  return re;
}

/** Какие ключевые слова продукта найдены в тексте */
export function matchedKeywords(text: string, keywords: string[]): string[] {
  const folded = foldText(text);
  if (!folded) return [];
  return keywords.filter((k) => k.trim() && patternOf(k).test(folded));
}

/**
 * Коды продуктов, к которым относится новость, в порядке списка продуктов. Заголовок весит столько же,
 * сколько анонс: достаточно одного слова в любом из них
 */
export function matchDirections(item: { title: string; description: string }, keywords: Record<string, string[]>, order: string[] = Object.keys(keywords)): string[] {
  const text = `${item.title}\n${item.description}`;
  return order.filter((code) => matchedKeywords(text, keywords[code] ?? []).length > 0);
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

/** Короткое описание по правилам: одна-две фразы анонса в пределах лимита. Пустой анонс даёт пустое описание */
export function ruleSummary(item: { title: string; description: string }, limit = SUMMARY_LIMIT): string {
  const description = item.description.replace(/\s+/g, " ").trim();
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

/** Обрезать описание из любого источника до предела, схлопнув пробелы */
export function clampSummary(text: string, limit = SUMMARY_LIMIT * 2): string {
  const flat = text.replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1).replace(/\s+\S*$/, "")}…` : flat;
}
