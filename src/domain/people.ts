import type { Owner, Person, PersonSlug } from "./types";

// Совместимость чистых функций и старых unit-фикстур. В приложении используется RegistryContext:
// общий изменяемый PEOPLE не заполняется из серверного снимка.
export const PEOPLE: Person[] = [];

export type PersonEntry = Person & { active: boolean; position?: string | null };

const ALL_PEOPLE: PersonEntry[] = PEOPLE.map((p) => ({ ...p, active: true }));

/** Подменить стартовый состав людьми из базы. Массив PEOPLE меняется на месте: в нём все включённые люди, кроме наблюдателей */
export function applyPeople(list: PersonEntry[]) {
  ALL_PEOPLE.splice(0, ALL_PEOPLE.length, ...list);
  PEOPLE.splice(0, PEOPLE.length, ...list.filter((p) => p.active && p.role !== "OBSERVER").map(({ active: _active, position: _position, ...p }) => p));
}

/** Включённые люди из списка слагов в порядке из настроек: люди выбранной команды (этап 14) */
export function peopleOf(slugs: PersonSlug[]): Person[] {
  const set = new Set(slugs);
  return PEOPLE.filter((p) => set.has(p.slug));
}

/** Должность по структуре (этап 14): null, если структура не загружена */
export function positionOf(slug: PersonSlug): string | null {
  return ALL_PEOPLE.find((p) => p.slug === slug)?.position ?? null;
}

/** Все люди департамента, включённые и нет: для выбора людей вне выбранной команды */
export function allPeople(): PersonEntry[] {
  return ALL_PEOPLE;
}

export function personOf(slug: PersonSlug): Person {
  return ALL_PEOPLE.find((p) => p.slug === slug) ?? { slug, fullName: slug, shortName: slug, role: "LEADER", zone: "", direction: "department" };
}

export function ownerName(owner: Owner, short = false): string {
  if (owner === "all") return "Все лидеры";
  const p = personOf(owner);
  return short ? p.shortName : p.fullName;
}

/** «Арам М.» для плотных таблиц */
export function compactName(slug: PersonSlug): string {
  const [last, first] = personOf(slug).fullName.split(" ");
  return first ? `${first} ${last!.charAt(0)}.` : last!;
}

export function initials(slug: PersonSlug): string {
  const [last, first] = personOf(slug).fullName.split(" ");
  return first ? `${first.charAt(0)}${last!.charAt(0)}` : last!.slice(0, 2);
}

export function isPersonSlug(value: string | null | undefined): value is PersonSlug {
  return ALL_PEOPLE.some((p) => p.slug === value);
}

/** Автор записи или задачи. null: общая запись или задача со встречи без автора */
export function authorName(slug: PersonSlug | null, style: "short" | "compact" | "full" = "compact", empty = "Общее"): string {
  if (!slug) return empty;
  if (style === "short") return personOf(slug).shortName;
  if (style === "full") return personOf(slug).fullName;
  return compactName(slug);
}
