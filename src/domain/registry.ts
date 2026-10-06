// Люди и справочники из базы для экранов. Сервер собирает снимок (src/lib/registry.ts), layout передаёт его в PrototypeProvider,
// и тот подменяет им стартовые значения до отрисовки страниц. Снимок один для всех: правят его только владелец и администраторы.

import { applyDictionaries, type DictEntry, type EditableDictKind } from "./dictionaries";
import { applyPeople, type PersonEntry } from "./people";
import { applyTeams, type TeamEntry } from "./teams";
import type { PersonSlug } from "./types";
import { setStaleDays } from "@/lib/tasks/rules";

export type RegistrySnapshot = {
  /** Отпечаток содержимого: пока он тот же, повторно ничего не подменяем */
  version: string;
  people: PersonEntry[];
  dicts: Record<EditableDictKind, DictEntry[]>;
  /** Порог «давно не обновлялась», дней */
  staleDays: number;
  /** Команды департамента (этап 14) */
  teams: TeamEntry[];
};

let applied = "";

/**
 * team: люди выбранной команды. Ими становится список PEOPLE, из которого выбирают ответственных
 * и по которому строятся сводки команды. Без него PEOPLE: все включённые люди
 */
export function applyRegistry(snapshot: RegistrySnapshot, team?: { id: string | null; people: PersonSlug[] }) {
  const key = `${snapshot.version}|${team?.id ?? ""}|${team?.people.join(",") ?? ""}`;
  if (key === applied) return;
  applyPeople(snapshot.people, team?.people);
  applyTeams(snapshot.teams ?? []);
  applyDictionaries(snapshot.dicts);
  setStaleDays(snapshot.staleDays);
  applied = key;
}
