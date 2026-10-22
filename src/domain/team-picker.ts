// Выбор команды поиском (этап 74, просьба Арама 23.10.2026: «выпадающий список с департаментами очень неудобный, нужна
// строка поиска»). Чистые функции без React: окно выбора в шапке и поля «Команда» в формах ищут одинаково, тесты
// проверяют поиск и «Недавние» без браузера.

import { searchKey } from "./search-key";
import { teamOf } from "./teams";
import { personOf } from "./people";

/** Команда в окне выбора: название, место в дереве, руководитель и команда выше, чтобы различать одноимённые */
export type TeamPick = {
  id: string;
  name: string;
  depth: number;
  relation: "member" | "leader" | "below" | "all";
  /** ФИО руководителя или null, если он не назначен */
  leader: string | null;
  /** Название команды выше или null у верхней */
  parent: string | null;
};

/** Вторая строка пункта: руководитель и команда выше */
export function teamHint(leader: string | null, parent: string | null): string {
  const who = leader ? `Руководитель ${leader}` : "Руководитель не назначен";
  return parent ? `${who}, команда выше «${parent}»` : who;
}

/** Подходит ли команда: каждое слово запроса есть в названии или в ФИО руководителя. Команда выше в поиск не входит */
export function matchTeam(team: Pick<TeamPick, "name" | "leader">, query: string): boolean {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = searchKey(`${team.name} ${team.leader ?? ""}`);
  return words.every((w) => hay.includes(w));
}

/**
 * Найденные команды: сначала те, где запрос целиком в названии, потом найденные по руководителю. Внутри порядок
 * структуры сохраняется
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

export type TeamSection<T> = { key: "mine" | "recent" | "all" | "found"; title: string; items: T[] };

/**
 * Разделы окна выбора. Без запроса: «Ваши команды» (руководитель или участник), «Недавние» (выбранные раньше, кроме
 * своих), «Все команды» по структуре. С запросом один раздел «Найдено»
 */
export function teamSections<T extends TeamPick>(teams: T[], recent: string[], query: string): TeamSection<T>[] {
  if (searchKey(query)) return [{ key: "found", title: "Найдено", items: filterTeams(teams, query) }];
  const mine = teams.filter((t) => t.relation === "leader" || t.relation === "member");
  const own = new Set(mine.map((t) => t.id));
  const byId = new Map(teams.map((t) => [t.id, t]));
  const recentItems = recent.filter((id) => !own.has(id)).map((id) => byId.get(id)).filter((t): t is T => !!t);
  return [
    { key: "mine" as const, title: "Ваши команды", items: mine },
    { key: "recent" as const, title: "Недавние", items: recentItems },
    { key: "all" as const, title: "Все команды", items: teams },
  ].filter((s) => s.items.length > 0);
}

/** Сколько команд помнит «Недавние» */
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
    return null;
  }
}

/** «Недавние» человека с устройства. Хранилище запрещено или в нём мусор: пустой список */
export function readRecent(person: string, kv?: KeyValue | null): string[] {
  try {
    const raw = storage(kv)?.getItem(RECENT_PREFIX + person);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Запомнить выбор. Хранилище запрещено или переполнено: выбор команды работает и без «Недавних» */
export function rememberRecent(person: string, id: string, kv?: KeyValue | null): string[] {
  const next = pushRecent(readRecent(person, kv), id);
  try {
    storage(kv)?.setItem(RECENT_PREFIX + person, JSON.stringify(next));
  } catch {
    // Приватный режим или нет места: список останется прежним
  }
  return next;
}

/** Стереть «Недавние» всех людей на устройстве: выход (этап 26 стирает так же черновики) */
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
    // Хранилище запрещено
  }
}

/**
 * Варианты поля «Команда» в формах (этап 74): название и вторая строка с руководителем и командой выше из снимка
 * справочников. Команды нет в снимке: без второй строки
 */
export function teamPickerOptions(list: { id: string; name: string }[]): { value: string; label: string; hint: string | null }[] {
  return list.map((t) => {
    const entry = teamOf(t.id);
    return {
      value: t.id,
      label: t.name,
      hint: entry ? teamHint(entry.leader ? personOf(entry.leader).fullName : null, entry.parent ? (teamOf(entry.parent)?.name ?? null) : null) : null,
    };
  });
}
