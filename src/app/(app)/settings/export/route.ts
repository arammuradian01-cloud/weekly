// Выгрузка всех данных в Excel: только владелец в режиме управления. Каждая выгрузка пишется в журнал.

import { requestIp, requireManagement } from "@/lib/auth";
import { OWNER_ROLES } from "@/lib/roles";
import { writeAudit } from "@/lib/audit";
import { buildExport } from "@/lib/admin/export";
import { moscowIso } from "@/lib/tasks/dates";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireManagement(OWNER_ROLES, "/settings");
  const { buffer, summary } = await buildExport();
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
