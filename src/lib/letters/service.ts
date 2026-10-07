// Письма ресурса (этап 20): адресные события «Мне», напоминания о сдаче weekly и дайджест в день встречи.
//
// Правила плана Weekly 2.0:
// - кроме ссылок для входа, адресных событий, напоминаний и дайджеста ресурс ничего сам не рассылает;
// - в письме только кто, что и ссылка, содержимое видно после входа;
// - адресное событие уходит письмом, если его не увидели в ресурсе за 15 минут, события одного человека за проход
//   склеиваются в одно письмо, вне рабочих часов копятся до утренней сводки;
// - напоминаний о сдаче не больше двух в неделю, отпуск и сданный weekly снимают их;
// - каждый тип писем отключается в профиле.
//
// Цикл живёт в процессе сервера, как выгрузка в таблицу. Аренда в базе не даёт двум контейнерам во время выкладки
// отправить одно письмо дважды.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { mailConfigured, sendMail } from "@/lib/mail";
import type { InboxKind } from "@/generated/prisma/enums";
import { loadTeamNodes, TOP_TEAM, type TeamNode } from "@/lib/org/scope";
import { closedFor, expectedOf, leadersOf, personDeadline, teamMeeting } from "@/lib/org/rhythm";
import { currentReportingKey, ensureWeek, weekSettings } from "@/lib/weekly/service";
import { meetingOf, shiftWeek, weekKeyOf } from "@/lib/weekly/weeks";
import { formatMoment, moscowDate } from "@/lib/week";
import { fromCalendar, toCalendar, type IsoDate } from "@/domain/dates";
import type { WeekKey } from "@/domain/types";
import { readersOf, seesEntry } from "@/lib/discuss/access";
import { inboxCount } from "@/lib/inbox/service";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { EVENT_DELAY_MS, EVENT_MAX_AGE_MS, PREF_LABELS, digestDue, inWorkHours, outsideWorkHours, prefOfKind, prefsOf, reminderDue, type MailPrefs } from "./schedule";

const TICK_MS = 60_000;
const LEASE = "5 minutes";

function appUrl(): string {
  return (process.env.APP_URL ?? "").replace(/\/+$/, "");
}

// ---------- Тексты ----------

export type EventLine = { kind: InboxKind; actorName: string | null; taskNumber: number | null; entryId: string | null; commentId: string | null; requestNumber?: number | null };

/** Одна строка письма о событии: кто и что, без содержимого. Без глаголов с родом: «Рева Тарас: упоминание в задаче 47» */
export function eventPhrase(e: EventLine): string {
  const who = e.actorName ? `${e.actorName}: ` : "";
  const n = e.taskNumber ? ` ${e.taskNumber}` : "";
  switch (e.kind) {
    case "TASK_ASSIGNED":
      return `${who}вам поручена задача${n}`;
    case "TASK_PROPOSED":
      return `${who}предложение задачи${n}`;
    case "TASK_CONFIRMED":
      return `${who}задача${n} подтверждена`;
    case "TASK_COEXECUTOR":
      return `${who}вы соисполнитель в задаче${n}`;
    case "TASK_COMMENT":
      return `${who}комментарий в задаче${n}`;
    case "TASK_DUE":
      return `Срок по задаче${n}`;
    case "UPDATE_REQUEST":
      return `${who}просьба обновить задачу${n}`;
    case "TASK_WATCH":
      return `${who}изменения в задаче${n}, за которой вы следите`;
    case "MENTION":
      return e.entryId ? `${who}упоминание в записи weekly` : `${who}упоминание в задаче${n}`;
    case "ENTRY_COMMENT":
      return `${who}комментарий к записи weekly`;
    case "REACTION":
      return e.entryId ? `${who}реакция на ${e.commentId ? "ваш комментарий к записи weekly" : "вашу запись weekly"}` : `${who}реакция на ваш комментарий в задаче${n}`;
    case "REQUEST":
      return `${who}просьба к вам`;
    case "THANKS":
      return `${who}благодарность в weekly`;
    case "MEETING":
      return `${who}встреча: протокол или решение`;
    case "TASK_DEPENDENCY":
      return `${who}изменения по связанной задаче${n}`;
    case "REQUEST_ANSWER":
      return `${who}изменения по просьбе`;
    default:
      return `${who}новое событие`;
  }
}

function linkOf(e: { taskNumber: number | null; entryId: string | null; requestNumber?: number | null }): string {
  if (e.requestNumber) return `${appUrl()}/requests/${e.requestNumber}`;
  if (e.taskNumber) return `${appUrl()}/tasks/${e.taskNumber}`;
  if (e.entryId) return `${appUrl()}/weekly/entry/${e.entryId}`;
  return `${appUrl()}/me`;
}

const footer = () => `\n\nНастроить письма: ${appUrl()}/profile\nВ письме только кто и что. Подробности видны после входа в ресурс.`;

/** Письмо о событиях одного человека: строка на предмет, свежий предмет сверху */
export function eventsMail(person: { shortName: string }, items: (EventLine & { subject: string; createdAt: Date })[]): { subject: string; text: string } {
  const bySubject = new Map<string, { last: EventLine & { createdAt: Date }; count: number }>();
  for (const e of [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    const found = bySubject.get(e.subject);
    if (found) found.count += 1;
    else bySubject.set(e.subject, { last: e, count: 1 });
  }
  const groups = [...bySubject.values()];
  const night = items.some((e) => outsideWorkHours(e.createdAt));
  const lines = groups.map((g) => `${eventPhrase(g.last)}${g.count > 1 ? ` (и ещё ${g.count - 1})` : ""}\n${linkOf(g.last)}`);
  const subject = groups.length === 1 ? `Weekly: ${eventPhrase(groups[0]!.last)}` : `Weekly: ${groups.length} ${plural(groups.length, ["событие", "события", "событий"])} ждут вас`;
  const head = night ? "Пока вас не было в ресурсе:" : "Вас ждут в ресурсе:";
  const text = `Здравствуйте, ${person.shortName}.\n\n${head}\n\n${lines.join("\n\n")}\n\nВсё, что ждёт вас: ${appUrl()}/me${footer()}`;
  return { subject, text };
}

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

// ---------- Аренда ----------

const g = globalThis as unknown as { __mailOwner?: string; __mailLoop?: ReturnType<typeof setTimeout> };

async function leased<T>(fn: () => Promise<T>): Promise<T | null> {
  g.__mailOwner ??= randomUUID();
  const owner = g.__mailOwner;
  const got = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "settings" ("key", "value", "updatedAt")
    VALUES ('mail.lock', jsonb_build_object('owner', ${owner}::text, 'until', now() + ${LEASE}::interval), now())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE ("settings"."value"->>'until')::timestamptz < now() OR "settings"."value"->>'owner' = ${owner}::text
    RETURNING "key"`;
  if (!got.length) return null;
  try {
    return await fn();
  } finally {
    await prisma.$executeRaw`
      UPDATE "settings" SET "value" = jsonb_build_object('owner', '', 'until', now() - interval '1 second'), "updatedAt" = now()
      WHERE "key" = 'mail.lock' AND "value"->>'owner' = ${owner}::text`;
  }
}

// ---------- Адресные события ----------

export type PassResult = { sent: number; skipped: number; failed: number };

/**
 * Письма о непрочитанных событиях. Событие берётся один раз: ему ставится отметка «письмо ушло или не нужно».
 * Не уходит письмо о том, что человек уже видел, разобрал или отложил, о старом, без почты и при выключенной настройке.
 * Сбой отправки возвращает события в очередь: следующий проход попробует снова
 */
export async function eventMailPass(now = new Date()): Promise<PassResult> {
  if (!inWorkHours(now)) return { sent: 0, skipped: 0, failed: 0 };
  const cutoff = new Date(now.getTime() - EVENT_DELAY_MS);
  const claimed = await prisma.$transaction(async (tx) => {
    // Увиденное, разобранное и слишком старое письма не ждёт: отмечаем сразу, чтобы очередь не росла
    await tx.$executeRaw`
      UPDATE "inbox_events" SET "mailedAt" = ${now}
      WHERE "mailedAt" IS NULL AND "createdAt" <= ${cutoff} AND ("seenAt" IS NOT NULL OR "doneAt" IS NOT NULL OR "createdAt" < ${new Date(now.getTime() - EVENT_MAX_AGE_MS)})`;
    // Кому пора писать: есть непрочитанное событие старше 15 минут. Увиденное, разобранное и отложенное не в счёт. Берём все его непрочитанные события сразу, и свежие тоже:
    // серия событий за несколько минут уходит одним письмом, а не письмом в минуту
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "inbox_events"
      WHERE "mailedAt" IS NULL
        AND "recipientId" IN (
          SELECT DISTINCT "recipientId" FROM "inbox_events"
          WHERE "mailedAt" IS NULL AND "createdAt" <= ${cutoff} AND "seenAt" IS NULL AND "doneAt" IS NULL AND ("snoozeUntil" IS NULL OR "snoozeUntil" <= ${now})
        )
      ORDER BY "createdAt" LIMIT 2000 FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await tx.inboxEvent.updateMany({ where: { id: { in: ids } }, data: { mailedAt: now } });
    return tx.inboxEvent.findMany({
      where: { id: { in: ids } },
      include: { task: { select: { number: true } }, request: { select: { number: true } }, recipient: { select: { id: true, email: true, active: true, mailPrefs: true, shortName: true } } },
    });
  });
  if (!claimed.length) return { sent: 0, skipped: 0, failed: 0 };
  const configured = mailConfigured();
  const minAt = now.getTime() - EVENT_MAX_AGE_MS;
  const wanted = claimed.filter(
    (e) =>
      configured &&
      !e.doneAt &&
      !e.seenAt &&
      !(e.snoozeUntil && e.snoozeUntil > now) &&
      e.createdAt.getTime() >= minAt &&
      e.recipient.active &&
      !!e.recipient.email &&
      prefsOf(e.recipient.mailPrefs)[prefOfKind(e.kind)],
  );
  const byPerson = new Map<string, typeof wanted>();
  for (const e of wanted) byPerson.set(e.recipientId, [...(byPerson.get(e.recipientId) ?? []), e]);
  let sent = 0;
  let failed = 0;
  const queue = [...byPerson.values()];
  for (let i = 0; i < queue.length; i++) {
    const events = queue[i]!;
    const person = events[0]!.recipient;
    const mail = eventsMail(
      person,
      events.map((e) => ({
        kind: e.kind,
        actorName: e.actorName,
        taskNumber: e.task?.number ?? null,
        entryId: e.entryId,
        commentId: e.commentId ?? e.entryCommentId,
        requestNumber: e.request?.number ?? null,
        subject: e.subject,
        createdAt: e.createdAt,
      })),
    );
    try {
      await sendMail({ to: person.email!, ...mail });
      sent += 1;
    } catch (error) {
      failed += 1;
      // Адрес отклонён: повторять бессмысленно. Сервер недоступен: возвращаем в очередь всё, что ещё не ушло, и ждём
      if (!isTransportDown(error)) {
        console.error("Письмо о событиях отклонено, повторять не будем:", error instanceof Error ? error.message : error);
        continue;
      }
      console.error("Почтовый сервер недоступен, письма о событиях повторим позже:", error instanceof Error ? error.message : error);
      const rest = queue.slice(i).flat();
      await prisma.inboxEvent.updateMany({ where: { id: { in: rest.map((e) => e.id) } }, data: { mailedAt: null } });
      break;
    }
  }
  return { sent, skipped: claimed.length - wanted.length, failed };
}

/**
 * Ошибка почтового сервера, а не адреса: нет связи, таймаут, вход не прошёл. Тогда проход останавливается и всё
 * повторяется через минуту. Отклонённый адрес (EENVELOPE, ответ 5xx на получателя) повторять бессмысленно
 */
export function isTransportDown(error: unknown): boolean {
  const e = error as { code?: string; responseCode?: number } | null;
  // Временный отказ получателя (4xx) повторяем, постоянный (5xx) нет
  if (e?.code === "EENVELOPE") return typeof e.responseCode === "number" && e.responseCode >= 400 && e.responseCode < 500;
  if (typeof e?.responseCode === "number" && e.responseCode >= 500 && e.responseCode < 600 && e.code !== "EAUTH") return false;
  return true;
}

// ---------- Напоминания о сдаче ----------

async function claimMark(personId: string, week: Date, kind: string, at: Date): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ personId: string }[]>`
    INSERT INTO "mail_marks" ("personId", "week", "kind", "sentAt") VALUES (${personId}, ${week}, ${kind}, ${at})
    ON CONFLICT DO NOTHING RETURNING "personId"`;
  return rows.length > 0;
}

async function releaseMark(personId: string, week: Date, kind: string): Promise<void> {
  await prisma.mailMark.deleteMany({ where: { personId, week, kind } });
}

/**
 * Напоминания тем, от кого ждут weekly за отчётную неделю и кто его ещё не сдал. Свой срок человека (команда сдаёт
 * раньше департамента) двигает напоминания. Отпуск, сданный weekly и закрытая неделя снимают их
 */
export async function reminderPass(now = new Date()): Promise<PassResult> {
  if (!inWorkHours(now) || !mailConfigured()) return { sent: 0, skipped: 0, failed: 0 };
  const key = await currentReportingKey(now);
  const week = await ensureWeek(prisma, key);
  if (week.closedAt) return { sent: 0, skipped: 0, failed: 0 };
  const nodes = await loadTeamNodes(prisma);
  const leaders = leadersOf(nodes);
  const expected = new Set(nodes.filter((n) => n.active).flatMap((n) => expectedOf(n, leaders)));
  if (!expected.size) return { sent: 0, skipped: 0, failed: 0 };
  const [people, reports, absences, closes, marks] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: [...expected] }, active: true, role: { not: "OBSERVER" }, email: { not: null } } }),
    prisma.weeklyReport.findMany({ where: { weekId: week.id, state: { in: ["SUBMITTED", "LATE"] } }, select: { authorId: true } }),
    prisma.absence.findMany({ where: { weekId: week.id }, select: { personId: true } }),
    prisma.teamWeekClose.findMany({ where: { weekId: week.id }, select: { teamId: true } }),
    prisma.mailMark.findMany({ where: { week: week.start, kind: { in: ["remind1", "remind2"] } } }),
  ]);
  const submitted = new Set(reports.map((r) => r.authorId));
  const absent = new Set(absences.map((a) => a.personId));
  const closedTeams = new Set(closes.map((c) => c.teamId));
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of people) {
    if (submitted.has(p.id) || absent.has(p.id) || !prefsOf(p.mailPrefs).reminders) continue;
    if (closedFor(p.id, nodes, false, closedTeams, leaders)) continue;
    const deadline = personDeadline(p.id, key, nodes, week.deadline, leaders);
    const first = marks.find((m) => m.personId === p.id && m.kind === "remind1")?.sentAt ?? null;
    const second = marks.find((m) => m.personId === p.id && m.kind === "remind2")?.sentAt ?? null;
    const due = reminderDue(now, deadline, { first, second });
    if (!due) continue;
    const kind = `remind${due}`;
    if (!(await claimMark(p.id, week.start, kind, now))) {
      skipped += 1;
      continue;
    }
    const left = due === 1 ? "" : " Остался час.";
    try {
      await sendMail({
        to: p.email!,
        subject: `Weekly: напоминание о сдаче до ${formatMoment(deadline)}`,
        text: `Здравствуйте, ${p.shortName}.\n\nWeekly за неделю ${week.isoNumber} ждём до ${formatMoment(deadline)}.${left}\n\nСдать: ${appUrl()}/weekly/submit\n\nЕсли вас нет на этой неделе, отметьте это в профиле: напоминания прекратятся.${footer()}`,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Напоминание о сдаче не ушло, повторим позже:", error instanceof Error ? error.message : error);
      await releaseMark(p.id, week.start, kind);
      if (isTransportDown(error)) break;
    }
  }
  return { sent, skipped, failed };
}

// ---------- Дайджест ----------

/**
 * День встречи человека за неделю: встреча команды, которая ждёт его weekly или которой он руководит,
 * если у неё свой день, иначе встреча департамента. Несколько своих встреч: самая ранняя
 */
export function meetingDayOf(personId: string, key: WeekKey, nodes: TeamNode[], department: IsoDate, leaders = leadersOf(nodes)): IsoDate {
  const own = nodes.filter((n) => n.active && n.id !== TOP_TEAM && n.rhythm.meeting && (n.leaderId === personId || expectedOf(n, leaders).includes(personId)));
  if (!own.length) return department;
  return own.map((n) => teamMeeting(key, n, department).date).sort()[0]!;
}

/**
 * Дайджест в день встречи в 9:00: сколько ждёт в «Мне», сколько вопросов к встрече в записях, которые человек видит,
 * и кто из его команд не сдал weekly. Руководителю приходит список своих команд, владельцу и администраторам
 * ещё и топ-команды. День встречи у каждого свой: команда может встречаться не в день департамента.
 * Пустой дайджест не отправляется
 */
export async function digestPass(now = new Date()): Promise<PassResult> {
  const zero = { sent: 0, skipped: 0, failed: 0 };
  if (!mailConfigured() || !inWorkHours(now)) return zero;
  const today = fromCalendar(moscowDate(now));
  // Встреча по неделе бывает на той же неделе (свой слот команды) или на следующей (как у департамента)
  const candidates = [shiftWeek(weekKeyOf(today), -1), weekKeyOf(today)];
  const { meeting } = await weekSettings();
  const nodes = await loadTeamNodes(prisma);
  const leaders = leadersOf(nodes);
  const people = (await prisma.person.findMany({ where: { active: true, email: { not: null } }, orderBy: { sortOrder: "asc" } })).filter((p) => prefsOf(p.mailPrefs).digest);
  const byWeek = new Map<WeekKey, typeof people>();
  for (const p of people) {
    const key = candidates.find((k) => digestDue(now, toCalendar(meetingDayOf(p.id, k, nodes, meetingOf(k, meeting), leaders))));
    if (key) byWeek.set(key, [...(byWeek.get(key) ?? []), p]);
  }
  const total = { ...zero };
  for (const [key, list] of byWeek) {
    const r = await digestForWeek(key, list, nodes, leaders, now);
    total.sent += r.sent;
    total.skipped += r.skipped;
    total.failed += r.failed;
  }
  return total;
}

type DigestPerson = { id: string; email: string | null; shortName: string; role: string };

async function digestForWeek(key: WeekKey, candidates: DigestPerson[], nodes: TeamNode[], leaders: Set<string>, now: Date): Promise<PassResult> {
  const week = await ensureWeek(prisma, key);
  const marked = new Set((await prisma.mailMark.findMany({ where: { week: week.start, kind: "digest" }, select: { personId: true } })).map((m) => m.personId));
  const people = candidates.filter((p) => !marked.has(p.id));
  if (!people.length) return { sent: 0, skipped: 0, failed: 0 };
  const [reports, absences, questions, everyone] = await Promise.all([
    prisma.weeklyReport.findMany({ where: { weekId: week.id, state: { in: ["SUBMITTED", "LATE"] } }, select: { authorId: true } }),
    prisma.absence.findMany({ where: { weekId: week.id }, select: { personId: true } }),
    prisma.reaction.findMany({
      where: { kind: "DISCUSS", discussedAt: null, OR: [{ entry: { weekId: week.id } }, { entryComment: { entry: { weekId: week.id } } }] },
      include: { entry: { include: { promotions: { select: { byId: true } } } }, entryComment: { include: { entry: { include: { promotions: { select: { byId: true } } } } } } },
    }),
    prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { id: true, fullName: true } }),
  ]);
  const submitted = new Set(reports.map((r) => r.authorId));
  const absent = new Set(absences.map((a) => a.personId));
  const names = new Map(everyone.map((p) => [p.id, p.fullName]));
  const readers = await readersOf(
    prisma,
    people.map((p) => p.id),
    nodes,
  );
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const p of people) {
    const reader = readers.get(p.id);
    const open = await inboxCount(p.id, now);
    const asked = reader
      ? questions.filter((q) => {
          const e = q.entry ?? q.entryComment?.entry;
          return !!e && seesEntry(reader.scope, nodes, { authorId: e.authorId, ceo: e.ceo, promotedBy: e.promotions.map((x) => x.byId) }, p.id);
        }).length
      : 0;
    const led = nodes.filter((n) => n.active && (n.leaderId === p.id || (n.id === TOP_TEAM && (p.role === "OWNER" || p.role === "ADMIN"))));
    const missing = [...new Set(led.flatMap((n) => expectedOf(n, leaders)))].filter((id) => id !== p.id && names.has(id) && !submitted.has(id) && !absent.has(id));
    if (!(await claimMark(p.id, week.start, "digest", now))) continue;
    if (!open && !asked && !missing.length) {
      skipped += 1;
      continue;
    }
    const lines = [
      `Сегодня встреча по неделе ${week.isoNumber}.`,
      ...(open ? [`В «Мне» ждут вашего внимания: ${open}.\n${appUrl()}/me`] : []),
      ...(asked ? [`Вопросов к встрече: ${asked}.\n${appUrl()}/weekly/meeting?week=${key}`] : []),
      ...(missing.length ? [`Не сдали weekly в ваших командах: ${missing.map((id) => names.get(id)).join(", ")}.\n${appUrl()}/weekly?week=${key}`] : []),
    ];
    try {
      await sendMail({
        to: p.email!,
        subject: `Weekly: дайджест к встрече по неделе ${week.isoNumber}`,
        text: `Здравствуйте, ${p.shortName}.\n\n${lines.join("\n\n")}${footer()}`,
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Дайджест не ушёл, повторим позже:", error instanceof Error ? error.message : error);
      await releaseMark(p.id, week.start, "digest");
      if (isTransportDown(error)) break;
    }
  }
  return { sent, skipped, failed };
}

// ---------- Цикл ----------

/** Один проход всех писем под арендой. null: проход делает другой процесс сервера */
export async function mailTick(now = new Date()): Promise<{ events: PassResult; reminders: PassResult; digest: PassResult } | null> {
  // Проходы независимы: сбой одного не задерживает напоминания и дайджест с их узким окном
  const safe = async (what: string, fn: () => Promise<PassResult>): Promise<PassResult> => {
    try {
      return await fn();
    } catch (error) {
      console.error(`${what}: проход не прошёл, повторим через минуту:`, error instanceof Error ? error.message : error);
      return { sent: 0, skipped: 0, failed: 1 };
    }
  };
  return leased(async () => {
    // Повестки встреч собираются к сроку сдачи (этап 23): тот же минутный цикл под той же арендой
    await safe("Повестки встреч", async () => {
      const { agendaPass } = await import("@/lib/meeting/service");
      const built = await agendaPass(now);
      return { sent: built, skipped: 0, failed: 0 };
    });
    // Цифры недели (этап 24): недельный отчёт перечитывается раз в час
    await safe("Недельный отчёт", async () => {
      const { pullNumbersIfDue } = await import("@/lib/numbers/service");
      await pullNumbersIfDue(now);
      return { sent: 0, skipped: 0, failed: 0 };
    });
    // Повторяющиеся задачи по расписанию (этап 25): следующая в день срока
    await safe("Повторы задач", async () => {
      const { repeatPass } = await import("@/lib/tasks/service");
      return { sent: await repeatPass(now), skipped: 0, failed: 0 };
    });
    return {
      reminders: await safe("Напоминания о сдаче", () => reminderPass(now)),
      digest: await safe("Дайджест", () => digestPass(now)),
      events: await safe("Письма о событиях", () => eventMailPass(now)),
    };
  });
}

/** Запустить фоновый цикл писем один раз на процесс. Работает и без почты: события тогда просто отмечаются */
export function startMailLoop(): void {
  if (g.__mailLoop) return;
  const step = async () => {
    try {
      await mailTick();
    } catch (error) {
      console.error("Проход писем не прошёл, повторим через минуту:", error instanceof Error ? error.message : error);
    } finally {
      g.__mailLoop = setTimeout(() => void step(), TICK_MS);
      g.__mailLoop.unref?.();
    }
  };
  g.__mailLoop = setTimeout(() => void step(), TICK_MS);
  g.__mailLoop.unref?.();
}

// ---------- Настройки ----------

/** Настройки писем человека: в профиле */
export async function mailPrefsFor(personId: string) {
  const p = await prisma.person.findUnique({ where: { id: personId }, select: { mailPrefs: true } });
  return prefsOf(p?.mailPrefs);
}

/**
 * Сохранить настройки писем. Только при личном входе: по общему логину можно выбрать чужой профиль,
 * и тогда кто угодно выключил бы письма другому человеку
 */
export async function saveMailPrefs(actor: Actor, input: unknown): Promise<MailPrefs> {
  if (actor.via === "TEAM") throw new TaskRuleError("Письма настраиваются при личном входе по ссылке");
  const prefs = prefsOf(input);
  const before = await mailPrefsFor(actor.personId);
  await prisma.$transaction(async (tx) => {
    await tx.person.update({ where: { id: actor.personId }, data: { mailPrefs: prefs } });
    const changed = (Object.keys(prefs) as (keyof MailPrefs)[]).filter((k) => prefs[k] !== before[k]);
    if (changed.length) {
      await tx.auditLog.create({
        data: {
          action: "settings.mail",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "person",
          entityId: actor.slug,
          field: "Письма",
          before: changed.map((k) => `${PREF_LABELS[k].title}: ${before[k] ? "да" : "нет"}`).join(", "),
          after: changed.map((k) => `${PREF_LABELS[k].title}: ${prefs[k] ? "да" : "нет"}`).join(", "),
          ip: actor.ip ?? null,
          via: actor.via ?? null,
        },
      });
    }
  });
  return prefs;
}
