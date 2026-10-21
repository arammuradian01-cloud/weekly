// Согласование и информирование (этап 54). Решение Арама 21.10: задача человеку из другого департамента проходит
// согласование его руководителя или руководитель о ней узнаёт, чтобы всегда понимать, чем занят его сотрудник.
// Где что включено, задаёт владелец в режиме управления: правило по умолчанию и отдельно для департаментов.
//
// Как устроено:
// - департамент человека: ближайшее подразделение уровня «департамент» над его местом в структуре; подразделение
//   прямо под компанией (клиентский сервис, HR) считается своим департаментом. Человек без места в структуре
//   правило не включает;
// - правило выбирается по департаменту ответственного: принимающая сторона решает, как к ней приходят задачи;
// - не срабатывает, когда ставит руководитель ответственного по линии подчинения, и когда ставят себе;
// - согласует административный руководитель ответственного, нет его: руководитель департамента ответственного.
//   Если согласовать должен тот же человек, кто ставит, согласование не нужно;
// - «Согласование»: задача приходит предложенной, принять её может только согласующий (или режим управления), сам
//   ответственный ждёт. «Информирование»: задача ставится как обычно, руководитель получает событие в «Мне».

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;

import { APPROVAL_KEY, approvalSettingOf, type ApprovalMode, type ApprovalSetting } from "./approval-modes";

export { APPROVAL_KEY, APPROVAL_MODES, APPROVAL_MODE_LABELS, DEFAULT_APPROVAL, approvalSettingOf, type ApprovalMode, type ApprovalSetting } from "./approval-modes";

export async function loadApprovalSetting(db: Db = prisma): Promise<ApprovalSetting> {
  const row = await db.setting.findUnique({ where: { key: APPROVAL_KEY } });
  return approvalSettingOf(row?.value);
}

type UnitLite = { id: string; kind: string; parentId: string | null; headId: string | null; name: string };

/** Департамент подразделения: уровень «департамент» выше по дереву, иначе подразделение прямо под компанией */
export function departmentOf(units: Map<string, UnitLite>, unitId: string | null): UnitLite | null {
  let cur = unitId ? units.get(unitId) : undefined;
  const seen = new Set<string>();
  let underCompany: UnitLite | null = null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.kind === "DEPARTMENT") return cur;
    if (cur.kind === "COMPANY") return underCompany ?? cur;
    const parent: UnitLite | undefined = cur.parentId ? units.get(cur.parentId) : undefined;
    if (parent?.kind === "COMPANY") underCompany = cur;
    if (!parent) return underCompany ?? cur;
    cur = parent;
  }
  return underCompany;
}

export type ApprovalRule = { mode: Exclude<ApprovalMode, "off">; approverId: string; department: string };

/**
 * Нужно ли согласование или информирование для задачи, которую creatorId ставит ownerId. null: правило не срабатывает
 */
export async function approvalRule(db: Db, creatorId: string, ownerId: string | null): Promise<ApprovalRule | null> {
  if (!ownerId || ownerId === creatorId) return null;
  const [setting, people, units] = await Promise.all([
    loadApprovalSetting(db),
    db.person.findMany({ where: { active: true }, select: { id: true, unitId: true, managerId: true } }),
    db.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, headId: true, name: true } }),
  ]);
  const byId = new Map(people.map((p) => [p.id, p]));
  const creator = byId.get(creatorId);
  const owner = byId.get(ownerId);
  if (!creator || !owner || !creator.unitId || !owner.unitId) return null;
  // Руководитель по линии подчинения ставит своим людям без согласования
  const seen = new Set<string>();
  for (let cur = owner.managerId; cur && !seen.has(cur); cur = byId.get(cur)?.managerId ?? null) {
    if (cur === creatorId) return null;
    seen.add(cur);
  }
  const unitMap = new Map(units.map((u) => [u.id, u]));
  const from = departmentOf(unitMap, creator.unitId);
  const to = departmentOf(unitMap, owner.unitId);
  if (!from || !to || from.id === to.id) return null;
  const mode = setting.departments[to.id] ?? setting.default;
  if (mode === "off") return null;
  const approverId = owner.managerId ?? to.headId;
  if (!approverId || approverId === creatorId || approverId === ownerId) return null;
  return { mode, approverId, department: to.name };
}

/** Департаменты для настройки: уровень «департамент» и подразделения прямо под компанией, по порядку дерева */
export async function approvalDepartments(db: Db = prisma): Promise<{ id: string; name: string }[]> {
  const units = await db.orgUnit.findMany({ where: { active: true }, select: { id: true, kind: true, parentId: true, name: true, sortOrder: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const company = units.find((u) => u.kind === "COMPANY");
  return units.filter((u) => u.kind === "DEPARTMENT" || (company && u.parentId === company.id)).map((u) => ({ id: u.id, name: u.name }));
}
