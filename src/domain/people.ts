import type { Owner, Person, PersonSlug } from "./types";

// Люди приходят из базы (этап 5): layout передаёт их снимок, экран подменяет им стартовый состав ниже.
// PEOPLE: включённые люди, кроме наблюдателей; их выбирают в списках. Подписи старых записей берутся из полного списка
export const PEOPLE: Person[] = [
  { slug: "muradyan", fullName: "Мурадян Арам", shortName: "Арам", role: "OWNER", zone: "Департамент целиком", direction: "department" },
  { slug: "golovkin", fullName: "Головкин Владислав", shortName: "Влад", role: "ADMIN", zone: "Департамент, ОСАГО", direction: "osago" },
  { slug: "reva", fullName: "Рева Тарас", shortName: "Тарас", role: "LEADER", zone: "Продукт и CJM по всем линиям", direction: "product" },
  { slug: "loginova", fullName: "Логинова Светлана", shortName: "Света", role: "LEADER", zone: "RED: ДВС, ипотека, ВЗР, ИФЛ", direction: "red" },
  { slug: "fatyanov", fullName: "Фатьянов Евгений", shortName: "Евгений Ф.", role: "LEADER", zone: "КАСКО", direction: "kasko" },
  { slug: "sakhibullina", fullName: "Сахибуллина Алсу", shortName: "Алсу", role: "LEADER", zone: "Партнёрский канал", direction: "partners" },
  { slug: "afanasyev", fullName: "Афанасьев Павел", shortName: "Павел", role: "LEADER", zone: "Партнёрский канал", direction: "partners" },
  { slug: "cheychenets", fullName: "Чейченец Евгений", shortName: "Евгений Ч.", role: "LEADER", zone: "Депозиты и инвестиции", direction: "deposits" },
];

export type PersonEntry = Person & { active: boolean };

const ALL_PEOPLE: PersonEntry[] = PEOPLE.map((p) => ({ ...p, active: true }));

/** Подменить стартовый состав людьми из базы. Массив PEOPLE меняется на месте */
export function applyPeople(list: PersonEntry[]) {
  if (!list.length) return;
  ALL_PEOPLE.splice(0, ALL_PEOPLE.length, ...list);
  PEOPLE.splice(0, PEOPLE.length, ...list.filter((p) => p.active && p.role !== "OBSERVER").map(({ active: _active, ...p }) => p));
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
