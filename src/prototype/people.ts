import type { Owner, Person, PersonSlug } from "./types";

// Тот же состав, что в prisma/seed-data.ts. Аналитик и CEO выключены и в прототип не попадают
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

export function personOf(slug: PersonSlug): Person {
  return PEOPLE.find((p) => p.slug === slug)!;
}

export function ownerName(owner: Owner, short = false): string {
  if (owner === "all") return "Все лидеры";
  const p = personOf(owner);
  return short ? p.shortName : p.fullName;
}

/** «Арам М.» для плотных таблиц */
export function compactName(slug: PersonSlug): string {
  const [last, first] = personOf(slug).fullName.split(" ");
  return `${first} ${last!.charAt(0)}.`;
}

export function initials(slug: PersonSlug): string {
  const [last, first] = personOf(slug).fullName.split(" ");
  return `${first!.charAt(0)}${last!.charAt(0)}`;
}

export function isPersonSlug(value: string | null | undefined): value is PersonSlug {
  return PEOPLE.some((p) => p.slug === value);
}
