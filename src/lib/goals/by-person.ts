// Цели по сотрудникам на экране «Цели»: чьи цели показать, как их сгруппировать и что лежит в адресе страницы.
// Чистые правила без базы и без React, их проверяют модульные тесты. Отбор людей чисто клиентский: он работает поверх
// целей, которые сервер уже отдал этому человеку, и новых прав не даёт

export type GoalGroupBy = "team" | "person";

/** Метка в адресе и в выборе для целей без владельца: таблица считает их целями руководителя команды. Подчёркивание: слаг человека её не повторит */
export const NO_OWNER = "_none";
export const NO_OWNER_LABEL = "Без владельца";

export type OwnerRef = { slug: string; fullName: string };
type Owned = { owner: OwnerRef | null };
type Grouped = Owned & { team: { id: string; name: string } };

/** Предел длины адреса: лишнее из ссылки отбрасываем, не ломая страницу */
const MAX_PEOPLE = 50;
const MAX_SLUG = 64;

const byName = (a: { label: string; key: string }, b: { label: string; key: string }) => a.label.localeCompare(b.label, "ru") || a.key.localeCompare(b.key);

/** Группировка в адресе: «group=team» по командам, любое другое значение и отсутствие по людям */
export function parseGroup(raw: string | null | undefined): GoalGroupBy {
  return raw === "team" ? "team" : "person";
}

/** Слаги людей из адреса «people=a,b»: без пустых, повторов и слишком длинных значений */
export function parsePeople(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const slug = part.trim();
    if (!slug || slug.length > MAX_SLUG || out.includes(slug)) continue;
    out.push(slug);
    if (out.length >= MAX_PEOPLE) break;
  }
  return out;
}

/** Адрес страницы «Цели» с кварталом, отбором людей и группировкой. Значения по умолчанию в адрес не пишутся */
export function goalsHref(p: { quarter?: string | null; people?: string[]; group?: GoalGroupBy }): string {
  const parts: string[] = [];
  if (p.quarter) parts.push(`q=${encodeURIComponent(p.quarter)}`);
  if (p.people?.length) parts.push(`people=${p.people.map(encodeURIComponent).join(",")}`);
  if (p.group === "team") parts.push("group=team");
  return parts.length ? `/goals?${parts.join("&")}` : "/goals";
}

/** Владельцы целей квартала по алфавиту: из них выбирают людей */
export function goalPeople(goals: Owned[]): OwnerRef[] {
  const bySlug = new Map<string, OwnerRef>();
  for (const g of goals) if (g.owner && !bySlug.has(g.owner.slug)) bySlug.set(g.owner.slug, { slug: g.owner.slug, fullName: g.owner.fullName });
  return [...bySlug.values()].sort((a, b) => byName({ label: a.fullName, key: a.slug }, { label: b.fullName, key: b.slug }));
}

export const hasUnowned = (goals: Owned[]): boolean => goals.some((g) => !g.owner);

/** У человека есть свои цели в этом квартале: без них «Мои цели» ни к чему не приведут */
export const hasOwnGoals = (goals: Owned[], me: string): boolean => goals.some((g) => g.owner?.slug === me);

/**
 * Выбор после смены квартала или команды: остаются только те, у кого в новых целях есть владелец (и «без владельца»,
 * если такие цели есть). Иначе человека, которого в списке уже нет, нельзя ни снять, ни увидеть
 */
export function pruneSelection(selected: string[], people: OwnerRef[], unowned: boolean): string[] {
  const known = new Set(people.map((p) => p.slug));
  const out: string[] = [];
  for (const slug of selected) {
    if (out.includes(slug)) continue;
    if (slug === NO_OWNER ? unowned : known.has(slug)) out.push(slug);
  }
  return out;
}

/** Цели выбранных людей; пустой выбор: все цели. Цели без владельца попадают только при выбранной метке NO_OWNER */
export function selectGoals<G extends Owned>(goals: G[], selected: string[]): G[] {
  if (!selected.length) return goals;
  const set = new Set(selected);
  return goals.filter((g) => set.has(g.owner ? g.owner.slug : NO_OWNER));
}

export type SelectionState = "all" | "mine" | "picked";

/** Три взаимоисключающих состояния отбора: все, только мои, выбранные (любой другой набор) */
export function selectionState(selected: string[], me: string): SelectionState {
  if (!selected.length) return "all";
  return selected.length === 1 && selected[0] === me ? "mine" : "picked";
}

/** Включить или выключить одного человека в выборе, порядок остальных сохраняется */
export function toggleSlug(selected: string[], slug: string, on: boolean): string[] {
  const rest = selected.filter((s) => s !== slug);
  return on ? [...rest, slug] : rest;
}

/** Подписи выбранных по алфавиту, «Без владельца» последней */
export function selectedLabels(selected: string[], nameOf: (slug: string) => string): string[] {
  return selected
    .map((slug) => ({ key: slug, label: slug === NO_OWNER ? NO_OWNER_LABEL : nameOf(slug) }))
    .sort((a, b) => (a.key === NO_OWNER ? 1 : b.key === NO_OWNER ? -1 : byName(a, b)))
    .map((x) => x.label);
}

export type GoalGroup<G> = { key: string; label: string; goals: G[] };

/**
 * Группы целей для карточек и таблицы, одно правило на оба вида. По людям: по алфавиту, «Без владельца» последней.
 * По командам: в порядке целей с сервера, цели департамента идут первыми, как и раньше. Внутри группы порядок целей
 * тоже с сервера
 */
export function groupGoals<G extends Grouped>(goals: G[], groupBy: GoalGroupBy): GoalGroup<G>[] {
  const out = new Map<string, GoalGroup<G>>();
  for (const g of goals) {
    const key = groupBy === "team" ? g.team.id : (g.owner?.slug ?? NO_OWNER);
    const label = groupBy === "team" ? g.team.name : (g.owner?.fullName ?? NO_OWNER_LABEL);
    const group = out.get(key);
    if (group) group.goals.push(g);
    else out.set(key, { key, label, goals: [g] });
  }
  const groups = [...out.values()];
  if (groupBy === "team") return groups;
  return groups.sort((a, b) => (a.key === NO_OWNER ? 1 : b.key === NO_OWNER ? -1 : byName(a, b)));
}
