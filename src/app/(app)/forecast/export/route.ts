// Выгрузка прогноза месяца в Excel (этап 35): управление и команды продуктов при личном входе. Каждая выгрузка в журнале

import { currentActor } from "@/lib/action-runner";
import { writeAudit } from "@/lib/audit";
import { monthLabel } from "@/lib/forecast/codes";
import { canExportPlan, isMonth, monthPlan, ownersMap } from "@/lib/plan/service";
import { buildPlanExport } from "@/lib/plan/export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await currentActor();
  if (!canExportPlan(actor, await ownersMap())) {
    return new Response("Выгрузку прогноза берут владелец, администраторы и команды продуктов при личном входе", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const month = new URL(request.url).searchParams.get("month");
  const view = await monthPlan(actor, isMonth(month) ? month : null);
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
    via: actor.via ?? null,
  });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
