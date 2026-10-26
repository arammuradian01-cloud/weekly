// Настройки weekly по смысловым блокам (этап 66): список конкурентов для блока «Конкуренты» отчёта CEO. Меняет владелец
// в режиме управления, каждая правка в журнале.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { canManagePeople } from "@/lib/admin/service";
import type { Competitor } from "./assemble";
import { COMPETITORS_KEY, COMPETITOR_LIMITS, cleanCompetitors, competitorsOf } from "./competitors";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const listText = (list: Competitor[]) => list.map((c) => `${c.name}: ${c.keywords.join(", ")}`).join("\n");

/** Сохранить список конкурентов. Пустой список: блок «Конкуренты» всегда пустой и скрыт */
export async function saveCompetitors(actor: Actor, input: unknown): Promise<Competitor[]> {
  if (!canManagePeople(actor)) fail("Список конкурентов меняет владелец в режиме управления");
  if (Array.isArray(input) && input.length > COMPETITOR_LIMITS.count) fail(`Конкурентов не больше ${COMPETITOR_LIMITS.count}`);
  const list = cleanCompetitors(input);
  await prisma.$transaction(async (tx) => {
    const row = await tx.setting.findUnique({ where: { key: COMPETITORS_KEY } });
    const before = competitorsOf(row?.value ?? null);
    const value = list as unknown as Prisma.InputJsonValue;
    await tx.setting.upsert({ where: { key: COMPETITORS_KEY }, update: { value }, create: { key: COMPETITORS_KEY, value } });
    if (listText(before) !== listText(list)) {
      await tx.auditLog.create({
        data: { action: "ceo.competitors", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "settings", entityId: COMPETITORS_KEY, field: "Конкуренты в отчёте руководителю", before: listText(before) || undefined, after: listText(list) || undefined, ip: actor.ip ?? null, via: actor.via ?? null },
      });
    }
  });
  return list;
}
