// Зеркало в Google только по своему департаменту (этап 86).
//
// Зеркало «Weekly: все задачи ресурса» (этап 6) пишет в Google-таблицу все задачи, комментарии и записи weekly.
// Пока в ресурсе один департамент, это и есть его работа. После раската на компанию в ресурсе появятся люди других
// департаментов, и их работа уехала бы в ту же таблицу, доступ к которой есть у этого департамента.
//
// Отбор включается переменной окружения SHEET_DEPARTMENT_ONLY=1 и по умолчанию выключен: включение меняет состав
// таблицы, а ночная сверка лишние строки из неё убирает, то есть удаляет чужие строки у владельца таблицы.
// Это решение владельца, а не техническая правка, поэтому код готов, а переменной на стенде пока нет.
//
// Чей департамент считается своим: департамент руководителя топ-команды (её ведёт директор департамента).
// Департамент человека считает тот же departmentOf, что и согласование задач в другие департаменты (этап 54).
// Если департамент определить нельзя (структура не загружена, у руководителя нет подразделения), отбор не
// включается: лучше выгрузить лишнее, чем молча потерять строки. Человек без подразделения тоже проходит: он ещё
// не в структуре, а его задачи уже в ресурсе.

import { prisma } from "@/lib/db";
import { departmentOf } from "@/lib/tasks/approval";
import { TOP_TEAM } from "@/domain/teams";

export function departmentOnly(env: { SHEET_DEPARTMENT_ONLY?: string } = process.env): boolean {
  const value = (env.SHEET_DEPARTMENT_ONLY ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "on" || value === "yes";
}

export type DepartmentGate = {
  /** Идёт ли отбор по департаменту */
  on: boolean;
  /** Название департамента, по которому отбирают, или null */
  name: string | null;
  /** Попадает ли работа человека (по короткому имени) в таблицу */
  allowsSlug: (slug: string | null | undefined) => boolean;
  /** То же по номеру человека в базе */
  allowsId: (id: string | null | undefined) => boolean;
};

/** Отбора нет: в таблицу идёт всё, как до этапа 86 */
export const ALL_DEPARTMENTS: DepartmentGate = { on: false, name: null, allowsSlug: () => true, allowsId: () => true };

/** Правило отбора для строк зеркала. Без переменной окружения ничего не читает из базы */
export async function loadDepartmentGate(): Promise<DepartmentGate> {
  if (!departmentOnly()) return ALL_DEPARTMENTS;
  const [units, people, top] = await Promise.all([
    prisma.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, headId: true, name: true } }),
    prisma.person.findMany({ select: { id: true, slug: true, unitId: true } }),
    prisma.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true } }),
  ]);
  const byUnit = new Map(units.map((u) => [u.id, u]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const bySlug = new Map(people.map((p) => [p.slug, p]));
  const leader = top?.leaderId ? byId.get(top.leaderId) : undefined;
  const own = departmentOf(byUnit, leader?.unitId ?? null);
  if (!own) return ALL_DEPARTMENTS;
  const allows = (unitId: string | null | undefined) => (unitId ? departmentOf(byUnit, unitId)?.id === own.id : true);
  return {
    on: true,
    name: own.name,
    allowsSlug: (slug) => (slug ? allows(bySlug.get(slug)?.unitId) : true),
    allowsId: (id) => (id ? allows(byId.get(id)?.unitId) : true),
  };
}
