import "server-only";

// Действия страницы «Состояние» (этап 86). Пока одно: очистить список сбоев.
//
// Зачем кнопка. Предел FLOOD_MAX ограничивает скорость, а не объём: 50 записей в час за 90 дней хранения — это
// до ста тысяч строк, и часть из них с чужим текстом (обработчик /api/errors открыт без входа). Раньше у владельца
// не было никакого способа почистить error_events, кроме доступа к базе. Теперь есть кнопка, и она в журнале.
//
// Права как у всей страницы: только владелец в режиме управления и только при личном входе (режим управления по
// общему логину не включается с этапа 71). Смысл экрана это не меняет: кнопка убирает свои же технические записи,
// данных задач и weekly в них нет.

import { prisma } from "./db";
import { canManagePeople } from "./admin/service";
import { auditVia } from "./audit";
import { TaskRuleError, type Actor } from "./tasks/service";

export async function clearErrors(actor: Actor): Promise<{ removed: number }> {
  if (!canManagePeople(actor)) throw new TaskRuleError("Список сбоев очищает только владелец в режиме управления");
  const removed = await prisma.errorEvent.count();
  if (!removed) return { removed: 0 };
  await prisma.$transaction(async (tx) => {
    await tx.errorEvent.deleteMany();
    await tx.auditLog.create({
      data: {
        action: "errors.clear",
        actorId: actor.personId,
        actorName: actor.fullName,
        entity: "errors",
        field: "Список сбоев",
        after: `очищено записей: ${removed}`,
        ip: actor.ip ?? null,
        ...auditVia(actor),
      },
    });
  });
  return { removed };
}
