// Выгрузка прогноза месяца в Excel (этап 35): управление и команды продуктов при личном входе. Каждая выгрузка в журнале

import { writingActor } from "@/lib/action-runner";
import { ViewAsReadOnlyError } from "@/lib/view-as";
import type { Actor } from "@/lib/tasks/service";
import { writeAudit, auditVia } from "@/lib/audit";
import { monthLabel } from "@/lib/forecast/codes";
import { canExportPlan, isMonth, monthPlan, ownersMap } from "@/lib/plan/service";
import { buildPlanExport } from "@/lib/plan/export";
import { canSeeNumbers } from "@/lib/plan/access";

export const dynamic = "force-dynamic";

const TEXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };

export async function GET(request: Request) {
  // Выгрузка пишется в журнал от имени того, кто выгружает: в режиме «Смотреть как» её нет (этап 63)
  let actor: Actor;
  try {
    actor = await writingActor();
  } catch (error) {
    if (error instanceof ViewAsReadOnlyError) return new Response(error.message, { status: 403, headers: TEXT });
    throw error;
  }
  if (!(await canSeeNumbers(actor)) || !canExportPlan(actor, await ownersMap())) {
    return new Response("Выгрузку прогноза берут владелец, администраторы и команды продуктов при личном входе", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const month = new URL(request.url).searchParams.get("month");
  // Выгрузке разрез по СК не нужен
  const view = await monthPlan(actor, isMonth(month) ? month : null, new Date(), null, { sk: false });
  if (view.empty) return new Response(`Прогноз на ${view.monthLabel} ещё не начат`, { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const { buffer, file, rows } = await buildPlanExport(view);
  await writeAudit({
    action: "plan.export",
    actorId: actor.personId,
    actorName: actor.fullName,
    entity: "plan",
    entityId: view.month,
    field: `Прогноз месяца в Excel, ${monthLabel(view.month)}`,
    after: `строк ${rows}`,
    ip: actor.ip ?? null,
    ...auditVia(actor),
  });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
