// Встречи один на один (этап 28): руководитель и человек его команды. Повестка, итоги тем, заметки, задачи из тем.
//
// Приватность: читать и править может только участник пары и только при личном входе. Режим управления и роль
// владельца или администратора доступа не дают. В журнал содержимое встреч не пишется, в событиях «Мне» только
// второму участнику. Задача из темы становится обычной задачей: её видят по правилам задач, это сказано на экране.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { Prisma } from "@/generated/prisma/client";
import type { PersonSlug } from "@/domain/types";
import { formatShort, type IsoDate } from "@/domain/dates";
import { TaskRuleError, createTaskIn, type Actor } from "@/lib/tasks/service";
import { dbDate, isIsoDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { loadTeamNodes } from "@/lib/org/scope";
import { notify } from "@/lib/inbox/notify";
import { teamAnalytics, type LeaderCard } from "@/lib/analytics/service";
import { NOTES_MAX, OUTCOME_MAX, cleanText, cleanTopic, linkBetween, nextMeetingDate, pairLinks, pairSubject, personalLogin } from "./rules";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** active: false, если человека выключили в ресурсе или он стал наблюдателем: история встреч остаётся у обоих */
export type PersonBrief = { id: string; slug: PersonSlug; fullName: string; position: string | null; active: boolean };

export type PairListItem = {
  other: PersonBrief;
  /** Моя роль в паре */
  role: "manager" | "report";
  next: IsoDate | null;
  openTopics: number;
  lastDone: IsoDate | null;
};

export type TopicView = {
  id: string;
  text: string;
  status: "open" | "discussed" | "dropped";
  outcome: string | null;
  author: { slug: PersonSlug; fullName: string } | null;
  mine: boolean;
  createdAt: string;
  closedAt: string | null;
  task: { number: number; title: string } | null;
};

/** updatedAt: момент последней правки встречи, по нему экран отличает свежую версию от запоздавшей */
export type MeetingView = { id: string; date: IsoDate; status: "planned" | "done"; notes: string; myNote: string; closedAt: string | null; updatedAt: string };

export type PairView = {
  pairId: string | null;
  role: "manager" | "report";
  manager: PersonBrief;
  report: PersonBrief;
  planned: MeetingView | null;
  open: TopicView[];
  /** Темы, закрытые на запланированной встрече: итог можно поправить или вернуть тему в повестку до завершения */
  closedNow: TopicView[];
  history: { meeting: MeetingView; topics: TopicView[] }[];
  /** Цифры лидера из аналитики: та же карточка, что видит руководитель. Нет, если человек не руководит командой */
  card: LeaderCard | null;
  /** Порог «давно не обновлялась» из настроек: подпись в карточке */
  staleDays: number;
  today: IsoDate;
};

const PERSON = { id: true, slug: true, fullName: true, position: true, active: true, role: true } as const;

function brief(p: { id: string; slug: string; fullName: string; position: string | null; active: boolean; role: string }): PersonBrief {
  return { id: p.id, slug: p.slug as PersonSlug, fullName: p.fullName, position: p.position, active: p.active && p.role !== "OBSERVER" };
}

function requirePersonal(actor: Actor) {
  if (!personalLogin(actor.via)) fail("Встречи один на один открываются только при личном входе: по общему логину их не видно");
}

/** Пары человека: по структуре и те, что уже были (человека перевели, история остаётся у обоих) */
export async function listPairs(actor: Actor): Promise<PairListItem[]> {
  requirePersonal(actor);
  const [nodes, existing] = await Promise.all([
    loadTeamNodes(prisma),
    prisma.oneOnOnePair.findMany({
      where: { OR: [{ managerId: actor.personId }, { reportId: actor.personId }] },
      select: {
        id: true,
        managerId: true,
        reportId: true,
        meetings: { select: { date: true, status: true }, orderBy: { date: "desc" } },
        _count: { select: { topics: { where: { status: "OPEN" } } } },
      },
    }),
  ]);
  // Одна строка на собеседника: заведённая пара важнее структуры (после перестановки роли берём из пары)
  const byOther = new Map<string, { managerId: string; reportId: string; existing: boolean }>();
  for (const p of existing) byOther.set(otherOf(p, actor), { ...p, existing: true });
  // Наблюдатель новых встреч не заводит: у него только уже заведённые пары
  for (const l of actor.role === "OBSERVER" ? [] : pairLinks(nodes, actor.personId)) {
    const other = l.managerId === actor.personId ? l.reportId : l.managerId;
    if (!byOther.has(other)) byOther.set(other, { ...l, existing: false });
  }
  const people = await prisma.person.findMany({ where: { id: { in: [...byOther.keys()] } }, select: PERSON, orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }] });
  const out: PairListItem[] = [];
  for (const p of people) {
    const link = byOther.get(p.id)!;
    // По структуре без истории: только включённые люди, не наблюдатели
    if (!link.existing && (!p.active || p.role === "OBSERVER")) continue;
    const role: PairListItem["role"] = link.managerId === actor.personId ? "manager" : "report";
    const pair = existing.find((e) => e.managerId === link.managerId && e.reportId === link.reportId);
    const planned = pair?.meetings.find((m) => m.status === "PLANNED");
    const done = pair?.meetings.find((m) => m.status === "DONE");
    out.push({ other: brief(p), role, next: planned ? isoFromDbDate(planned.date) : null, openTopics: pair?._count.topics ?? 0, lastDone: done ? isoFromDbDate(done.date) : null });
  }
  return out;
}

/** Пара двух людей: уже заведённая или по структуре. Чужому человеку пары нет */
async function resolvePair(db: Tx | typeof prisma, actor: Actor, otherSlug: string) {
  requirePersonal(actor);
  const other = await db.person.findUnique({ where: { slug: String(otherSlug) }, select: PERSON });
  if (!other || other.id === actor.personId) return fail("Встречи один на один с этим человеком нет");
  const pair = await db.oneOnOnePair.findFirst({
    where: { OR: [{ managerId: actor.personId, reportId: other.id }, { managerId: other.id, reportId: actor.personId }] },
  });
  // Заведённая пара остаётся у обоих: человека выключили или перевели, а история встреч нужна
  if (pair) return { pair, other, managerId: pair.managerId, reportId: pair.reportId };
  // Новую пару заводят только включённые люди, не наблюдатели
  if (!other.active || other.role === "OBSERVER" || actor.role === "OBSERVER") return fail("Встречи один на один с этим человеком нет");
  const link = linkBetween(await loadTeamNodes(db), actor.personId, other.id);
  if (!link) return fail("Встречи один на один бывают у руководителя и человека его команды: с этим человеком вы не в одной команде");
  return { pair: null, other, managerId: link.managerId, reportId: link.reportId };
}

/** Пара для записи: заводится при первой теме или встрече. Двойное нажатие не создаёт вторую */
async function ensurePair(tx: Tx, actor: Actor, otherSlug: string) {
  const r = await resolvePair(tx, actor, otherSlug);
  if (r.pair) return { ...r, pair: r.pair };
  await tx.oneOnOnePair.createMany({ data: [{ managerId: r.managerId, reportId: r.reportId }], skipDuplicates: true });
  const pair = await tx.oneOnOnePair.findUniqueOrThrow({ where: { managerId_reportId: { managerId: r.managerId, reportId: r.reportId } } });
  return { ...r, pair };
}

/** Пара по id: только для её участника при личном входе */
async function pairOf(db: Tx | typeof prisma, actor: Actor, pairId: string) {
  requirePersonal(actor);
  const pair = await db.oneOnOnePair.findUnique({ where: { id: String(pairId) } });
  if (!pair || (pair.managerId !== actor.personId && pair.reportId !== actor.personId)) return fail("Такой встречи один на один нет");
  return pair;
}

const otherOf = (pair: { managerId: string; reportId: string }, actor: Actor) => (pair.managerId === actor.personId ? pair.reportId : pair.managerId);

/** Правки в паре: оба участника включены и не наблюдатели. Иначе история только для чтения */
async function requireWritable(tx: Tx, pair: { managerId: string; reportId: string }) {
  const people = await tx.person.findMany({ where: { id: { in: [pair.managerId, pair.reportId] } }, select: { active: true, role: true } });
  if (people.length < 2 || people.some((p) => !p.active || p.role === "OBSERVER")) fail("Собеседник выключен в ресурсе или стал наблюдателем: встречи с ним теперь только для чтения");
}

const topicSelect = {
  id: true,
  text: true,
  status: true,
  outcome: true,
  createdAt: true,
  closedAt: true,
  meetingId: true,
  authorId: true,
  author: { select: { slug: true, fullName: true } },
  task: { select: { number: true, title: true, archivedAt: true } },
} satisfies Prisma.OneOnOneTopicSelect;

type TopicRow = Prisma.OneOnOneTopicGetPayload<{ select: typeof topicSelect }>;

function topicView(t: TopicRow, me: string): TopicView {
  return {
    id: t.id,
    text: t.text,
    status: t.status === "OPEN" ? "open" : t.status === "DISCUSSED" ? "discussed" : "dropped",
    outcome: t.outcome,
    author: t.author ? { slug: t.author.slug as PersonSlug, fullName: t.author.fullName } : null,
    mine: t.authorId === me,
    createdAt: t.createdAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
    task: t.task && !t.task.archivedAt ? { number: t.task.number, title: t.task.title } : null,
  };
}

/** Встреча один на один с человеком: повестка, запланированная встреча, история. Чужому участнику ошибка */
export async function getPair(actor: Actor, otherSlug: string, now = new Date()): Promise<PairView> {
  const r = await resolvePair(prisma, actor, otherSlug);
  const [manager, report] = await Promise.all([
    prisma.person.findUniqueOrThrow({ where: { id: r.managerId }, select: PERSON }),
    prisma.person.findUniqueOrThrow({ where: { id: r.reportId }, select: PERSON }),
  ]);
  const role: PairView["role"] = r.managerId === actor.personId ? "manager" : "report";
  const [card, staleDays] = await Promise.all([leaderCard(r.managerId, r.reportId, report.slug), getSetting<number>("tasks.staleDays", 14)]);
  const today = moscowToday(now);
  if (!r.pair) return { pairId: null, role, manager: brief(manager), report: brief(report), planned: null, open: [], closedNow: [], history: [], card, staleDays, today };
  const [meetings, topics] = await Promise.all([
    prisma.oneOnOne.findMany({
      where: { pairId: r.pair.id },
      orderBy: { date: "desc" },
      take: 30,
      include: { privateNotes: { where: { authorId: actor.personId }, select: { text: true } } },
    }),
    prisma.oneOnOneTopic.findMany({ where: { pairId: r.pair.id }, orderBy: { createdAt: "asc" }, select: topicSelect }),
  ]);
  const meetingView = (m: (typeof meetings)[number]): MeetingView => ({
    id: m.id,
    date: isoFromDbDate(m.date),
    status: m.status === "PLANNED" ? "planned" : "done",
    notes: m.notes,
    myNote: m.privateNotes[0]?.text ?? "",
    closedAt: m.closedAt?.toISOString() ?? null,
    updatedAt: m.updatedAt.toISOString(),
  });
  const planned = meetings.find((m) => m.status === "PLANNED");
  return {
    pairId: r.pair.id,
    role,
    manager: brief(manager),
    report: brief(report),
    planned: planned ? meetingView(planned) : null,
    open: topics.filter((t) => t.status === "OPEN").map((t) => topicView(t, actor.personId)),
    closedNow: planned ? topics.filter((t) => t.status !== "OPEN" && t.meetingId === planned.id).map((t) => topicView(t, actor.personId)) : [],
    history: meetings
      .filter((m) => m.status === "DONE")
      .map((m) => ({ meeting: meetingView(m), topics: topics.filter((t) => t.meetingId === m.id && t.status !== "OPEN").map((t) => topicView(t, actor.personId)) })),
    card,
    staleDays,
    today,
  };
}

/**
 * Карточка человека из аналитики его руководителя: та же, что руководитель видит на панели. Считается от имени
 * руководителя, потому что команда выше человеку не видна; показывается только участникам пары
 */
async function leaderCard(managerId: string, reportId: string, reportSlug: string): Promise<LeaderCard | null> {
  const [manager, nodes] = await Promise.all([prisma.person.findUnique({ where: { id: managerId }, select: { id: true, role: true } }), loadTeamNodes(prisma)]);
  if (!manager || !nodes.some((n) => n.active && n.leaderId === reportId)) return null;
  const link = pairLinks(nodes, managerId).find((l) => l.reportId === reportId);
  if (!link) return null;
  const data = await teamAnalytics({ id: manager.id, role: manager.role }, link.teamId).catch(() => null);
  // Панель открылась не той командой (руководитель её не ведёт): карточки нет
  if (!data || data.team.id !== link.teamId) return null;
  return data.leaders.find((c) => c.leader?.slug === reportSlug) ?? null;
}

/** Новая тема в повестку. Второй участник получает событие в «Мне» */
export async function addTopic(actor: Actor, otherSlug: string, text: string, now = new Date()): Promise<TopicView> {
  const clean = cleanTopic(text);
  if (!clean) fail("Напишите тему одной-двумя фразами");
  return prisma.$transaction(async (tx) => {
    const { pair } = await ensurePair(tx, actor, otherSlug);
    await requireWritable(tx, pair);
    const open = await tx.oneOnOneTopic.count({ where: { pairId: pair.id, status: "OPEN" } });
    if (open >= 50) fail("В повестке уже 50 тем: закройте или снимите обсуждённые");
    const row = await tx.oneOnOneTopic.create({ data: { pairId: pair.id, authorId: actor.personId, text: clean, createdAt: now }, select: topicSelect });
    // Текст темы в событие не кладём: событие живёт отдельно и не меняется, если тему поправят или уберут
    await notify(tx, { kind: "ONE_ON_ONE", recipients: [otherOf(pair, actor)], actor, subject: pairSubject(pair.id), text: "Новая тема в повестке встречи один на один" }, now);
    return topicView(row, actor.personId);
  });
}

async function topicOf(tx: Tx, actor: Actor, topicId: string) {
  const row = await tx.oneOnOneTopic.findUnique({ where: { id: String(topicId) }, include: { pair: true } });
  if (!row) return fail("Такой темы нет");
  await pairOf(tx, actor, row.pairId);
  await requireWritable(tx, row.pair);
  return row;
}

/** Правка темы: только автор и только пока тема открыта */
export async function editTopic(actor: Actor, topicId: string, text: string): Promise<TopicView> {
  const clean = cleanTopic(text);
  if (!clean) fail("Напишите тему одной-двумя фразами");
  return prisma.$transaction(async (tx) => {
    const row = await topicOf(tx, actor, topicId);
    if (row.authorId !== actor.personId) fail("Тему правит её автор");
    if (row.status !== "OPEN") fail("Обсуждённую тему не правят: верните её в повестку");
    return topicView(await tx.oneOnOneTopic.update({ where: { id: row.id }, data: { text: clean }, select: topicSelect }), actor.personId);
  });
}

/** Удалить тему: только автор и только открытую. Без следа: это его черновик повестки */
export async function deleteTopic(actor: Actor, topicId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await topicOf(tx, actor, topicId);
    if (row.authorId !== actor.personId) fail("Убрать тему может её автор. Можно снять её с повестки");
    if (row.status !== "OPEN") fail("Обсуждённую тему не удаляют");
    await tx.oneOnOneTopic.delete({ where: { id: row.id } });
  });
}

/**
 * Итог темы: «обсудили» с договорённостью или «сняли». Тема привязывается к запланированной встрече пары и уходит
 * из повестки. reopen: вернуть тему в повестку
 */
export async function closeTopic(actor: Actor, topicId: string, status: "discussed" | "dropped" | "open", outcome?: string | null, now = new Date()): Promise<TopicView> {
  if (status !== "discussed" && status !== "dropped" && status !== "open") fail("Выберите итог темы");
  return prisma.$transaction(async (tx) => {
    const row = await topicOf(tx, actor, topicId);
    if (status === "open") {
      if (row.status === "OPEN") fail("Тема и так в повестке");
      return topicView(await tx.oneOnOneTopic.update({ where: { id: row.id }, data: { status: "OPEN", meetingId: null, closedAt: null }, select: topicSelect }), actor.personId);
    }
    const planned = await tx.oneOnOne.findFirst({ where: { pairId: row.pairId, status: "PLANNED" }, select: { id: true } });
    if (!planned) fail("Сначала назначьте встречу: итог темы записывается к встрече");
    // Итог поправить можно до завершения встречи; тему с прошлой встречи сначала возвращают в повестку
    if (row.status !== "OPEN" && row.meetingId !== planned!.id) fail("Тема закрыта на прошлой встрече: сначала верните её в повестку");
    const text = outcome === undefined || outcome === null ? row.outcome : cleanText(outcome, OUTCOME_MAX) || null;
    return topicView(
      await tx.oneOnOneTopic.update({
        where: { id: row.id },
        data: { status: status === "discussed" ? "DISCUSSED" : "DROPPED", outcome: text, meetingId: planned!.id, closedAt: row.closedAt ?? now },
        select: topicSelect,
      }),
      actor.personId,
    );
  });
}

/** Назначить встречу или перенести запланированную. Второй участник получает событие */
export async function scheduleMeeting(actor: Actor, otherSlug: string, date: string, now = new Date()): Promise<MeetingView> {
  if (!isIsoDate(date)) fail("Выберите дату встречи");
  const today = moscowToday(now);
  if (date < today) fail("Встречу назначают на сегодня или позже");
  return prisma.$transaction(async (tx) => {
    const { pair } = await ensurePair(tx, actor, otherSlug);
    await requireWritable(tx, pair);
    // Две вкладки назначают встречу одновременно: вторая ждёт первую и переносит её, а не падает на уникальном индексе
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`one-on-one:${pair.id}`}))`;
    const planned = await tx.oneOnOne.findFirst({ where: { pairId: pair.id, status: "PLANNED" } });
    const row = planned
      ? await tx.oneOnOne.update({ where: { id: planned.id }, data: { date: dbDate(date) } })
      : await tx.oneOnOne.create({ data: { pairId: pair.id, date: dbDate(date) } });
    if (!planned || isoFromDbDate(planned.date) !== date) {
      await notify(tx, { kind: "ONE_ON_ONE", recipients: [otherOf(pair, actor)], actor, subject: pairSubject(pair.id), text: `${planned ? "Встреча один на один перенесена" : "Встреча один на один назначена"} на ${formatShort(date)}` }, now);
    }
    return { id: row.id, date: isoFromDbDate(row.date), status: "planned", notes: row.notes, myNote: "", closedAt: null, updatedAt: row.updatedAt.toISOString() };
  });
}

/** Заметки встречи: общие (видят оба) и личные (видит только автор). undefined: эту часть не трогаем */
export async function saveNotes(actor: Actor, meetingId: string, input: { shared?: string; mine?: string; base?: string }): Promise<{ notes: string; myNote: string; updatedAt: string }> {
  return prisma.$transaction(async (tx) => {
    const found = await tx.oneOnOne.findUnique({ where: { id: String(meetingId) } });
    if (!found) return fail("Такой встречи нет");
    await requireWritable(tx, await pairOf(tx, actor, found.pairId));
    // Общие заметки правят оба: сохранение сверяется с текстом, от которого начинали, чужую правку не затирает
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`one-on-one-notes:${found.id}`}))`;
    const meeting = await tx.oneOnOne.findUniqueOrThrow({ where: { id: found.id } });
    if (input.shared !== undefined && input.base !== undefined && input.base !== meeting.notes) {
      fail("Общие заметки за это время поменялись у собеседника или на другом устройстве. Ваш текст остался на экране: сравните с сохранённой версией");
    }
    let notes = meeting.notes;
    let updatedAt = meeting.updatedAt;
    if (input.shared !== undefined && cleanText(input.shared, NOTES_MAX) !== meeting.notes) {
      const row = await tx.oneOnOne.update({ where: { id: meeting.id }, data: { notes: cleanText(input.shared, NOTES_MAX) } });
      notes = row.notes;
      updatedAt = row.updatedAt;
    }
    let myNote = (await tx.oneOnOneNote.findUnique({ where: { meetingId_authorId: { meetingId: meeting.id, authorId: actor.personId } } }))?.text ?? "";
    if (input.mine !== undefined) {
      const text = cleanText(input.mine, NOTES_MAX);
      myNote = (await tx.oneOnOneNote.upsert({ where: { meetingId_authorId: { meetingId: meeting.id, authorId: actor.personId } }, update: { text }, create: { meetingId: meeting.id, authorId: actor.personId, text } })).text;
    }
    return { notes, myNote, updatedAt: updatedAt.toISOString() };
  });
}

/**
 * Завершить встречу. Открытые темы остаются в повестке пары и сами переходят на следующую. next: дата следующей
 * встречи, по умолчанию через неделю; null: не назначать
 */
export async function completeMeeting(actor: Actor, meetingId: string, next: string | null | undefined, now = new Date()): Promise<{ next: MeetingView | null }> {
  return prisma.$transaction(async (tx) => {
    const meeting = await tx.oneOnOne.findUnique({ where: { id: String(meetingId) } });
    if (!meeting) return fail("Такой встречи нет");
    const pair = await pairOf(tx, actor, meeting.pairId);
    await requireWritable(tx, pair);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`one-on-one:${pair.id}`}))`;
    const fresh = await tx.oneOnOne.findUniqueOrThrow({ where: { id: meeting.id } });
    if (fresh.status !== "PLANNED") fail("Встреча уже завершена");
    const today = moscowToday(now);
    const nextDate = next === null ? null : next === undefined || next === "" ? nextMeetingDate(isoFromDbDate(fresh.date) > today ? today : isoFromDbDate(fresh.date), today) : next;
    if (nextDate !== null && (!isIsoDate(nextDate) || nextDate < today)) fail("Следующую встречу назначают на сегодня или позже");
    // Встречу провели раньше назначенного дня: в истории она стоит днём, когда прошла
    const held = isoFromDbDate(fresh.date) > today ? today : isoFromDbDate(fresh.date);
    await tx.oneOnOne.update({ where: { id: fresh.id }, data: { status: "DONE", closedAt: now, closedById: actor.personId, date: dbDate(held) } });
    if (!nextDate) return { next: null };
    const row = await tx.oneOnOne.create({ data: { pairId: pair.id, date: dbDate(nextDate) } });
    await notify(tx, { kind: "ONE_ON_ONE", recipients: [otherOf(pair, actor)], actor, subject: pairSubject(pair.id), text: `Встреча один на один завершена, следующая ${formatShort(nextDate)}` }, now);
    return { next: { id: row.id, date: nextDate, status: "planned", notes: "", myNote: "", closedAt: null, updatedAt: row.updatedAt.toISOString() } };
  });
}

/**
 * Задача из темы: обычная задача одного из двух участников, видна по правилам задач. Тема получает ссылку на задачу.
 * Срок не раньше сегодня
 */
export async function topicToTask(
  actor: Actor,
  topicId: string,
  input: { title: string; outcome: string; owner: string; direction: string; due: string },
  now = new Date(),
): Promise<{ topic: TopicView; task: number }> {
  return prisma.$transaction(async (tx) => {
    const row = await topicOf(tx, actor, topicId);
    if (row.taskId) fail("Из этой темы уже поставлена задача");
    const people = await tx.person.findMany({ where: { id: { in: [row.pair.managerId, row.pair.reportId] } }, select: { id: true, slug: true } });
    const owner = people.find((p) => p.slug === String(input.owner));
    if (!owner) fail("Ответственный за задачу из встречи один на один: вы или ваш собеседник");
    if (!isIsoDate(input.due) || input.due < moscowToday(now)) fail("Срок задачи не раньше сегодня");
    // Задача в команде, где эти двое встречаются: у руководителя управления в его команде, у Арама в топ-команде
    const link = linkBetween(await loadTeamNodes(tx), row.pair.managerId, row.pair.reportId);
    if (!link) fail("Вы больше не в одной команде: поставьте задачу из раздела «Задачи» в нужной команде");
    const { task } = await createTaskIn(tx, actor, {
      title: input.title,
      outcome: input.outcome,
      owner: owner!.slug as PersonSlug,
      direction: String(input.direction),
      due: input.due,
      source: "other",
      sourceNote: "Встреча один на один",
      team: link!.teamId,
    });
    const taskRow = await tx.task.findUniqueOrThrow({ where: { number: task.number }, select: { id: true } });
    // Две вкладки или оба участника сразу: вторая задача откатывается вместе с транзакцией
    const linked = await tx.oneOnOneTopic.updateMany({ where: { id: row.id, taskId: null }, data: { taskId: taskRow.id } });
    if (!linked.count) fail("Из этой темы уже поставлена задача");
    const updated = await tx.oneOnOneTopic.findUniqueOrThrow({ where: { id: row.id }, select: topicSelect });
    return { topic: topicView(updated, actor.personId), task: task.number };
  });
}

/** Пара по id для ссылки из «Мне»: адрес страницы с собеседником. Чужая пара: null */
export async function pairPath(actor: Actor, pairId: string): Promise<string | null> {
  if (!personalLogin(actor.via)) return null;
  const pair = await prisma.oneOnOnePair.findUnique({ where: { id: String(pairId) }, include: { manager: { select: { slug: true } }, report: { select: { slug: true } } } });
  if (!pair || (pair.managerId !== actor.personId && pair.reportId !== actor.personId)) return null;
  return `/one-on-one/${pair.managerId === actor.personId ? pair.report.slug : pair.manager.slug}`;
}
