// Сервер собирает снимок в пределах доступа (src/lib/registry.ts).
// PrototypeProvider передаёт его через RegistryContext без общего изменяемого списка людей и команд.

import { applyDictionaries, type DictEntry, type EditableDictKind } from "./dictionaries";
import { applyPeople, type PersonEntry } from "./people";
import { applyTeams, type TeamEntry } from "./teams";
import { setStaleDays } from "@/lib/tasks/rules";
import type { Role } from "./types";

/** Публичный справочник не содержит ролей и признаков отключения. Они есть только в управлении. */
export type DirectoryPerson = {
  slug: string;
  fullName: string;
  shortName: string;
  position?: string | null;
  selectable: boolean;
  role?: Role;
  active?: boolean;
  zone?: string;
  direction?: string;
};

export type RegistrySnapshot = {
  /** Отпечаток содержимого: пока он тот же, повторно ничего не подменяем */
  version: string;
  people: DirectoryPerson[];
  dicts: Record<EditableDictKind, DictEntry[]>;
  /** Порог «давно не обновлялась», дней */
  staleDays: number;
  /** Команды департамента (этап 14) */
  teams: TeamEntry[];
};

let applied = "";

/**
 * Совместимость старых unit-фикстур. Рабочие экраны не вызывают эту функцию:
 * их справочник изолирован контекстом конкретного рендера.
 */
export function applyRegistry(snapshot: RegistrySnapshot) {
  if (snapshot.version === applied) return;
  applyPeople(snapshot.people.filter((p): p is DirectoryPerson & PersonEntry => p.role !== undefined && p.active !== undefined && p.zone !== undefined && p.direction !== undefined));
  applyTeams(snapshot.teams ?? []);
  applyDictionaries(snapshot.dicts);
  setStaleDays(snapshot.staleDays);
  applied = snapshot.version;
}
