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

/** avatar: версия фото профиля (этап 80) или null, если фото нет: тогда инициалы */
export type PersonEntry = Person & { active: boolean; position?: string | null; avatar?: number | null };

const ALL_PEOPLE: PersonEntry[] = PEOPLE.map((p) => ({ ...p, active: true }));

/** Подменить стартовый состав людьми из базы. Массив PEOPLE меняется на месте: в нём все включённые люди, кроме наблюдателей */
export function applyPeople(list: PersonEntry[]) {
  if (!list.length) return;
  ALL_PEOPLE.splice(0, ALL_PEOPLE.length, ...list);
  PEOPLE.splice(0, PEOPLE.length, ...list.filter((p) => p.active && p.role !== "OBSERVER").map(({ active: _active, position: _position, avatar: _avatar, ...p }) => p));
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

/** Фото профиля для аватара (этап 80): короткое имя и версия, или null, если фото нет */
export type AvatarPhoto = { slug: string; version: number };

export function avatarPhoto(slug: PersonSlug | null | undefined): AvatarPhoto | null {
  if (!slug) return null;
  const version = ALL_PEOPLE.find((p) => p.slug === slug)?.avatar;
  return typeof version === "number" ? { slug, version } : null;
}

/** Адрес картинки: крупная 256 для карточки и больших аватаров, мелкая 64 для списков */
export function avatarSrc(photo: AvatarPhoto, size: "large" | "small"): string {
  return `/api/avatar/${encodeURIComponent(photo.slug)}?v=${photo.version}${size === "small" ? "&size=64" : ""}`;
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
