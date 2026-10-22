// Выгрузка всех данных в Excel: только владелец в режиме управления. Каждая выгрузка пишется в журнал. События рынка
// в выгрузку попадают только при доступе к разделу «Рынок» (по общему логину его нет).

import { assertWritable, requestIp, requestViewAsTab, requireManagement } from "@/lib/auth";
import { ViewAsReadOnlyError } from "@/lib/view-as";
import { OWNER_ROLES } from "@/lib/roles";
import { writeAudit } from "@/lib/audit";
import { buildExport } from "@/lib/admin/export";
import { canSeeMarket } from "@/lib/market/access";
import { moscowIso } from "@/lib/tasks/dates";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireManagement(OWNER_ROLES, "/settings");
  // Выгрузка пишется в журнал от имени выгружающего: после конца просмотра «Смотреть как», пока владелец не вернулся
  // к себе, её нет (этап 63)
  try {
    assertWritable(ctx, await requestViewAsTab());
  } catch (error) {
    if (error instanceof ViewAsReadOnlyError) return new Response(error.message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    throw error;
  }
  // События рынка (этап 62) в листе «Журнал» только тому, кому открыт раздел «Рынок», как и в журнале на экране
  const { buffer, summary } = await buildExport({ market: await canSeeMarket({ personId: ctx.person.id, via: ctx.via }) });
  await writeAudit({
    action: "export.excel",
    actorId: ctx.person.id,
    actorName: ctx.person.fullName,
    entity: "export",
    entityId: "excel",
    field: "Выгрузка в Excel",
    after: `Задач ${summary.tasks}, записей weekly ${summary.entries}, событий журнала ${summary.audit}`,
    ip: await requestIp(),
  });
  const file = `weekly-${moscowIso(new Date())}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
