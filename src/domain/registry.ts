// Люди и справочники из базы для экранов. Сервер собирает снимок (src/lib/registry.ts), layout передаёт его в PrototypeProvider,
// и тот подменяет им стартовые значения до отрисовки страниц. Снимок один для всех: правят его только владелец и администраторы.

import { applyDictionaries, type DictEntry, type EditableDictKind } from "./dictionaries";
import { applyPeople, type PersonEntry } from "./people";
import { applyTeams, type TeamEntry } from "./teams";
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
 * Снимок общий для всех: подменяется на месте и на сервере, и в браузере. Поэтому люди выбранной команды сюда
 * не попадают: они у каждого свои и приходят через контекст экрана (usePrototype().teamPeople, этап 14)
 */
export function applyRegistry(snapshot: RegistrySnapshot) {
  if (snapshot.version === applied) return;
  applyPeople(snapshot.people);
  applyTeams(snapshot.teams ?? []);
  applyDictionaries(snapshot.dicts);
  setStaleDays(snapshot.staleDays);
  applied = snapshot.version;
}
