import { prisma } from "./db";
import type { ChangeSource, Prisma } from "@/generated/prisma/client";

export type AuditInput = {
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  source?: ChangeSource;
  entity?: string;
  entityId?: string;
  field?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Запись в журнал. Ошибка записи журнала не должна ронять действие пользователя, но попадает в лог сервера */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        source: input.source ?? "APP",
        entity: input.entity,
        entityId: input.entityId,
        field: input.field,
        before: input.before,
        after: input.after,
        ip: input.ip ?? null,
      },
    });
  } catch (error) {
    console.error("Не удалось записать событие в журнал", input.action, error);
  }
}

/** Человеческие названия событий для страницы журнала */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "login.success": "Вход по общему паролю",
  "login.fail": "Неверный логин или пароль",
  "login.blocked": "Попытка входа во время блокировки",
  "login.no-password": "Попытка входа до того, как задан пароль",
  "profile.choose": "Выбран профиль",
  "management.enter": "Включён режим управления",
  "management.fail": "Неверный пароль режима управления",
  "management.blocked": "Попытка режима управления во время блокировки",
  "management.exit": "Выключен режим управления",
  logout: "Выход",
  "password.set": "Задан пароль",
  "setup.fail": "Неверный ключ первичной настройки",
  "backup.done": "Создана резервная копия",
  "backup.failed": "Резервная копия не создалась",
  "backup.check.ok": "Копия проверена: восстанавливается",
  "backup.check.failed": "Копия не восстановилась",
  "task.create": "Задача создана",
  "task.propose": "Задача предложена",
  "task.update": "Задача изменена",
  "task.comment": "Комментарий к задаче",
  "task.archive": "Задача в архиве",
  "task.restore": "Задача из архива",
  "task.undo": "Действие отменено",
  "task.import": "Задача перенесена из таблицы",
  "weekly.draft": "Weekly начат",
  "weekly.update": "Weekly изменён",
  "weekly.submit": "Weekly сдан",
  "weekly.entry.create": "Запись weekly добавлена",
  "weekly.entry.update": "Запись weekly изменена",
  "weekly.entry.delete": "Запись weekly удалена",
  "weekly.entry.restore": "Удаление записи weekly отменено",
  "weekly.entry.ceo": "Отметка «В отчёт CEO»",
  "weekly.entry.author": "Автор записи назначен",
  "weekly.week.close": "Неделя закрыта",
  "weekly.week.open": "Неделя открыта",
  "weekly.import": "Weekly перенесён из таблицы",
  "ceo.save": "Отчёт CEO сохранён",
  "settings.dict.create": "Значение справочника добавлено",
  "settings.dict.rename": "Значение справочника переименовано",
  "settings.dict.hide": "Значение справочника скрыто",
  "settings.dict.show": "Значение справочника возвращено",
  "settings.person.create": "Человек добавлен",
  "settings.person.update": "Человек изменён",
  "settings.person.disable": "Человек выключен",
  "settings.person.enable": "Человек включён",
  "settings.update": "Ритм недели изменён",
  "export.excel": "Выгрузка в Excel",
  "sync.revert": "Сверка вернула значение в таблице",
  "sync.rebuild": "Вкладки таблицы пересобраны",
  "sync.settings": "Изменена таблица для выгрузки",
};
