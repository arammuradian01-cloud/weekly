// Кто ответственный: ФИО из ячейки Bord в человека ресурса.
// В Bord имя пишут руками: «Рева Тарас», «Тарас Рева», «Рева Т.», «рева тарас», иногда двое через запятую.
// Совпадение ищем по точному имени, по тем же словам в другом порядке, по фамилии с инициалом,
// по одной фамилии или одному имени, только если такой человек один. Иначе имя считается новым.

export const ALL_LEADERS = "Все лидеры";

export type NamedPerson = { id: string; fullName: string; shortName: string };

/** Нижний регистр, ё как е, без точек и лишних пробелов */
export function normName(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[.\s]+/g, " ").trim();
}

const words = (value: string) => normName(value).split(" ").filter(Boolean);

/** Ячейка «Ответственный» в отдельные имена: запятая, точка с запятой, косая черта, перевод строки или « и ». Пометки в скобках отбрасываются */
export function splitOwners(cell: string): string[] {
  return cell
    .replace(/\([^)]*\)/g, " ")
    .split(/[,;/\n]+|\s+и\s+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export class NameIndex {
  private exact = new Map<string, NamedPerson>();
  private sorted = new Map<string, NamedPerson[]>();
  private initial = new Map<string, NamedPerson[]>();
  private single = new Map<string, NamedPerson[]>();
  private surnames = new Set<string>();

  constructor(people: NamedPerson[]) {
    for (const p of people) this.add(p);
  }

  add(p: NamedPerson) {
    const w = words(p.fullName);
    const push = (map: Map<string, NamedPerson[]>, key: string) => map.set(key, [...(map.get(key) ?? []).filter((x) => x.id !== p.id), p]);
    this.exact.set(w.join(" "), p);
    if (w[0]) this.surnames.add(w[0]);
    push(this.sorted, [...w].sort().join(" "));
    if (w.length >= 2) {
      // «Рева Т» и «Т Рева»: фамилия первым словом, как в Bord
      push(this.initial, `${w[0]} ${w[1]![0]}`);
      push(this.initial, `${w[1]![0]} ${w[0]}`);
    }
    for (const x of new Set([...w, ...words(p.shortName)])) push(this.single, x);
  }

  /**
   * Человек по имени из Bord. ambiguous: однозначно не сопоставить (например, «Евгений» при двух Евгениях
   * или знакомая фамилия с незнакомым именем), такое имя не считается новым человеком. Ни person, ни ambiguous: такого человека в ресурсе нет
   */
  find(name: string): { person?: NamedPerson; ambiguous?: boolean } {
    const w = words(name);
    if (!w.length) return {};
    const exact = this.exact.get(w.join(" "));
    if (exact) return { person: exact };
    // «Рева Тарас Олегович» и «Рева Т.А.»: берём фамилию и имя или фамилию и первый инициал
    const two = w.length >= 3 ? [w[0]!, w[1]!] : w;
    const exactTwo = w.length >= 3 ? this.exact.get(two.join(" ")) : undefined;
    if (exactTwo) return { person: exactTwo };
    const candidates = [
      this.sorted.get([...two].sort().join(" ")),
      two.length === 2 && (two[0]!.length === 1 || two[1]!.length === 1) ? this.initial.get(two.join(" ")) : undefined,
      w.length >= 3 ? this.initial.get(`${w[0]} ${w[1]![0]}`) : undefined,
      w.length === 1 ? this.single.get(w[0]!) : undefined,
    ];
    for (const list of candidates) {
      if (!list?.length) continue;
      return list.length === 1 ? { person: list[0]! } : { ambiguous: true };
    }
    // Фамилия как у человека ресурса, а имя не сходится: скорее опечатка, чем новый человек. Нового не заводим
    if (w.length >= 2 && this.surnames.has(w[0]!)) return { ambiguous: true };
    return {};
  }
}

/** Новое имя из Bord как ФИО человека: пробелы схлопнуты, каждое слово с заглавной */
export function personNameFromBord(name: string): { fullName: string; shortName: string } {
  const parts = name.replace(/\s+/g, " ").trim().split(" ");
  const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
  const fixed = parts.map((p) => (p === p.toLowerCase() || p === p.toUpperCase() ? cap(p.toLowerCase()) : p));
  return { fullName: fixed.join(" ").slice(0, 80), shortName: (fixed[1] ?? fixed[0] ?? name).slice(0, 30) };
}
