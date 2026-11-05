// Выбор команды поиском (этап 74, просьба Арама 23.10.2026: «выпадающий список с департаментами очень неудобный,
// нужна строка поиска»). Чистые функции без React: окно выбора в шапке ищет и раскладывает команды по разделам,
// а тесты проверяют поиск и «Недавние» без браузера.
//
// Права здесь не считаются: на вход приходят только те команды, которые человек уже может выбрать (teamOptions на
// сервере). Поиск и разделы ничего к этому списку не добавляют, поэтому найти закрытую команду тут нельзя.

import { searchKey } from "./search-key";

/** Команда в окне выбора: название, место в дереве, как человек с ней связан и ФИО руководителя для второй строки */
export type TeamPick = {
  id: string;
  name: string;
  /** Отступ в списке: глубина в дереве команд */
  depth: number;
  relation: "member" | "leader" | "below" | "all";
  /** ФИО руководителя или null, если он не назначен */
  leader: string | null;
  /**
   * Название команды выше или null. Только если команда выше тоже видна человеку: иначе окно выбора назвало бы
   * команду, которой человек не видит
   */
  parent: string | null;
};

/**
 * Вторая строка пункта: по ней различают одноимённые команды разных руководителей (просьба Арама). Команда выше
 * дописывается, когда и руководитель совпал
 */
export function teamHint(leader: string | null, parent: string | null): string {
  // Слова те же, что в подсказке «Команда выше» (parentHint, этап 70): одна подсказка о команде на весь ресурс
  const who = leader ? `Руководитель: ${leader}` : "Руководитель не назначен";
  return parent ? `${who}, команда выше «${parent}»` : who;
}

/**
 * Подходит ли команда: каждое слово запроса есть в названии или в ФИО руководителя. По команде выше не ищем: иначе
 * запрос про одну команду вытаскивал бы все команды под ней
 */
export function matchTeam(team: Pick<TeamPick, "name" | "leader">, query: string): boolean {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = searchKey(`${team.name} ${team.leader ?? ""}`);
  return words.every((w) => hay.includes(w));
}

/**
 * Найденные команды: сначала те, где все слова запроса в названии, потом найденные только по руководителю. Внутри
 * каждой половины порядок дерева команд сохраняется
 */
export function filterTeams<T extends Pick<TeamPick, "name" | "leader">>(teams: T[], query: string): T[] {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (!words.length) return teams;
  const found = teams.filter((t) => matchTeam(t, query));
  const inName = (t: T) => {
    const name = searchKey(t.name);
    return words.every((w) => name.includes(w));
  };
  return [...found.filter(inName), ...found.filter((t) => !inName(t))];
}

export type TeamSectionKey = "mine" | "recent" | "all" | "found";
export type TeamSection<T> = { key: TeamSectionKey; title: string; items: T[] };

/**
 * Разделы окна выбора. Без запроса: «Ваши команды» (вы руководитель или участник), «Недавние» (выбранные раньше на
 * этом устройстве, кроме своих: свои и так сверху), «Все команды» по дереву. С запросом один раздел «Найдено»:
 * делить семь найденных команд на три раздела незачем
 */
export function teamSections<T extends TeamPick>(teams: T[], recent: string[], query: string): TeamSection<T>[] {
  if (searchKey(query)) return [{ key: "found", title: "Найдено", items: filterTeams(teams, query) }];
  const mine = teams.filter((t) => t.relation === "leader" || t.relation === "member");
  const own = new Set(mine.map((t) => t.id));
  const byId = new Map(teams.map((t) => [t.id, t]));
  // Команду могли закрыть или человека из неё убрать: такой id из «Недавних» просто пропадает
  const recentItems = recent.filter((id) => !own.has(id)).map((id) => byId.get(id)).filter((t): t is T => !!t);
  return [
    { key: "mine" as const, title: "Ваши команды", items: mine },
    { key: "recent" as const, title: "Недавние", items: recentItems },
    { key: "all" as const, title: "Все команды", items: teams },
  ].filter((s) => s.items.length > 0);
}

/** Сколько команд помнят «Недавние» */
export const RECENT_MAX = 5;

/** Выбранная команда встаёт первой, повтор не дублируется, хвост сверх пяти отпадает */
export function pushRecent(list: string[], id: string, max = RECENT_MAX): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, max);
}

/** Ключ хранилища: у каждого человека на устройстве свои «Недавние», на общем устройстве чужие не видны */
export const RECENT_PREFIX = "weekly-recent-teams:";

type KeyValue = Pick<Storage, "getItem" | "setItem">;

function storage(custom?: KeyValue | null): KeyValue | null {
  if (custom !== undefined) return custom;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Приватное окно или запрет на хранилище: обращение к localStorage само бросает
    return null;
  }
}

/**
 * «Недавние» человека с этого устройства. Хранилище запрещено, пусто или в нём мусор: пустой список, и выбор команды
 * работает как без «Недавних»
 */
export function readRecent(person: string, kv?: KeyValue | null): string[] {
  try {
    const raw = storage(kv)?.getItem(RECENT_PREFIX + person);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

/** Запомнить выбор и вернуть новый список. Хранилище запрещено или переполнено: выбор всё равно сработал */
export function rememberRecent(person: string, id: string, kv?: KeyValue | null): string[] {
  const next = pushRecent(readRecent(person, kv), id);
  try {
    storage(kv)?.setItem(RECENT_PREFIX + person, JSON.stringify(next));
  } catch {
    // Приватное окно или нет места: «Недавние» просто не запомнятся
  }
  return next;
}

/** Стереть «Недавние» всех людей с устройства: выход (этап 26 так же стирает черновики weekly) */
export function clearRecentTeams(kv?: Pick<Storage, "key" | "length" | "removeItem"> | null): void {
  try {
    const s = kv !== undefined ? kv : typeof window !== "undefined" ? window.localStorage : null;
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(RECENT_PREFIX)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // Хранилище запрещено: стирать нечего
  }
}
