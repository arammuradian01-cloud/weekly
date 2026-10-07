// Упоминания @имя (этап 20): чистые функции без базы, общие для сервера и экрана.
//
// Упомянуть можно так, как подставляет подсказка: «@Рева Тарас» (как в списке людей), «@Тарас Рева» или коротким
// именем «@Тарас», если такое короткое имя в департаменте одно. Совпадение ищется самое длинное: «@Евгений Ф.»
// не превращается в «@Евгений». Регистр и ё не важны. Имя должно кончаться на границе слова: «@Тарасу» не упоминание.

export type MentionPerson = { id: string; fullName: string; shortName: string };

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const letter = /[\p{L}\p{N}]/u;

/** Как упоминание может быть написано: полное имя, имя с фамилией, короткое имя (если оно у одного человека) */
export function mentionNames(people: MentionPerson[]): { name: string; id: string }[] {
  const shortCount = new Map<string, number>();
  for (const p of people) shortCount.set(norm(p.shortName.trim()), (shortCount.get(norm(p.shortName.trim())) ?? 0) + 1);
  const out: { name: string; id: string }[] = [];
  for (const p of people) {
    const full = p.fullName.trim().replace(/\s+/g, " ");
    out.push({ name: norm(full), id: p.id });
    const [last, first, ...rest] = full.split(" ");
    if (first && !rest.length) out.push({ name: norm(`${first} ${last}`), id: p.id });
    const short = norm(p.shortName.trim());
    if (short && shortCount.get(short) === 1) out.push({ name: short, id: p.id });
  }
  // Длинные имена первыми: «евгений ф.» раньше «евгений»
  return out.sort((a, b) => b.name.length - a.name.length);
}

export type MentionSpan = { start: number; end: number; id: string };

/** Где в тексте упоминания и кого они называют. Один человек может быть упомянут несколько раз */
export function findMentionSpans(text: string, people: MentionPerson[]): MentionSpan[] {
  if (!text.includes("@") || !people.length) return [];
  const names = mentionNames(people);
  const low = norm(text);
  const spans: MentionSpan[] = [];
  for (let i = low.indexOf("@"); i >= 0; i = low.indexOf("@", i + 1)) {
    // «почта@домен» не упоминание: перед @ не должно быть буквы или цифры
    if (i > 0 && letter.test(low[i - 1]!)) continue;
    const rest = low.slice(i + 1);
    // Имя на точке («Евгений Ф.») уже кончилось: граница слова после точки не нужна
    const hit = names.find((n) => rest.startsWith(n.name) && (n.name.endsWith(".") || !letter.test(rest[n.name.length] ?? "")));
    if (!hit) continue;
    spans.push({ start: i, end: i + 1 + hit.name.length, id: hit.id });
    i += hit.name.length;
  }
  return spans;
}

/** id упомянутых людей без повторов, в порядке появления */
export function findMentions(text: string, people: MentionPerson[]): string[] {
  return [...new Set(findMentionSpans(text, people).map((s) => s.id))];
}

/** Кусок текста перед курсором, если человек сейчас набирает упоминание: «@Ре» даёт «Ре». null: не набирает */
export function mentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && letter.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  // Подсказка живёт, пока набирают имя: до двух слов, без перевода строки
  if (query.length > 40 || /\n/.test(query) || query.split(" ").length > 3) return null;
  return { query, start: at };
}

/** Люди для подсказки: имя или фамилия начинается с набранного */
export function mentionSuggestions<T extends MentionPerson>(people: T[], query: string, limit = 6): T[] {
  const q = norm(query.trim());
  const scored = people
    .map((p) => {
      const full = norm(p.fullName);
      const words = full.split(" ");
      const reversed = words.length === 2 ? `${words[1]} ${words[0]}` : full;
      const short = norm(p.shortName);
      const rank = !q ? 2 : full.startsWith(q) || reversed.startsWith(q) || short.startsWith(q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : -1;
      return { p, rank };
    })
    .filter((x) => x.rank >= 0);
  return scored
    .sort((a, b) => a.rank - b.rank || a.p.fullName.localeCompare(b.p.fullName, "ru"))
    .slice(0, limit)
    .map((x) => x.p);
}
