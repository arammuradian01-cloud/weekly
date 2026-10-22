// Настройка согласования задач в другие департаменты (этап 54): меняет владелец в режиме управления, каждая правка
// в журнале. Отдельно от правила, чтобы правило не тянуло проверки прав.

import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "./service";
import { APPROVAL_KEY, APPROVAL_MODE_LABELS, APPROVAL_MODES, approvalDepartments, loadApprovalSetting, type ApprovalMode, type ApprovalSetting } from "./approval";
import { auditVia } from "@/lib/audit";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export async function saveApprovalSetting(actor: Actor, input: ApprovalSetting): Promise<ApprovalSetting> {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") fail("Согласование задач настраивает владелец в режиме управления");
  const ok = (m: unknown): m is ApprovalMode => typeof m === "string" && (APPROVAL_MODES as string[]).includes(m);
  if (!ok(input?.default)) fail("Выберите правило по умолчанию");
  const known = new Map((await approvalDepartments()).map((d) => [d.id, d.name]));
  const departments: Record<string, ApprovalMode> = {};
  for (const [id, mode] of Object.entries(input.departments ?? {})) {
    if (!known.has(id)) continue;
    if (!ok(mode)) fail("Выберите правило из списка");
    // Выбор департамента хранится, даже если сейчас он совпадает с правилом по умолчанию: смена умолчания его не меняет.
    // «Как по умолчанию» в форме: департамента в настройке нет
    departments[id] = mode;
  }
  const next: ApprovalSetting = { default: input.default, departments };
  return prisma.$transaction(async (tx) => {
    const before = await loadApprovalSetting(tx);
    await tx.setting.upsert({ where: { key: APPROVAL_KEY }, update: { value: next }, create: { key: APPROVAL_KEY, value: next } });
    const lines: [string, string, string][] = [];
    if (before.default !== next.default) lines.push(["По умолчанию", APPROVAL_MODE_LABELS[before.default], APPROVAL_MODE_LABELS[next.default]]);
    for (const id of new Set([...Object.keys(before.departments), ...Object.keys(next.departments)])) {
      const a = before.departments[id] ?? before.default;
      const b = next.departments[id] ?? next.default;
      if (a !== b) lines.push([known.get(id) ?? id, APPROVAL_MODE_LABELS[a], APPROVAL_MODE_LABELS[b]]);
    }
    for (const [field, from, to] of lines) {
      await tx.auditLog.create({
        data: { action: "settings.approval", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "settings", entityId: APPROVAL_KEY, field: `Задачи в другие департаменты: ${field}`, before: from, after: to, ip: actor.ip ?? null, ...auditVia(actor) },
      });
    }
    return next;
  });
}
