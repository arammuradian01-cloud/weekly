// Просьбы коллегам (этап 21, модуль М4 плана Weekly 2.0).
//
// Просьба: от кого, кому, что нужно, к какому сроку и, если есть, к какой задаче или записи weekly.
// Путь: ждёт ответа, принята со сроком адресата, выполнена. Или отклонена с причиной, или отозвана автором.
// Пока просьба открыта или принята, следующий шаг за адресатом. Адресат одним нажатием делает просьбу своей задачей,
// а когда задачу выполнят, просьба закроется сама (hooks.ts).
//
// Кто видит: автор, адресат, их руководители по структуре, функциональный руководитель адресата и те, кто видит весь
// департамент. Общий логин без режима управления видит только просьбы между людьми топ-команды: там можно выбрать
// чужой профиль. Связанная задача или запись показывается, только если человек видит её и так.
// Решить за адресата (принять, отклонить, выполнено) может режим управления.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { RequestStatus } from "@/generated/prisma/enums";
import { formatShort, type IsoDate } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { REQUEST_STATUS, type RequestCan, type RequestStatusCode, type RequestView } from "@/domain/requests";
import { TaskRuleError, changeStateIn, createTaskIn, type Actor, type TaskResult } from "@/lib/tasks/service";
import { dbDate, isIsoDate, isoFromDbDate, moscowIso, moscowToday } from "@/lib/tasks/dates";
import { CLOSED_DB } from "@/lib/tasks/codes";
import { TOP_TEAM, loadScope, loadTeamNodes, type Scope, type TeamNode } from "@/lib/org/scope";
import { seesTask } from "@/lib/tasks/watch";
import { seesEntry } from "@/lib/discuss/access";
import { notify, quote } from "@/lib/inbox/notify";
import { requestSubject } from "./hooks";
import { PROPOSAL_STALE_DAYS, REMIND_GAP_MS, REQUEST_ANSWER_MAX, REQUEST_TEXT_MAX, isRequestOverdue, isStuck, taskTitleFrom } from "./rules";

export { requestSubject };

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const STATUS_CODE: Record<RequestStatus, RequestStatusCode> = { OPEN: "open", ACCEPTED: "accepted", DONE: "done", DECLINED: "declined", WITHDRAWN: "withdrawn" };
const ACTIVE: RequestStatus[] = ["OPEN", "ACCEPTED"];

const taskSelect = { id: true, number: true, title: true, teamId: true, ownerId: true, createdById: true, archivedAt: true, directionId: true, coExecutors: { select: { personId: true } } } as const;

const requestInclude = {
  author: { select: { id: true, slug: true, fullName: true } },
  addressee: { select: { id: true, slug: true, fullName: true } },
  task: { select: taskSelect },
  resultTask: { select: taskSelect },
  entry: { select: { id: true, what: true, authorId: true, ceo: true, promotions: { select: { byId: true } } } },
} satisfies Prisma.HelpRequestInclude;

type Row = Prisma.HelpRequestGetPayload<{ include: typeof requestInclude }>;

/** Доступ того, кто смотрит: его области видимости, дерево команд и люди топ-команды для общего логина */
type Access = { actor: Actor; scope: Scope; nodes: TeamNode[]; limited: boolean; top: Set<string> };

async function accessOf(db: Db, actor: Actor): Promise<Access> {
  const limited = actor.via === "TEAM" && !actor.management;
  const [scope, nodes] = await Promise.all([loadScope(db, { id: actor.personId, role: actor.role, limited }), loadTeamNodes(db)]);
  const topNode = nodes.find((n) => n.id === TOP_TEAM);
  const top = new Set([...(topNode?.leaderId ? [topNode.leaderId] : []), ...(topNode?.members ?? [])]);
  return { actor, scope, nodes, limited, top };
}

function seesRequest(a: Access, row: Pick<Row, "authorId" | "addresseeId">): boolean {
  const me = a.actor.personId;
  if (a.limited) return (row.authorId === me || row.addresseeId === me) && a.top.has(row.authorId) && a.top.has(row.addresseeId);
  if (row.authorId === me || row.addresseeId === me || a.scope.all) return true;
  const lead = new Set(a.scope.leadPeople);
  return lead.has(row.authorId) || lead.has(row.addresseeId) || a.scope.functional.includes(row.addresseeId);
}

function canOf(a: Access, row: Pick<Row, "authorId" | "addresseeId" | "status" | "resultTaskId" | "remindedAt">, now: Date): RequestCan {
  const none: RequestCan = { accept: false, decline: false, done: false, toTask: false, withdraw: false, remind: false };
  if (a.actor.role === "OBSERVER" || !ACTIVE.includes(row.status)) return none;
  const me = a.actor.personId;
  const addressee = row.addresseeId === me;
  const author = row.authorId === me;
  // Режим управления решает за адресата, но не за себя: своя просьба у владельца остаётся просьбой
  const forAddressee = addressee || (!!a.actor.management && !author);
  // Просьба стала задачей: срок и итог живут в задаче, просьба идёт за ней сама
  const linked = !!row.resultTaskId;
  return {
    accept: forAddressee && !linked,
    decline: forAddressee && !linked,
    done: forAddressee && !linked,
    // Задачу из просьбы ставит себе сам адресат: она живёт в его команде
    toTask: addressee && !row.resultTaskId,
    withdraw: author || !!a.actor.management,
    remind: author && (!row.remindedAt || now.getTime() - row.remindedAt.getTime() >= REMIND_GAP_MS),
  };
}

function toView(a: Access, row: Row, now: Date): RequestView {
  const today = moscowToday(now);
  const status = STATUS_CODE[row.status];
  const due = isoFromDbDate(row.due);
  const acceptedDue = row.acceptedDue ? isoFromDbDate(row.acceptedDue) : null;
  const me = a.actor.personId;
  const task = row.task && !row.task.archivedAt && seesTask(a.scope, row.task, me) ? { number: row.task.number, title: row.task.title } : null;
  const resultTask = row.resultTask && seesTask(a.scope, row.resultTask, me) ? { number: row.resultTask.number, title: row.resultTask.title } : null;
  const entry =
    row.entry && seesEntry(a.scope, a.nodes, { authorId: row.entry.authorId, ceo: row.entry.ceo, promotedBy: row.entry.promotions.map((p) => p.byId) }, me)
      ? { id: row.entry.id, what: row.entry.what }
      : null;
  return {
    number: row.number,
    status,
    text: row.text,
    author: row.author.slug as PersonSlug,
    addressee: row.addressee.slug as PersonSlug,
    due,
    acceptedDue,
    answer: row.answer,
    task,
    entry,
    resultTask,
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    remindedAt: row.remindedAt?.toISOString() ?? null,
    stuck: isStuck({ status, created: moscowIso(row.createdAt), due, acceptedDue }, today),
    overdue: isRequestOverdue({ status, due, acceptedDue }, today),
    can: canOf(a, row, now),
  };
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
}

function required(text: string | null | undefined, max: number, empty: string, field: string): string {
  const value = clean(text);
  if (!value) fail(empty);
  if (value.length > max) fail(`${field}: не длиннее ${max} знаков`);
  return value;
}

function futureDate(value: unknown, now: Date, empty: string): IsoDate {
  if (!isIsoDate(value)) return fail(empty);
  if (value < moscowToday(now)) fail("Срок не может быть в прошлом");
  return value;
}

async function audit(db: Db, actor: Actor, number: number, field: string, before: string | null, after: string, action: string): Promise<void> {
  await db.auditLog.create({
    data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "request", entityId: String(number), field, before: before ?? undefined, after, ip: actor.ip ?? null, via: actor.via ?? null },
  });
}

/** Строка просьбы под замком: два человека не ответят на неё одновременно. Чужую просьбу не подтверждаем даже номером */
/** Номер просьбы в пределах целого базы: иначе запрос упадёт, а не ответит «нет такой» */
const validNumber = (n: number) => Number.isInteger(n) && n >= 1 && n <= 2_147_483_647;

async function lockRequest(tx: Tx, a: Access, number: number): Promise<Row> {
  if (!validNumber(number)) fail("Нет такой просьбы");
  await tx.$queryRaw`SELECT id FROM "help_requests" WHERE "number" = ${number} FOR UPDATE`;
  const row = await tx.helpRequest.findUnique({ where: { number }, include: requestInclude });
  if (!row || !seesRequest(a, row)) fail(`Просьбы ${number} нет`);
  return row!;
}

function stateLabel(row: Pick<Row, "status" | "acceptedDue">): string {
  const label = REQUEST_STATUS[STATUS_CODE[row.status]].label;
  return row.status === "ACCEPTED" && row.acceptedDue ? `${label}, срок ${formatShort(isoFromDbDate(row.acceptedDue))}` : label;
}

// ---------- Создание ----------

export type NewRequestInput = {
  /** Кого просим: короткое имя */
  to: string;
  text: string;
  due: IsoDate;
  /** Номер задачи, к которой просьба */
  task?: number | null;
  /** Запись weekly, из которой просьба */
  entry?: string | null;
};

/** Новая просьба внутри транзакции: создание проверяет адресата, задачу и запись, пишет событие и журнал */
export async function createRequestIn(tx: Tx, actor: Actor, input: NewRequestInput, now = new Date()): Promise<Row> {
  if (actor.role === "OBSERVER") fail("Наблюдатель просьб не создаёт");
  const text = required(input.text, REQUEST_TEXT_MAX, "Напишите, что нужно", "Просьба");
  const due = futureDate(input.due, now, "Укажите, к какому сроку нужно");
  const to = await tx.person.findUnique({ where: { slug: String(input.to ?? "") } });
  if (!to || !to.active || to.role === "OBSERVER") fail("Выберите, кого просите, из списка");
  if (to!.id === actor.personId) fail("Себя просить не нужно: поставьте себе задачу");
  const a = await accessOf(tx, actor);
  if (a.limited && !(a.top.has(actor.personId) && a.top.has(to!.id))) fail("По общему логину просить можно только людей топ-команды. Войдите лично");
  let taskId: string | null = null;
  if (input.task !== undefined && input.task !== null) {
    const task = await tx.task.findUnique({ where: { number: Number(input.task) }, select: taskSelect });
    if (!task || task.archivedAt || !seesTask(a.scope, task, actor.personId)) fail(`Задачи ${input.task} нет`);
    taskId = task!.id;
  }
  let entryId: string | null = null;
  if (input.entry) {
    const entry = await tx.weeklyEntry.findUnique({ where: { id: String(input.entry) }, select: { id: true, authorId: true, ceo: true, promotions: { select: { byId: true } } } });
    if (!entry || !seesEntry(a.scope, a.nodes, { authorId: entry.authorId, ceo: entry.ceo, promotedBy: entry.promotions.map((p) => p.byId) }, actor.personId)) fail("Запись weekly не найдена");
    entryId = entry!.id;
  }
  const row = await tx.helpRequest.create({
    data: { authorId: actor.personId, addresseeId: to!.id, text, due: dbDate(due), taskId, entryId, createdAt: now },
    include: requestInclude,
  });
  await notify(tx, { kind: "REQUEST", recipients: [to!.id], actor, subject: requestSubject(row.number), text: `Просит: ${quote(text)}. Срок ${formatShort(due)}`, requestId: row.id }, now);
  await audit(tx, actor, row.number, "Просьба", null, `${to!.fullName}: ${text}. Срок ${formatShort(due)}`, "request.create");
  return row;
}

export async function createRequest(actor: Actor, input: NewRequestInput, now = new Date()): Promise<RequestView> {
  return prisma.$transaction(async (tx) => {
    const row = await createRequestIn(tx, actor, input, now);
    return toView(await accessOf(tx, actor), row, now);
  });
}

/**
 * «Заблокирована, ждёт человека» (этап 21, модуль М5): одной транзакцией просьба к человеку по задаче и состояние
 * задачи. Пояснение необязательно, без него в задаче будет «Ждёт ответа: имя»
 */
export async function blockOnPerson(actor: Actor, taskNumber: number, input: { to: string; text: string; due: IsoDate; note?: string | null }, now = new Date()): Promise<{ task: TaskResult; request: RequestView }> {
  return prisma.$transaction(async (tx) => {
    const row = await createRequestIn(tx, actor, { to: input.to, text: input.text, due: input.due, task: taskNumber }, now);
    const task = await changeStateIn(tx, actor, taskNumber, "blocked", input.note ?? null);
    return { task, request: toView(await accessOf(tx, actor), row, now) };
  });
}

// ---------- Ответы ----------

type Step = (row: Row, a: Access, tx: Tx) => Promise<void>;

async function step(actor: Actor, number: number, now: Date, run: Step): Promise<RequestView> {
  return prisma.$transaction(async (tx) => {
    const a = await accessOf(tx, actor);
    const row = await lockRequest(tx, a, number);
    await run(row, a, tx);
    // Человек ответил на просьбу или напомнил о ней: его собственные события по ней разобраны
    await tx.inboxEvent.updateMany({ where: { recipientId: actor.personId, subject: requestSubject(row.number), doneAt: null }, data: { doneAt: now } });
    const fresh = await tx.helpRequest.findUniqueOrThrow({ where: { id: row.id }, include: requestInclude });
    return toView(a, fresh, now);
  });
}

function closedFail(row: Row): never {
  return fail(`Просьба уже ${REQUEST_STATUS[STATUS_CODE[row.status]].label.toLowerCase()}`);
}

/** Принять просьбу и назвать срок. У принятой просьбы так же меняется срок */
export async function acceptRequest(actor: Actor, number: number, due: IsoDate, now = new Date()): Promise<RequestView> {
  return step(actor, number, now, async (row, a, tx) => {
    const can = canOf(a, row, now);
    if (!ACTIVE.includes(row.status)) closedFail(row);
    if (row.resultTaskId) fail(`Срок просьбы идёт за задачей ${row.resultTask?.number ?? ""}: перенесите срок задачи`.replace(" :", ":"));
    if (!can.accept) fail("Принять просьбу может адресат");
    const date = futureDate(due, now, "Назовите срок, к которому сделаете");
    if (row.status === "ACCEPTED" && row.acceptedDue && isoFromDbDate(row.acceptedDue) === date) fail("Срок уже такой");
    const before = stateLabel(row);
    const updated = await tx.helpRequest.update({ where: { id: row.id }, data: { status: "ACCEPTED", acceptedDue: dbDate(date), answeredAt: row.answeredAt ?? now } });
    const text = row.status === "OPEN" ? `Просьба принята, срок ${formatShort(date)}` : `Новый срок по просьбе: ${formatShort(date)}`;
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [row.authorId, row.addresseeId], actor, subject: requestSubject(row.number), text, requestId: row.id }, now);
    await audit(tx, actor, row.number, "Состояние", before, stateLabel(updated), "request.accept");
  });
}

/** Отклонить с причиной */
export async function declineRequest(actor: Actor, number: number, reason: string, now = new Date()): Promise<RequestView> {
  return step(actor, number, now, async (row, a, tx) => {
    if (!ACTIVE.includes(row.status)) closedFail(row);
    if (row.resultTaskId) fail(`Просьба стала задачей ${row.resultTask?.number ?? ""}: закройте задачу, и просьба закроется вместе с ней`.replace(" :", ":"));
    if (!canOf(a, row, now).decline) fail("Отклонить просьбу может адресат");
    const answer = required(reason, REQUEST_ANSWER_MAX, "Напишите причину: без неё отклонить нельзя", "Причина");
    await tx.helpRequest.update({ where: { id: row.id }, data: { status: "DECLINED", answer, answeredAt: row.answeredAt ?? now, closedAt: now } });
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [row.authorId, row.addresseeId], actor, subject: requestSubject(row.number), text: `Просьба отклонена: ${quote(answer)}`, requestId: row.id }, now);
    await audit(tx, actor, row.number, "Состояние", stateLabel(row), `Отклонена. ${answer}`, "request.decline");
  });
}

/** Выполнено, с необязательным итогом */
export async function completeRequest(actor: Actor, number: number, note: string | null | undefined, now = new Date()): Promise<RequestView> {
  return step(actor, number, now, async (row, a, tx) => {
    if (!ACTIVE.includes(row.status)) closedFail(row);
    if (row.resultTaskId) fail(`Просьба стала задачей ${row.resultTask?.number ?? ""}: закройте задачу, и просьба закроется вместе с ней`.replace(" :", ":"));
    if (!canOf(a, row, now).done) fail("Отметить просьбу выполненной может адресат");
    const answer = clean(note) || null;
    if (answer && answer.length > REQUEST_ANSWER_MAX) fail(`Итог: не длиннее ${REQUEST_ANSWER_MAX} знаков`);
    await tx.helpRequest.update({ where: { id: row.id }, data: { status: "DONE", answer, answeredAt: row.answeredAt ?? now, closedAt: now } });
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [row.authorId, row.addresseeId], actor, subject: requestSubject(row.number), text: answer ? `Просьба выполнена: ${quote(answer)}` : "Просьба выполнена", requestId: row.id }, now);
    await audit(tx, actor, row.number, "Состояние", stateLabel(row), answer ? `Выполнена. ${answer}` : "Выполнена", "request.done");
  });
}

/** Автор отзывает просьбу: больше не нужна */
export async function withdrawRequest(actor: Actor, number: number, now = new Date()): Promise<RequestView> {
  return step(actor, number, now, async (row, a, tx) => {
    if (!ACTIVE.includes(row.status)) closedFail(row);
    if (!canOf(a, row, now).withdraw) fail("Отозвать просьбу может её автор");
    await tx.helpRequest.update({ where: { id: row.id }, data: { status: "WITHDRAWN", closedAt: now } });
    // Задача из просьбы остаётся у адресата: он решает сам, отменить её или довести
    const open = row.resultTask && (await tx.task.findUnique({ where: { id: row.resultTask.id }, select: { status: true } }));
    const tail = open && !CLOSED_DB.includes(open.status) ? `. Задачу ${row.resultTask!.number} можно отменить` : "";
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [row.addresseeId, row.authorId], actor, subject: requestSubject(row.number), text: `Просьбу отозвали: делать не нужно${tail}`, requestId: row.id }, now);
    await audit(tx, actor, row.number, "Состояние", stateLabel(row), "Отозвана", "request.withdraw");
  });
}

/** Автор напоминает адресату: не чаще раза в сутки */
export async function remindRequest(actor: Actor, number: number, now = new Date()): Promise<RequestView> {
  return step(actor, number, now, async (row, a, tx) => {
    if (!ACTIVE.includes(row.status)) closedFail(row);
    if (row.authorId !== actor.personId) fail("Напомнить о просьбе может её автор");
    if (!canOf(a, row, now).remind) fail("Напомнить можно раз в сутки: напоминание уже ушло");
    await tx.helpRequest.update({ where: { id: row.id }, data: { remindedAt: now } });
    await notify(tx, { kind: "REQUEST", recipients: [row.addresseeId], actor, subject: requestSubject(row.number), text: `Напоминает о просьбе: ${quote(row.text)}`, requestId: row.id }, now);
    await audit(tx, actor, row.number, "Напоминание", null, "Напоминание адресату", "request.remind");
  });
}

/**
 * Адресат делает просьбу своей задачей: в его команде, со сроком, который он назвал (или просимым), с источником
 * «просьба». Открытая просьба при этом становится принятой. Когда задачу выполнят, просьба закроется сама
 */
export async function requestToTask(actor: Actor, number: number, direction: string | null | undefined, now = new Date()): Promise<{ request: RequestView; task: number }> {
  let created = 0;
  const request = await step(actor, number, now, async (row, a, tx) => {
    if (!ACTIVE.includes(row.status)) closedFail(row);
    const can = canOf(a, row, now);
    if (row.resultTaskId) fail(`Из просьбы уже сделана задача ${row.resultTask?.number ?? ""}`.trim());
    if (!can.toTask) fail("Сделать задачей просьбу может её адресат");
    const today = moscowToday(now);
    const wanted = row.acceptedDue ? isoFromDbDate(row.acceptedDue) : isoFromDbDate(row.due);
    const due = wanted < today ? today : wanted;
    let code = direction ? String(direction) : null;
    if (!code && row.task) code = (await tx.dictionaryItem.findUnique({ where: { id: row.task.directionId }, select: { code: true } }))?.code ?? null;
    if (!code) fail("Выберите направление задачи");
    const { task } = await createTaskIn(tx, actor, {
      title: taskTitleFrom(row.text),
      outcome: row.text,
      owner: row.addressee.slug as PersonSlug,
      direction: code!,
      due,
      source: "other",
      sourceNote: `Просьба ${row.number}: ${row.author.fullName}`.slice(0, 200),
    });
    const taskRow = await tx.task.findUniqueOrThrow({ where: { number: task.number }, select: { id: true } });
    created = task.number;
    const before = stateLabel(row);
    const updated = await tx.helpRequest.update({
      where: { id: row.id },
      data: { resultTaskId: taskRow.id, status: "ACCEPTED", acceptedDue: row.acceptedDue ?? dbDate(due), answeredAt: row.answeredAt ?? now },
    });
    await notify(tx, { kind: "REQUEST_ANSWER", recipients: [row.authorId], actor, subject: requestSubject(row.number), text: `Просьба стала задачей ${task.number}, срок ${formatShort(isoFromDbDate(updated.acceptedDue!))}`, requestId: row.id }, now);
    await audit(tx, actor, row.number, "Задача", before, `Задача ${task.number}. ${stateLabel(updated)}`, "request.task");
  });
  return { request, task: created };
}

// ---------- Чтение ----------

/** Одна просьба для страницы. null: нет или человек её не видит */
export async function getRequest(actor: Actor, number: number, now = new Date()): Promise<RequestView | null> {
  if (!validNumber(number)) return null;
  const row = await prisma.helpRequest.findUnique({ where: { number }, include: requestInclude });
  if (!row) return null;
  const a = await accessOf(prisma, actor);
  return seesRequest(a, row) ? toView(a, row, now) : null;
}

/** История просьбы из журнала: свежее сверху */
export async function requestHistory(number: number): Promise<{ at: string; by: string | null; field: string; before: string | null; after: string | null }[]> {
  const rows = await prisma.auditLog.findMany({ where: { entity: "request", entityId: String(number) }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 100 });
  const text = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v));
  return rows.map((r) => ({ at: r.at.toISOString(), by: r.actorName, field: r.field ?? r.action, before: text(r.before), after: text(r.after) }));
}

/** Закрытые просьбы показываем автору ещё неделю: он видит ответ */
const RECENT_CLOSED_MS = 7 * 24 * 60 * 60 * 1000;

/** Просьбы человека: к нему (открытые и принятые) и его собственные («Жду от коллег»), свежие ответы тоже */
export async function myRequests(actor: Actor, now = new Date()): Promise<{ incoming: RequestView[]; outgoing: RequestView[] }> {
  const a = await accessOf(prisma, actor);
  const since = new Date(now.getTime() - RECENT_CLOSED_MS);
  const [incoming, outgoing] = await Promise.all([
    prisma.helpRequest.findMany({ where: { addresseeId: actor.personId, status: { in: ACTIVE } }, include: requestInclude, orderBy: [{ due: "asc" }, { number: "asc" }], take: 200 }),
    prisma.helpRequest.findMany({
      where: { authorId: actor.personId, OR: [{ status: { in: ACTIVE } }, { closedAt: { gte: since } }] },
      include: requestInclude,
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    }),
  ]);
  const order = (r: RequestView) => (r.status === "open" || r.status === "accepted" ? 0 : 1);
  return {
    incoming: incoming.filter((r) => seesRequest(a, r)).map((r) => toView(a, r, now)),
    outgoing: outgoing
      .filter((r) => seesRequest(a, r))
      .map((r) => toView(a, r, now))
      .sort((x, y) => order(x) - order(y)),
  };
}

/** Просьбы по задаче: к ней и сделанные ею. Только те, что человек видит */
export async function requestsForTask(actor: Actor, taskNumber: number, now = new Date()): Promise<RequestView[]> {
  const task = await prisma.task.findUnique({ where: { number: taskNumber }, select: { id: true } });
  if (!task) return [];
  const a = await accessOf(prisma, actor);
  const rows = await prisma.helpRequest.findMany({ where: { OR: [{ taskId: task.id }, { resultTaskId: task.id }] }, include: requestInclude, orderBy: { number: "desc" }, take: 50 });
  return rows.filter((r) => seesRequest(a, r)).map((r) => toView(a, r, now));
}

export type StaleProposal = { number: number; title: string; owner: PersonSlug | null; createdBy: PersonSlug | null; days: number };

/**
 * Что зависло, для встречи: просьбы без ответа больше 2 рабочих дней и принятые, но просроченные, где автор или адресат
 * в показанных командах; предложенные задачи этих команд без ответа 3 дня и дольше. Только то, что человек видит
 */
export async function stuckForMeeting(actor: Actor, teamIds: string[], now = new Date()): Promise<{ requests: RequestView[]; proposals: StaleProposal[] }> {
  if (!teamIds.length) return { requests: [], proposals: [] };
  const a = await accessOf(prisma, actor);
  const people = new Set<string>();
  for (const n of a.nodes) {
    if (!teamIds.includes(n.id)) continue;
    if (n.leaderId) people.add(n.leaderId);
    for (const m of n.members) people.add(m);
  }
  const ids = [...people];
  const staleSince = new Date(now.getTime() - PROPOSAL_STALE_DAYS * 24 * 60 * 60 * 1000);
  const [rows, proposed] = await Promise.all([
    ids.length
      ? prisma.helpRequest.findMany({
          where: { status: { in: ACTIVE }, OR: [{ authorId: { in: ids } }, { addresseeId: { in: ids } }] },
          include: requestInclude,
          orderBy: { createdAt: "asc" },
          take: 300,
        })
      : Promise.resolve([]),
    prisma.task.findMany({
      where: {
        status: "PROPOSED",
        archivedAt: null,
        createdAt: { lte: staleSince },
        OR: [{ teamId: { in: teamIds } }, ...(ids.length ? [{ ownerId: { in: ids } }] : [])],
      },
      include: { owner: { select: { slug: true } }, createdBy: { select: { slug: true } }, coExecutors: { select: { personId: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
  ]);
  const requests = rows
    .filter((r) => seesRequest(a, r))
    .map((r) => toView(a, r, now))
    .filter((r) => r.stuck);
  const proposals = proposed
    .filter((t) => !CLOSED_DB.includes(t.status) && seesTask(a.scope, t, actor.personId))
    .map((t) => ({
      number: t.number,
      title: t.title,
      owner: (t.owner?.slug as PersonSlug | undefined) ?? null,
      createdBy: (t.createdBy?.slug as PersonSlug | undefined) ?? null,
      days: Math.floor((now.getTime() - t.createdAt.getTime()) / 86_400_000),
    }));
  return { requests, proposals };
}
