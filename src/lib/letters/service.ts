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
import { loadTeamNodes, TOP_TEAM } from "@/lib/org/scope";
import { closedFor, expectedOf, leadersOf, personDeadline } from "@/lib/org/rhythm";
import { currentReportingKey, ensureWeek } from "@/lib/weekly/service";
import { isoFromDbDate } from "@/lib/tasks/dates";
import { formatMoment } from "@/lib/week";
import { toCalendar } from "@/domain/dates";
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

export type EventLine = { kind: InboxKind; actorName: string | null; taskNumber: number | null; entryId: string | null; commentId: string | null };

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
    default:
      return `${who}новое событие`;
  }
}

function linkOf(e: { taskNumber: number | null; entryId: string | null }): string {
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
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "inbox_events" WHERE "mailedAt" IS NULL AND "createdAt" <= ${cutoff} ORDER BY "createdAt" LIMIT 2000 FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await tx.inboxEvent.updateMany({ where: { id: { in: ids } }, data: { mailedAt: now } });
    return tx.inboxEvent.findMany({
      where: { id: { in: ids } },
      include: { task: { select: { number: true } }, recipient: { select: { id: true, email: true, active: true, mailPrefs: true, shortName: true } } },
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
  for (const events of byPerson.values()) {
    const person = events[0]!.recipient;
    const mail = eventsMail(
      person,
      events.map((e) => ({
        kind: e.kind,
        actorName: e.actorName,
        taskNumber: e.task?.number ?? null,
        entryId: e.entryId,
        commentId: e.commentId ?? e.entryCommentId,
        subject: e.subject,
        createdAt: e.createdAt,
      })),
    );
    try {
      await sendMail({ to: person.email!, ...mail });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Письмо о событиях не ушло, повторим позже:", error instanceof Error ? error.message : error);
      await prisma.inboxEvent.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { mailedAt: null } });
    }
  }
  return { sent, skipped: claimed.length - wanted.length, failed };
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
    }
  }
  return { sent, skipped, failed };
}

// ---------- Дайджест ----------

/**
 * Дайджест в день встречи в 9:00: сколько ждёт в «Мне», сколько вопросов к встрече в записях, которые человек видит,
 * и кто из его команд не сдал weekly. Руководителю приходит список своих команд, владельцу и администраторам
 * ещё и топ-команды. Пустой дайджест не отправляется
 */
export async function digestPass(now = new Date()): Promise<PassResult> {
  if (!mailConfigured()) return { sent: 0, skipped: 0, failed: 0 };
  const key = await currentReportingKey(now);
  const week = await ensureWeek(prisma, key);
  if (!digestDue(now, toCalendar(isoFromDbDate(week.meetingDate)))) return { sent: 0, skipped: 0, failed: 0 };
  const marked = new Set((await prisma.mailMark.findMany({ where: { week: week.start, kind: "digest" }, select: { personId: true } })).map((m) => m.personId));
  const people = (await prisma.person.findMany({ where: { active: true, email: { not: null } }, orderBy: { sortOrder: "asc" } })).filter(
    (p) => !marked.has(p.id) && prefsOf(p.mailPrefs).digest,
  );
  if (!people.length) return { sent: 0, skipped: 0, failed: 0 };
  const nodes = await loadTeamNodes(prisma);
  const leaders = leadersOf(nodes);
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
    }
  }
  return { sent, skipped, failed };
}

// ---------- Цикл ----------

/** Один проход всех писем под арендой. null: проход делает другой процесс сервера */
export async function mailTick(now = new Date()): Promise<{ events: PassResult; reminders: PassResult; digest: PassResult } | null> {
  return leased(async () => ({ events: await eventMailPass(now), reminders: await reminderPass(now), digest: await digestPass(now) }));
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
