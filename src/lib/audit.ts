import { prisma } from "./db";
import type { ChangeSource, LoginMethod, Prisma } from "@/generated/prisma/client";

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
  via?: LoginMethod | null;
  /** Этап 71: запись во время входа владельца в чужой профиль (via OWNER_AS): кто из владельцев вошёл */
  asOwnerId?: string | null;
  asOwnerName?: string | null;
};

/** Кто из владельцев вошёл в профиль автора (этап 71): есть только у входа владельца, иначе null */
export type AsOwner = { id: string; fullName: string };

/**
 * Как вошёл автор, для записи журнала: способ входа и, во время входа владельца в чужой профиль (этап 71), кто из
 * владельцев вошёл. Все записи журнала от имени человека берут эти поля отсюда, а не только via: так пометка
 * «вошёл владелец» не теряется ни в одной записи (проверяют настоящие действия в tests/db/owner-as.test.ts)
 */
export function auditVia(actor: { via?: LoginMethod | null; asOwner?: AsOwner | null }): { via: LoginMethod | null; asOwnerId: string | null; asOwnerName: string | null } {
  return { via: actor.via ?? null, asOwnerId: actor.asOwner?.id ?? null, asOwnerName: actor.asOwner?.fullName ?? null };
}

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
        via: input.via ?? null,
        asOwnerId: input.asOwnerId ?? null,
        asOwnerName: input.asOwnerName ?? null,
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
  "management.password-mode": "Изменён источник пароля управления",
  // Этап 63: владелец смотрит приложение глазами другого человека, кого смотрели, в записи
  "viewAs.start": "Начат просмотр «Смотреть как»",
  "viewAs.stop": "Закончен просмотр «Смотреть как»",
  // Этап 71: владелец вошёл в профиль другого человека и вернулся в свой
  "ownerAs.start": "Вход владельца в профиль",
  "ownerAs.stop": "Возврат в свой профиль",
  logout: "Выход",
  "password.set": "Задан пароль",
  "setup.fail": "Неверный ключ первичной настройки",
  "backup.done": "Создана резервная копия",
  // Этап 76: раздел «Один на один» удалён миграцией, в записи только счёт пар, встреч, тем и задач из тем
  "system.oneOnOne.removed": "Раздел «Один на один» удалён",
  "backup.failed": "Резервная копия не создалась",
  "backup.check.ok": "Копия проверена: восстанавливается",
  "backup.check.failed": "Копия не восстановилась",
  "settings.news.source": "Источник новостей",
  "settings.news.keywords": "Ключевые слова новостей",
  "settings.news.fetch": "Забор новостей вручную",
  "settings.news.prefs": "Дайджест новостей",
  "task.create": "Задача создана",
  "task.propose": "Задача предложена",
  "task.update": "Задача изменена",
  "task.comment": "Комментарий к задаче",
  "task.archive": "Задача в архиве",
  "task.restore": "Задача из архива",
  "task.undo": "Действие отменено",
  "task.import": "Задача перенесена из таблицы",
  "task.bord": "Задача изменена в Bord",
  "task.renumber": "Номер задачи изменён",
  "task.handover": "Задача передана",
  "weekly.draft": "Weekly начат",
  "weekly.update": "Weekly изменён",
  "weekly.submit": "Weekly сдан",
  "weekly.reopen": "Weekly возвращён в черновик",
  "meeting.agenda": "Повестка встречи собрана",
  "meeting.item.add": "Пункт повестки добавлен",
  "meeting.item.remove": "Пункт повестки убран",
  "meeting.start": "Встреча начата",
  "meeting.close": "Встреча закрыта",
  "meeting.reopen": "Встреча открыта снова",
  "meeting.decision": "Решение встречи",
  "meeting.decision.cancel": "Решение отменено",
  "meeting.intake": "Приём из Notion",
  "meeting.parse.start": "Разбор встречи из Notion запущен",
  "meeting.parse.retry": "Разбор встречи из Notion повторён",
  "meeting.parse.done": "Встреча из Notion разобрана",
  "meeting.parse.fail": "Встречу из Notion не разобрали",
  "meeting.parse.edit": "Черновик разбора встречи сохранён",
  "meeting.parse.ceo": "Weekly для CEO отправлен",
  "meeting.parse.tasks": "Задачи из разбора встречи созданы",
  "weekly.promise": "Итог обещания",
  "weekly.forecast": "Прогноз месяца",
  "sync.numbers": "Недельный отчёт: цифры недели",
  "weekly.entry.create": "Запись weekly добавлена",
  "weekly.entry.update": "Запись weekly изменена",
  "weekly.entry.delete": "Запись weekly удалена",
  "weekly.entry.restore": "Удаление записи weekly отменено",
  "weekly.entry.ceo": "Отметка «В отчёт CEO»",
  "weekly.entry.author": "Автор записи назначен",
  "weekly.week.close": "Неделя закрыта",
  "weekly.week.open": "Неделя открыта",
  "weekly.import": "Weekly перенесён из таблицы",
  "weekly.absence.set": "Отмечено отсутствие на неделе",
  "weekly.absence.remove": "Отметка отсутствия снята",
  "data.reload": "База перезалита из выгрузки Bord",
  "ceo.save": "Отчёт CEO сохранён",
  "settings.dict.create": "Значение справочника добавлено",
  "settings.dict.rename": "Значение справочника переименовано",
  "settings.dict.hide": "Значение справочника скрыто",
  "settings.dict.show": "Значение справочника возвращено",
  "settings.person.create": "Человек добавлен",
  "settings.person.update": "Человек изменён",
  "settings.approval": "Согласование задач в другие департаменты",
  "task.approval": "Согласование задачи",
  "settings.person.disable": "Человек выключен",
  "settings.person.enable": "Человек включён",
  "settings.update": "Ритм недели изменён",
  "settings.banner": "Плашка над страницами изменена",
  "export.excel": "Выгрузка в Excel",
  "sync.revert": "Сверка вернула значение в таблице",
  "sync.rebuild": "Вкладки таблицы пересобраны",
  "sync.settings": "Изменена таблица для выгрузки",
  "sync.bord": "Изменён Bord для забора задач",
  "auth.login": "Личный вход",
  "auth.password.set": "Личный пароль задан",
  "auth.password.fail": "Неверный личный пароль",
  "auth.password.reset": "Личный пароль сброшен",
  "auth.invite.bulk": "Выданы ссылки всем без пароля",
  "settings.mail": "Изменены настройки писем",
  "settings.push": "Изменены уведомления в браузере",
  "auth.invite": "Выдана ссылка для входа",
  "auth.email-link": "Ссылка для входа отправлена на почту",
  "auth.email.request": "Почта указана, ждёт подтверждения",
  "auth.email.confirm": "Почта для входа подтверждена",
  "auth.email.cancel": "Подтверждение почты отменено",
  "auth.email.taken": "Почта не указана: адрес уже занят",
  "auth.device.revoke": "Вход на устройстве завершён",
  "auth.device.revoke-all": "Завершены все входы",
  "auth.team-login": "Изменён общий логин team",
  "request.create": "Просьба коллеге",
  "request.accept": "Просьба принята",
  "request.decline": "Просьба отклонена",
  "request.done": "Просьба выполнена",
  "request.withdraw": "Просьба отозвана",
  "request.remind": "Напоминание о просьбе",
  "request.task": "Просьба стала задачей",
  "request.reopen": "Просьба снова открыта",
  "goal.fact": "Факт цели",
  "plan.pull": "Прогноз месяца: загружены бюджет и LBE",
  "plan.adjust": "Прогноз месяца: корректировка драйвера",
  "plan.owners": "Прогноз месяца: команда продукта",
  "plan.source": "Прогноз месяца: источник LRF",
  "plan.check": "Прогноз месяца: прогноз проверен",
  "plan.facts": "Прогноз месяца: факт по дням",
  "plan.export": "Прогноз месяца: выгрузка в Excel",
  "market.upload": "Загружен пакет рынка КАСКО и ОСАГО",
  "content.import": "Загружено наполнение из истории проекта",
  // Этап 67г: пакет наполнения стирает решения, которые ставила загрузка; текст решения в поле «было»
  "decision.delete": "Решение стёрто",
  "settings.marketAccess": "Доступ к рынку КАСКО и ОСАГО",
  "settings.marketMeeting": "Разбор рынка на встрече",
};
