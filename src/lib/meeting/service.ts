// Встреча 2.0 на сервере (этап 23, модуль М7). У недели и команды один объект «Встреча»: повестка собирается сама из
// поручений прошлой встречи, зависших просьб и предложений, рисков и блокеров, вопросов к записям, лидеров по очереди.
// Ведущий ведёт живой режим: его текущий пункт хранится в базе, экраны участников идут за ним через живые обновления.
// Решения остаются в журнале, после закрытия участникам уходит протокол. Права проверяются здесь, экран только прячет.

import { prisma } from "@/lib/db";
import type { AgendaKind, DecisionStatus, MeetingStatus, Prisma } from "@/generated/prisma/client";
import { addDays, formatLong, formatShort, type IsoDate } from "@/domain/dates";
import type { PersonSlug, WeekKey } from "@/domain/types";
import { AGENDA_KIND_LABELS, type AgendaItemView, type AgendaKindCode, type DecisionView, type MeetingStatusCode, type MeetingView } from "@/domain/meeting";
import { statusOf, stateLabel } from "@/domain/dictionaries";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { statusCode, stateCode, CLOSED_DB } from "@/lib/tasks/codes";
import { dbDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { loadScope, loadTeamNodes, TOP_TEAM, type Scope, type TeamNode } from "@/lib/org/scope";
import { expectedOf, leadersOf, teamMeeting } from "@/lib/org/rhythm";
import { ensureWeek, weekSettings } from "@/lib/weekly/service";
import { meetingOf, shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { stuckForMeeting } from "@/lib/requests/service";
import { meetingQuestions } from "@/lib/discuss/service";
import { notify, taskSubject } from "@/lib/inbox/notify";
import { mailConfigured, sendMail } from "@/lib/mail";
import { initiativesForAgenda } from "@/lib/initiatives/service";
import { agendaTitle, STATE_CODE as INITIATIVE_STATE } from "@/lib/initiatives/rules";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const MEETING_LIMITS = { title: 300, note: 1000, decision: 1000, reason: 300 };

/** Кто смотрит: общий логин без режима управления ограничен (этап 14) */
const subjectOf = (actor: Actor) => ({ id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management });
const appUrl = () => (process.env.APP_URL ?? "").replace(/\/+$/, "");

const STATUS_CODE: Record<MeetingStatus, MeetingStatusCode> = { PLANNED: "planned", LIVE: "live", DONE: "done" };
const KIND_CODE: Record<AgendaKind, AgendaKindCode> = {
  FOLLOW_UP: "follow-up",
  REQUEST: "request",
  TASK_STATE: "task-state",
  TASK_ATTENTION: "task-attention",
  QUESTION: "question",
  PROPOSAL: "proposal",
  PERSON: "person",
  MANUAL: "manual",
  INITIATIVE: "initiative",
};
const DECISION_CODE: Record<DecisionStatus, "active" | "cancelled"> = { ACTIVE: "active", CANCELLED: "cancelled" };

/** Порядок блоков: поручения прошлой встречи, риски и помощь, лидеры, ручные пункты в конце блока «риски» */
const KIND_ORDER: Record<AgendaKind, number> = { FOLLOW_UP: 0, REQUEST: 10, TASK_STATE: 11, TASK_ATTENTION: 12, PROPOSAL: 13, QUESTION: 14, INITIATIVE: 15, MANUAL: 20, PERSON: 30 };

/** Просрочка, с которой задача попадает на встречу сама */
const OVERDUE_DAYS = 7;

const meetingInclude = {
  week: { select: { start: true, isoNumber: true } },
  team: { select: { id: true, name: true } },
  leader: { select: { slug: true } },
  items: {
    where: { removedAt: null },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      task: { select: { number: true, title: true, status: true, state: true, due: true, owner: { select: { slug: true } }, ownerAll: true } },
      entry: { select: { id: true, what: true, author: { select: { slug: true } } } },
      request: { select: { number: true, text: true, status: true, author: { select: { slug: true } }, addressee: { select: { slug: true } } } },
      person: { select: { slug: true } },
      initiative: { select: { id: true, title: true, state: true, note: true } },
      discussedBy: { select: { slug: true } },
      decisions: { include: decisionIncludeInner(), orderBy: { createdAt: "asc" as const } },
    },
  },
  decisions: { include: decisionIncludeInner(), orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.MeetingInclude;

function decisionIncludeInner() {
  return {
    owner: { select: { slug: true } },
    createdBy: { select: { slug: true } },
    tasks: { include: { task: { select: { number: true, title: true } } } },
    meeting: { select: { week: { select: { start: true, isoNumber: true } }, team: { select: { name: true } } } },
  } satisfies Prisma.DecisionInclude;
}

type MeetingRow = Prisma.MeetingGetPayload<{ include: typeof meetingInclude }>;
type DecisionRow = Prisma.DecisionGetPayload<{ include: ReturnType<typeof decisionIncludeInner> }>;

export function decisionDto(d: DecisionRow): DecisionView {
  return {
    id: d.id,
    text: d.text,
    owner: (d.owner?.slug as PersonSlug | undefined) ?? null,
    date: isoFromDbDate(d.date),
    status: DECISION_CODE[d.status],
    ...(d.cancelReason ? { cancelReason: d.cancelReason } : {}),
    tasks: d.tasks.map((t) => ({ number: t.task.number, title: t.task.title })),
    ...(d.meeting ? { meeting: { week: isoFromDbDate(d.meeting.week.start), number: d.meeting.week.isoNumber, team: d.meeting.team.name } } : {}),
    createdBy: (d.createdBy?.slug as PersonSlug | undefined) ?? null,
  };
}

function itemDto(i: MeetingRow["items"][number]): AgendaItemView {
  return {
    id: i.id,
    kind: KIND_CODE[i.kind],
    title: i.title,
    ...(i.note ? { note: i.note } : {}),
    sortOrder: i.sortOrder,
    auto: i.autoKey !== null,
    discussed: i.discussedAt !== null,
    ...(i.discussedBy ? { discussedBy: i.discussedBy.slug as PersonSlug } : {}),
    ...(i.task
      ? {
          task: {
            number: i.task.number,
            title: i.task.title,
            status: statusCode(i.task.status),
            state: stateCode(i.task.state),
            due: isoFromDbDate(i.task.due),
            owner: i.task.ownerAll ? ("all" as PersonSlug) : ((i.task.owner?.slug as PersonSlug | undefined) ?? null),
          },
        }
      : {}),
    ...(i.entry ? { entry: { id: i.entry.id, what: i.entry.what, author: (i.entry.author?.slug as PersonSlug | undefined) ?? null } } : {}),
    ...(i.request
      ? { request: { number: i.request.number, text: i.request.text, status: i.request.status.toLowerCase(), author: i.request.author.slug as PersonSlug, addressee: i.request.addressee.slug as PersonSlug } }
      : {}),
    ...(i.person ? { person: i.person.slug as PersonSlug } : {}),
    ...(i.initiative ? { initiative: { id: i.initiative.id, title: i.initiative.title, state: INITIATIVE_STATE[i.initiative.state], note: i.initiative.note } } : {}),
    decisions: i.decisions.map(decisionDto),
  };
}

// ---------- Доступ ----------

type Access = { actor: Actor; scope: Scope; nodes: TeamNode[]; node: TeamNode };

async function accessTo(db: Db, actor: Actor, teamId: string): Promise<Access> {
  const nodes = await loadTeamNodes(db);
  const node = nodes.find((n) => n.id === teamId && n.active);
  if (!node) return fail("Такой команды нет");
  const scope = await loadScope(db, subjectOf(actor));
  if (!scope.all && !scope.visible.includes(teamId) && !scope.member.includes(teamId)) fail("Встречи этой команды вы не видите");
  return { actor, scope, nodes, node };
}

/** Вести встречу: режим управления, руководитель команды и руководители выше. У топ-команды её руководитель или управление */
function canLead(a: Access): boolean {
  if (a.actor.role === "OBSERVER") return false;
  if (a.actor.management) return true;
  if (a.actor.via === "TEAM") return false;
  if (a.node.leaderId === a.actor.personId) return true;
  return a.scope.leads.includes(a.node.id);
}

function requireLead(a: Access, what: string): void {
  if (!canLead(a)) fail(`${what}: ведёт встречу руководитель команды, руководитель выше или режим управления${a.actor.via === "TEAM" ? ", при личном входе" : ""}`);
}

/** Люди команды: ведущие и участники, от кого ждут weekly */
function participantsOf(nodes: TeamNode[], node: TeamNode): string[] {
  return [...new Set([...(node.leaderId ? [node.leaderId] : []), ...expectedOf(node, leadersOf(nodes)), ...node.members])];
}

// ---------- Чтение ----------

async function toView(db: Db, a: Access, row: MeetingRow): Promise<MeetingView> {
  const people = await db.person.findMany({ where: { id: { in: participantsOf(a.nodes, a.node) }, active: true }, select: { slug: true }, orderBy: { sortOrder: "asc" } });
  const { meeting } = await weekSettings();
  const key = isoFromDbDate(row.week.start);
  const slot = teamMeeting(key, a.node, meetingOf(key, meeting));
  return {
    id: row.id,
    week: key,
    weekNumber: row.week.isoNumber,
    team: row.team.id,
    teamName: row.team.name,
    date: isoFromDbDate(row.date),
    time: slot.time,
    status: STATUS_CODE[row.status],
    leader: (row.leader?.slug as PersonSlug | undefined) ?? null,
    currentItemId: row.currentItemId,
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.closedAt ? { closedAt: row.closedAt.toISOString() } : {}),
    ...(row.agendaBuiltAt ? { agendaBuiltAt: row.agendaBuiltAt.toISOString() } : {}),
    timerMinutes: row.timerMinutes,
    ...(row.protocol ? { protocol: row.protocol } : {}),
    ...(row.protocolSentAt ? { protocolSentAt: row.protocolSentAt.toISOString() } : {}),
    ...(row.notionUrl ? { notionUrl: row.notionUrl } : {}),
    items: row.items.map(itemDto),
    decisions: row.decisions.map(decisionDto),
    participants: people.map((p) => p.slug as PersonSlug),
    canLead: canLead(a),
  };
}

/** Встреча команды за неделю. null: ещё не собрана */
export async function getMeeting(actor: Actor, teamId: string, key: WeekKey): Promise<MeetingView | null> {
  const a = await accessTo(prisma, actor, teamId);
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
  if (!week) return null;
  const row = await prisma.meeting.findUnique({ where: { weekId_teamId: { weekId: week.id, teamId } }, include: meetingInclude });
  return row ? toView(prisma, a, row) : null;
}

/** Может ли человек вести встречи команды: для кнопки «Собрать повестку» до того, как встреча есть */
export async function canLeadTeam(actor: Actor, teamId: string): Promise<boolean> {
  try {
    return canLead(await accessTo(prisma, actor, teamId));
  } catch {
    return false;
  }
}

// ---------- Повестка ----------

type Draft = {
  kind: AgendaKind;
  autoKey: string;
  title: string;
  note?: string | null;
  taskId?: string;
  entryId?: string;
  requestId?: string;
  personId?: string;
  reactionId?: string;
  initiativeId?: string;
};

/** Предложения пунктов по данным команды на неделю. Каждый пункт сформулирован вопросом */
async function collectAgenda(a: Access, key: WeekKey, today: IsoDate): Promise<Draft[]> {
  const team = a.node;
  const people = participantsOf(a.nodes, team);
  const prevKey = shiftWeek(key, -1);
  const drafts: Draft[] = [];

  // Поручения прошлой встречи: задачи команды, поставленные на ней (источник «Встреча», дата прошлой встречи), и
  // задачи, созданные за время прошлой встречи в живом режиме
  const prev = await prisma.meeting.findFirst({ where: { teamId: team.id, week: { start: dbDate(prevKey) } }, select: { date: true, startedAt: true, closedAt: true } });
  const { meeting } = await weekSettings();
  const prevDate = prev ? isoFromDbDate(prev.date) : teamMeeting(prevKey, team, meetingOf(prevKey, meeting)).date;
  const thisDate = teamMeeting(key, team, meetingOf(key, meeting)).date;
  // Поручения: задачи с источником «встреча», поставленные с прошлой встречи до этой (и на следующий день после разбора
  // в Notion), и задачи, созданные за время прошлой встречи в живом режиме
  const followUps = await prisma.task.findMany({
    where: {
      teamId: team.id,
      archivedAt: null,
      OR: [
        { sourceCode: "meeting", sourceDate: { gte: dbDate(prevDate), lt: dbDate(thisDate) } },
        ...(prev?.startedAt && prev.closedAt ? [{ createdAt: { gte: prev.startedAt, lte: prev.closedAt } }] : []),
      ],
    },
    select: { id: true, number: true, title: true, status: true },
    orderBy: { number: "asc" },
  });
  for (const t of followUps) {
    const closed = CLOSED_DB.includes(t.status);
    drafts.push({ kind: "FOLLOW_UP", autoKey: `follow:${t.id}`, taskId: t.id, title: closed ? `Поручение ${t.number} закрыто: ${t.title}. Принимаем итог?` : `Поручение ${t.number}: ${t.title}. Где оно сейчас?` });
  }

  // Зависшие просьбы и предложения (этап 21)
  const stuck = await stuckForMeeting(a.actor, [team.id]);
  const slugs = new Map((await prisma.person.findMany({ where: { id: { in: people } }, select: { id: true, slug: true } })).map((p) => [p.slug, p.id]));
  for (const r of stuck.requests) {
    // Только просьбы людей этой команды: повестку видит вся команда
    if (!slugs.has(r.author) && !slugs.has(r.addressee)) continue;
    const row = await prisma.helpRequest.findUnique({ where: { number: r.number }, select: { id: true } });
    if (!row) continue;
    drafts.push({ kind: "REQUEST", autoKey: `request:${row.id}`, requestId: row.id, title: r.status === "open" ? `Просьба ${r.number} без ответа: ${r.text}. Кто и когда ответит?` : `Просьба ${r.number} просрочена: ${r.text}. Что дальше?` });
  }
  for (const p of stuck.proposals) {
    const row = await prisma.task.findUnique({ where: { number: p.number }, select: { id: true, teamId: true } });
    if (!row || (row.teamId !== team.id && !(p.owner && slugs.has(p.owner)))) continue;
    drafts.push({ kind: "PROPOSAL", autoKey: `proposal:${row.id}`, taskId: row.id, title: `Предложение ${p.number} без ответа ${p.days} дн.: ${p.title}. Берём или отклоняем?` });
  }

  // Задачи команды: заблокированы или в риске; критичные; просрочены больше недели
  const open = await prisma.task.findMany({
    where: { teamId: team.id, archivedAt: null, status: { in: ["IN_PROGRESS", "CLARIFY"] } },
    select: { id: true, number: true, title: true, state: true, priority: true, due: true, blockedBy: true, riskNote: true },
    orderBy: { number: "asc" },
  });
  for (const t of open) {
    if (t.state === "BLOCKED") drafts.push({ kind: "TASK_STATE", autoKey: `state:${t.id}`, taskId: t.id, title: `Задача ${t.number} заблокирована: ${t.title}. Что разблокирует?`, note: t.blockedBy });
    else if (t.state === "AT_RISK") drafts.push({ kind: "TASK_STATE", autoKey: `state:${t.id}`, taskId: t.id, title: `Задача ${t.number} в риске: ${t.title}. Хватит ли того, что вернёт её в график?`, note: t.riskNote });
    const due = isoFromDbDate(t.due);
    const overdue = due < today ? Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000) : 0;
    if (t.priority === "CRITICAL") drafts.push({ kind: "TASK_ATTENTION", autoKey: `attention:${t.id}`, taskId: t.id, title: `Критичная задача ${t.number}: ${t.title}. Что по ней на этой неделе?` });
    else if (overdue > OVERDUE_DAYS) drafts.push({ kind: "TASK_ATTENTION", autoKey: `attention:${t.id}`, taskId: t.id, title: `Задача ${t.number} просрочена на ${overdue} дн.: ${t.title}. Новый срок или снимаем?` });
  }

  // Крупные инициативы людей команды: долго ищут, как сделать, или давно без новостей (этап 30)
  for (const i of await initiativesForAgenda(people)) {
    const title = agendaTitle(i.title, i.flags);
    // Заметку пункт показывает из самой инициативы: она всегда свежая
    if (title) drafts.push({ kind: "INITIATIVE", autoKey: `initiative:${i.id}`, initiativeId: i.id, title });
  }

  // Вопросы «Обсудить на встрече» к записям недели и задачам команды (этап 20)
  const entryIds = (await prisma.weeklyEntry.findMany({ where: { week: { start: dbDate(key) }, authorId: { in: people } }, select: { id: true } })).map((e) => e.id);
  const questions = await meetingQuestions(a.actor, key, { current: entryIds }, [team.id]);
  for (const q of questions) {
    if (q.discussed) continue;
    // Вопрос к записи человека другой команды сюда не попадает
    if (q.entry && (!q.entry.author || !slugs.has(q.entry.author))) continue;
    const reaction = await prisma.reaction.findUnique({ where: { id: q.id }, select: { entryId: true, entryComment: { select: { entryId: true } }, taskComment: { select: { taskId: true } } } });
    const entryId = reaction?.entryId ?? reaction?.entryComment?.entryId ?? undefined;
    const taskId = reaction?.taskComment?.taskId ?? undefined;
    drafts.push({ kind: "QUESTION", autoKey: `question:${q.id}`, reactionId: q.id, entryId, taskId, title: q.question || (q.entry ? `Обсудить запись: ${q.entry.what}` : q.task ? `Обсудить задачу ${q.task.number}: ${q.task.title}` : "Обсудить") });
  }

  // Лидеры по очереди: от кого ждут weekly, руководитель команды последним
  const expected = await prisma.person.findMany({ where: { id: { in: expectedOf(team, leadersOf(a.nodes)) }, active: true }, select: { id: true, fullName: true }, orderBy: { sortOrder: "asc" } });
  const ordered = [...expected].sort((x, y) => Number(x.id === team.leaderId) - Number(y.id === team.leaderId));
  for (const p of ordered) drafts.push({ kind: "PERSON", autoKey: `person:${p.id}`, personId: p.id, title: `${p.fullName}: что главное за неделю и что дальше?` });
  return drafts;
}

/**
 * Собрать или пересобрать повестку. Новые автоматические пункты добавляются, убранные ведущим не возвращаются,
 * пункты, которые больше не актуальны и не обсуждались, уходят. Ручные пункты и порядок ведущего не трогаются
 */
export async function buildAgenda(actor: Actor, teamId: string, key: WeekKey, now = new Date()): Promise<MeetingView> {
  const a = await accessTo(prisma, actor, teamId);
  requireLead(a, "Собрать повестку");
  const week = await ensureWeek(prisma, key);
  const { meeting } = await weekSettings();
  const date = teamMeeting(key, a.node, meetingOf(key, meeting)).date;
  const drafts = await collectAgenda(a, key, moscowToday());
  const row = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting:${week.id}:${teamId}`}))::text`;
    const m = await tx.meeting.upsert({
      where: { weekId_teamId: { weekId: week.id, teamId } },
      update: { agendaBuiltAt: now },
      create: { weekId: week.id, teamId, date: dbDate(date), agendaBuiltAt: now },
      include: { items: true },
    });
    if (m.status === "DONE") fail("Встреча закрыта: повестку больше не собирают");
    const byKey = new Map(m.items.filter((i) => i.autoKey).map((i) => [i.autoKey!, i]));
    const seen = new Set<string>();
    let order = Math.max(0, ...m.items.map((i) => i.sortOrder)) + 1;
    for (const d of drafts) {
      seen.add(d.autoKey);
      const existing = byKey.get(d.autoKey);
      if (existing) {
        if (existing.removedAt) continue;
        if (existing.title !== d.title || (existing.note ?? null) !== (d.note ?? null)) await tx.agendaItem.update({ where: { id: existing.id }, data: { title: d.title, note: d.note ?? null } });
        continue;
      }
      await tx.agendaItem.create({
        data: {
          meetingId: m.id,
          kind: d.kind,
          title: d.title.slice(0, MEETING_LIMITS.title),
          note: d.note?.slice(0, MEETING_LIMITS.note) ?? null,
          autoKey: d.autoKey,
          sortOrder: KIND_ORDER[d.kind] * 1000 + order++,
          taskId: d.taskId ?? null,
          entryId: d.entryId ?? null,
          requestId: d.requestId ?? null,
          personId: d.personId ?? null,
          reactionId: d.reactionId ?? null,
          initiativeId: d.initiativeId ?? null,
        },
      });
    }
    // Автоматические пункты, которых больше нет в данных: не обсуждённые и без решений уходят
    for (const i of m.items) {
      if (!i.autoKey || seen.has(i.autoKey) || i.discussedAt || i.removedAt) continue;
      const decisions = await tx.decision.count({ where: { itemId: i.id } });
      if (decisions) continue;
      if (m.currentItemId === i.id) await tx.meeting.update({ where: { id: m.id }, data: { currentItemId: await nextItemId(tx, m.id, i.id) } });
      await tx.agendaItem.delete({ where: { id: i.id } });
    }
    await audit(tx, actor, "meeting.agenda", m.id, `Повестка встречи, неделя ${week.isoNumber}, ${a.node.name}`, null, `Пунктов: ${drafts.length}`);
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

/** Повестки всех команд к сроку сдачи: вызывается из минутного цикла писем. Возвращает, сколько собрано */
export async function agendaPass(now = new Date()): Promise<number> {
  const { currentReportingKey } = await import("@/lib/weekly/service");
  const key = await currentReportingKey(now);
  const nodes = await loadTeamNodes(prisma);
  let built = 0;
  // Отчётная неделя и прошлая: если в сутки после срока сервер молчал, повестка всё равно соберётся
  for (const k of [shiftWeek(key, -1), key]) {
    const week = await ensureWeek(prisma, k);
    if (now < week.deadline) continue;
    const have = new Set((await prisma.meeting.findMany({ where: { weekId: week.id }, select: { teamId: true } })).map((m) => m.teamId));
    for (const node of nodes) {
      if (!node.active || have.has(node.id)) continue;
      const leaderId = node.leaderId ?? (node.id === TOP_TEAM ? (await prisma.person.findFirst({ where: { role: "OWNER", active: true }, select: { id: true } }))?.id : null);
      if (!leaderId) continue;
      const person = await prisma.person.findUnique({ where: { id: leaderId } });
      if (!person) continue;
      // От имени руководителя команды, но в журнале видно, что собрал ресурс по расписанию
      const actor: Actor = { personId: person.id, slug: person.slug as PersonSlug, fullName: `Ресурс по расписанию (${person.fullName})`, role: person.role, management: "ADMIN", ip: null, via: null };
      try {
        await buildAgenda(actor, node.id, k, now);
        built++;
      } catch (error) {
        console.error(`Повестка ${node.name} не собралась`, error);
      }
    }
  }
  return built;
}

/** Замок строки встречи до чтения: проверки идут по свежему состоянию, а не по снимку до замка */
async function lockMeeting(tx: Tx, a: Access, meetingId: string) {
  await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${String(meetingId)} FOR UPDATE`;
  const row = await tx.meeting.findUnique({ where: { id: String(meetingId) }, include: meetingInclude });
  if (!row || row.teamId !== a.node.id) return fail("Такой встречи нет");
  return row;
}

/** Следующий пункт после данного, для живого режима: убрали текущий, экран идёт дальше, а не к решениям */
async function nextItemId(tx: Tx, meetingId: string, afterId: string): Promise<string | null> {
  const items = await tx.agendaItem.findMany({ where: { meetingId, removedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const i = items.findIndex((x) => x.id === afterId);
  return items[i + 1]?.id ?? items[i - 1]?.id ?? null;
}

async function meetingAccess(db: Db, actor: Actor, meetingId: string): Promise<Access> {
  const m = await db.meeting.findUnique({ where: { id: String(meetingId) }, select: { teamId: true } });
  if (!m) return fail("Такой встречи нет");
  return accessTo(db, actor, m.teamId);
}

async function audit(tx: Tx, actor: Actor, action: string, entityId: string, field: string, before: string | null, after: string | null) {
  await tx.auditLog.create({ data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "meeting", entityId, field, before: before ?? undefined, after: after ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null } });
}

/** Ручной пункт ведущего: вопросом, в конец блока «риски и помощь» или перед решениями */
export async function addAgendaItem(actor: Actor, meetingId: string, title: string, note?: string | null): Promise<MeetingView> {
  const text = String(title ?? "").trim();
  if (!text) fail("Сформулируйте пункт вопросом");
  if (text.length > MEETING_LIMITS.title) fail(`Пункт: не длиннее ${MEETING_LIMITS.title} знаков`);
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Добавить пункт");
  const row = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    if (m.status === "DONE") fail("Встреча закрыта");
    const order = Math.max(KIND_ORDER.MANUAL * 1000, ...m.items.filter((i) => i.kind !== "PERSON").map((i) => i.sortOrder)) + 1;
    await tx.agendaItem.create({ data: { meetingId: m.id, kind: "MANUAL", title: text, note: String(note ?? "").trim().slice(0, MEETING_LIMITS.note) || null, sortOrder: order } });
    await audit(tx, actor, "meeting.item.add", m.id, "Пункт повестки", null, text);
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

/** Убрать пункт: автоматический помечается убранным и при пересборке не возвращается, ручной удаляется */
export async function removeAgendaItem(actor: Actor, meetingId: string, itemId: string): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Убрать пункт");
  const row = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    if (m.status === "DONE") fail("Встреча закрыта");
    const item = m.items.find((i) => i.id === String(itemId));
    if (!item) return fail("Этого пункта уже нет");
    if (item.decisions.length) fail("В пункте записаны решения: его не убирают");
    if (item.autoKey) await tx.agendaItem.update({ where: { id: item.id }, data: { removedAt: new Date() } });
    else await tx.agendaItem.delete({ where: { id: item.id } });
    if (m.currentItemId === item.id) await tx.meeting.update({ where: { id: m.id }, data: { currentItemId: await nextItemId(tx, m.id, item.id) } });
    await audit(tx, actor, "meeting.item.remove", m.id, "Пункт повестки", item.title, null);
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

// ---------- Живой режим ----------

export async function startMeeting(actor: Actor, meetingId: string, now = new Date()): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Начать встречу");
  const row = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    if (m.status === "DONE") fail("Встреча уже закрыта");
    if (m.status === "LIVE") fail("Встреча уже идёт: присоединяйтесь или нажмите «Вести самому»");
    const first = m.items[0]?.id ?? null;
    await tx.meeting.update({ where: { id: m.id }, data: { status: "LIVE", leaderId: actor.personId, startedAt: now, currentItemId: first } });
    await audit(tx, actor, "meeting.start", m.id, `Встреча, неделя ${m.week.isoNumber}, ${m.team.name}`, "Запланирована", "Идёт");
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

/** Ведущий переходит к пункту: экраны участников идут за ним. Перехватить ведение может другой руководитель */
export async function goToItem(actor: Actor, meetingId: string, itemId: string | null): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Листать встречу");
  const row = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    if (m.status !== "LIVE") fail("Встреча не идёт: сначала «Начать встречу»");
    if (itemId !== null && itemId !== "decisions" && !m.items.some((i) => i.id === itemId)) fail("Этого пункта уже нет");
    await tx.meeting.update({ where: { id: m.id }, data: { currentItemId: itemId, leaderId: actor.personId } });
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

/** «Обсуждено»: пункт отмечен, вопрос к записи получает отметку в обсуждении */
export async function setItemDiscussed(actor: Actor, meetingId: string, itemId: string, discussed: boolean, now = new Date()): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Отметить пункт");
  const row = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    if (m.status === "DONE") fail("Встреча закрыта");
    const item = m.items.find((i) => i.id === String(itemId));
    if (!item) return fail("Этого пункта уже нет");
    await tx.agendaItem.update({ where: { id: item.id }, data: discussed ? { discussedAt: now, discussedById: actor.personId } : { discussedAt: null, discussedById: null } });
    if (item.reactionId) await tx.reaction.updateMany({ where: { id: item.reactionId }, data: discussed ? { discussedAt: now, discussedById: actor.personId } : { discussedAt: null, discussedById: null } });
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

export async function setTimer(actor: Actor, meetingId: string, minutes: number): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Таймер");
  const n = Math.round(Number(minutes));
  if (!Number.isFinite(n) || n < 1 || n > 60) fail("Таймер: от 1 до 60 минут");
  const row = await prisma.meeting.update({ where: { id: String(meetingId) }, data: { timerMinutes: n }, include: meetingInclude });
  return toView(prisma, a, row);
}

/** Ссылка на заметку встречи: только https и домен Notion */
function notionUrlOf(url: string | null | undefined): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !/(^|\.)notion\.(so|site)$/.test(u.hostname)) throw new Error();
  } catch {
    fail("Ссылка должна вести на страницу Notion");
  }
  return raw.slice(0, 500);
}

export async function setNotionUrl(actor: Actor, meetingId: string, url: string | null): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Ссылка на Notion");
  const raw = notionUrlOf(url) ?? "";
  const row = await prisma.meeting.update({ where: { id: String(meetingId) }, data: { notionUrl: raw || null }, include: meetingInclude });
  return toView(prisma, a, row);
}

// ---------- Решения ----------

export type NewDecision = { text: string; owner?: string | null; taskNumbers?: number[]; itemId?: string | null };

/** Записать решение: на встрече или после неё. Владелец решения получает событие */
export async function addDecision(actor: Actor, meetingId: string, input: NewDecision): Promise<MeetingView> {
  const text = String(input.text ?? "").replace(/[—–→⟶⇒]/g, "-").trim();
  if (!text) fail("Сформулируйте решение одной фразой");
  if (text.length > MEETING_LIMITS.decision) fail(`Решение: не длиннее ${MEETING_LIMITS.decision} знаков`);
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Записать решение");
  const row = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    const owner = input.owner ? await tx.person.findFirst({ where: { slug: String(input.owner), active: true }, select: { id: true } }) : null;
    if (input.owner && !owner) fail("Выберите владельца решения из списка");
    const numbers = [...new Set((input.taskNumbers ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 20);
    const tasks = numbers.length ? await tx.task.findMany({ where: { number: { in: numbers }, archivedAt: null }, select: { id: true, number: true } }) : [];
    const missing = numbers.filter((n) => !tasks.some((t) => t.number === n));
    if (missing.length) fail(`Задач с номерами ${missing.join(", ")} нет`);
    const itemId = input.itemId && m.items.some((i) => i.id === input.itemId) ? String(input.itemId) : null;
    const d = await tx.decision.create({
      data: { meetingId: m.id, itemId, teamId: m.teamId, text, ownerId: owner?.id ?? null, date: m.date, createdById: actor.personId, tasks: { create: tasks.map((t) => ({ taskId: t.id })) } },
    });
    await audit(tx, actor, "meeting.decision", m.id, "Решение", null, text);
    if (owner) await notify(tx, { kind: "MEETING", recipients: [owner.id], actor, subject: `decision:${d.id}`, text: `Вы владелец решения встречи: «${text.slice(0, 120)}»` });
    // Ответственные связанных задач узнают о решении
    const owners = await tx.task.findMany({ where: { id: { in: tasks.map((t) => t.id) } }, select: { id: true, number: true, ownerId: true } });
    for (const t of owners) await notify(tx, { kind: "MEETING", recipients: [t.ownerId], actor, subject: taskSubject(t.number), taskId: t.id, text: `Решение встречи по задаче: «${text.slice(0, 120)}»` });
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

/** Решение отменено с причиной: остаётся в журнале как «отменено» */
export async function cancelDecision(actor: Actor, decisionId: string, reason: string): Promise<DecisionView> {
  const why = String(reason ?? "").trim();
  if (!why) fail("Напишите, почему решение отменено");
  if (why.length > MEETING_LIMITS.reason) fail(`Причина: не длиннее ${MEETING_LIMITS.reason} знаков`);
  const d = await prisma.decision.findUnique({ where: { id: String(decisionId) }, select: { teamId: true, status: true, text: true } });
  if (!d) return fail("Такого решения нет");
  const a = await accessTo(prisma, actor, d.teamId);
  requireLead(a, "Отменить решение");
  if (d.status === "CANCELLED") fail("Решение уже отменено");
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.decision.update({ where: { id: String(decisionId) }, data: { status: "CANCELLED", cancelReason: why, cancelledAt: new Date(), cancelledById: actor.personId }, include: decisionIncludeInner() });
    await audit(tx, actor, "meeting.decision.cancel", updated.meetingId ?? updated.id, "Решение отменено", d.text, why);
    return updated;
  });
  return decisionDto(row);
}

/** Журнал решений команд, которые человек видит. query: поиск с русскими словоформами */
export async function listDecisions(actor: Actor, opts: { teamIds?: string[]; query?: string; status?: "active" | "cancelled" | "all"; limit?: number } = {}): Promise<DecisionView[]> {
  const scope = await loadScope(prisma, subjectOf(actor));
  const visible = scope.all ? undefined : [...new Set([...scope.visible, ...scope.member])];
  const teamIds = opts.teamIds?.length ? opts.teamIds.filter((id) => !visible || visible.includes(id)) : visible;
  if (teamIds && !teamIds.length) return [];
  const q = String(opts.query ?? "").trim().slice(0, 200);
  let ids: string[] | undefined;
  if (q) {
    const found = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM decisions WHERE to_tsvector('russian', text) @@ plainto_tsquery('russian', ${q}) OR text ILIKE ${`%${q}%`} LIMIT 500`;
    ids = found.map((f) => f.id);
    if (!ids.length) return [];
  }
  const rows = await prisma.decision.findMany({
    where: {
      ...(teamIds ? { teamId: { in: teamIds } } : {}),
      ...(ids ? { id: { in: ids } } : {}),
      ...(opts.status === "active" || !opts.status ? { status: "ACTIVE" } : opts.status === "cancelled" ? { status: "CANCELLED" } : {}),
    },
    include: decisionIncludeInner(),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: Math.min(opts.limit ?? 200, 500),
  });
  return rows.map(decisionDto);
}

// ---------- Закрытие и протокол ----------

/** Текст протокола: решения, новые задачи, изменения за время встречи. Без лишних слов, со ссылками */
async function buildProtocol(db: Db, m: MeetingRow, now: Date): Promise<string> {
  const from = m.startedAt ?? m.createdAt;
  const names = new Map((await db.person.findMany({ select: { id: true, slug: true, shortName: true } })).flatMap((p) => [[p.id, p.shortName], [p.slug, p.shortName]] as [string, string][]));
  const base = appUrl();
  const lines: string[] = [`Встреча ${m.team.name}, неделя ${m.week.isoNumber}, ${formatLong(isoFromDbDate(m.date))}`, ""];
  const decisions = m.decisions.filter((d) => d.status === "ACTIVE");
  lines.push("Решения");
  if (!decisions.length) lines.push("Решений не записано");
  for (const d of decisions) lines.push(`- ${d.text}${d.owner ? `. Владелец: ${names.get(d.owner.slug) ?? d.owner.slug}` : ""}${d.tasks.length ? `. Задачи: ${d.tasks.map((t) => t.task.number).join(", ")}` : ""}`);
  lines.push("");
  const created = await db.task.findMany({ where: { teamId: m.teamId, createdAt: { gte: from, lte: now }, archivedAt: null }, select: { number: true, title: true, due: true, ownerId: true, ownerAll: true }, orderBy: { number: "asc" } });
  lines.push("Новые задачи");
  if (!created.length) lines.push("Новых задач нет");
  for (const t of created) lines.push(`- ${t.number}. ${t.title}: ${t.ownerAll ? "все лидеры" : t.ownerId ? (names.get(t.ownerId) ?? "") : "без ответственного"}, срок ${formatShort(isoFromDbDate(t.due))}. ${base}/tasks/${t.number}`);
  lines.push("");
  const createdNumbers = new Set(created.map((t) => t.number));
  const teamNumbers = (await db.task.findMany({ where: { teamId: m.teamId }, select: { number: true } })).map((t) => String(t.number)).filter((n) => !createdNumbers.has(Number(n)));
  const relevant = teamNumbers.length
    ? await db.auditLog.findMany({
        where: { entity: "task", entityId: { in: teamNumbers }, at: { gte: from, lte: now }, action: { in: ["task.update", "task.handover"] }, field: { in: ["Статус", "Срок", "Состояние", "Ответственный", "Приоритет"] } },
        select: { entityId: true, field: true, after: true },
        orderBy: { at: "asc" },
        take: 200,
      })
    : [];
  lines.push("Изменения по задачам");
  if (!relevant.length) lines.push("Изменений нет");
  for (const c of relevant) lines.push(`- Задача ${c.entityId}: ${(c.field ?? "").toLowerCase()}: ${c.after ?? ""}`);
  lines.push("");
  const discussed = m.items.filter((i) => i.discussedAt).length;
  lines.push(`Повестка: ${discussed} из ${m.items.length} пунктов обсуждены. ${base}/weekly/meeting?week=${isoFromDbDate(m.week.start)}`);
  if (m.notionUrl) lines.push(`Заметка встречи в Notion: ${m.notionUrl}`);
  return lines.join("\n");
}

/** Закрыть встречу: протокол собирается сам, участникам с почтой уходит письмо, остальным событие в «Мне» */
export async function closeMeeting(actor: Actor, meetingId: string, now = new Date()): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Закрыть встречу");
  const { row, protocol, recipients } = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    if (m.status === "DONE") fail("Встреча уже закрыта");
    if (m.status !== "LIVE") fail("Встреча ещё не начиналась: сначала «Начать встречу»");
    const protocol = await buildProtocol(tx, m, now);
    await tx.meeting.update({ where: { id: m.id }, data: { status: "DONE", closedAt: now, currentItemId: null, protocol } });
    await audit(tx, actor, "meeting.close", m.id, `Встреча, неделя ${m.week.isoNumber}, ${m.team.name}`, "Идёт", "Закрыта");
    const people = await tx.person.findMany({ where: { id: { in: participantsOf(a.nodes, a.node) }, active: true }, select: { id: true, email: true } });
    await notify(tx, { kind: "MEETING", recipients: people.map((p) => p.id), actor, subject: `meeting:${isoFromDbDate(m.week.start)}:${m.teamId}`, text: `Протокол встречи ${m.team.name} за неделю ${m.week.isoNumber} готов` });
    return { row: await tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude }), protocol, recipients: people.filter((p) => p.email).map((p) => p.email!) };
  });
  if (recipients.length && mailConfigured()) {
    let sent = 0;
    for (const to of recipients) {
      try {
        await sendMail({ to, subject: `Протокол встречи ${row.team.name}, неделя ${row.week.isoNumber}`, text: protocol });
        sent++;
      } catch (error) {
        console.error("Протокол не отправлен", to, error);
      }
    }
    if (sent) await prisma.meeting.update({ where: { id: row.id }, data: { protocolSentAt: now } });
  }
  return toView(prisma, a, await prisma.meeting.findUniqueOrThrow({ where: { id: row.id }, include: meetingInclude }));
}

/** Открыть закрытую встречу снова: протокол пересоберётся при следующем закрытии */
export async function reopenMeeting(actor: Actor, meetingId: string): Promise<MeetingView> {
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Открыть встречу");
  const row = await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    if (m.status !== "DONE") fail("Встреча и так открыта");
    await tx.meeting.update({ where: { id: m.id }, data: { status: "LIVE", closedAt: null, leaderId: actor.personId } });
    await audit(tx, actor, "meeting.reopen", m.id, `Встреча, неделя ${m.week.isoNumber}, ${m.team.name}`, "Закрыта", "Идёт");
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: meetingInclude });
  });
  return toView(prisma, a, row);
}

/** Прошлые встречи команды для списка */
export async function listMeetings(actor: Actor, teamId: string, limit = 12): Promise<{ id: string; week: WeekKey; number: number; date: IsoDate; status: MeetingStatusCode; decisions: number }[]> {
  await accessTo(prisma, actor, teamId);
  const rows = await prisma.meeting.findMany({ where: { teamId }, include: { week: { select: { start: true, isoNumber: true } }, _count: { select: { decisions: true } } }, orderBy: { date: "desc" }, take: limit });
  return rows.map((m) => ({ id: m.id, week: isoFromDbDate(m.week.start), number: m.week.isoNumber, date: isoFromDbDate(m.date), status: STATUS_CODE[m.status], decisions: m._count.decisions }));
}

export { AGENDA_KIND_LABELS, statusOf, stateLabel, addDays, weekNumberOf };

// ---------- Приём из Notion ----------

export type IntakeItem =
  | { kind: "task"; title: string; owner: string; due: IsoDate; direction: string }
  | { kind: "decision"; text: string; owner?: string | null };

/** Подтверждённые кандидаты из текста Notion становятся задачами встречи и решениями. Одной транзакцией */
export async function intake(actor: Actor, meetingId: string, items: IntakeItem[], notionUrl?: string | null): Promise<{ meeting: MeetingView; tasks: number[]; decisions: number }> {
  if (!Array.isArray(items) || !items.length) fail("Отметьте, что принять");
  if (items.length > 50) fail("За раз не больше 50 пунктов");
  const a = await meetingAccess(prisma, actor, meetingId);
  requireLead(a, "Приём из Notion");
  const { createTaskIn } = await import("@/lib/tasks/service");
  const numbers: number[] = [];
  let decisions = 0;
  await prisma.$transaction(async (tx) => {
    const m = await lockMeeting(tx, a, meetingId);
    for (const it of items) {
      if (it.kind === "task") {
        const r = await createTaskIn(tx, actor, { title: String(it.title), outcome: String(it.title), owner: String(it.owner) as PersonSlug, direction: String(it.direction), due: it.due, source: "meeting", sourceNote: `Разбор встречи в Notion, неделя ${m.week.isoNumber}`, team: m.teamId });
        numbers.push(r.task.number);
      } else {
        const text = String(it.text ?? "").replace(/[—–→⟶⇒]/g, "-").trim();
        if (!text) fail("Решение без текста");
        const owner = it.owner ? await tx.person.findFirst({ where: { slug: String(it.owner), active: true }, select: { id: true } }) : null;
        if (it.owner && !owner) fail("Выберите владельца решения из списка");
        await tx.decision.create({ data: { meetingId: m.id, teamId: m.teamId, text: text.slice(0, MEETING_LIMITS.decision), ownerId: owner?.id ?? null, date: m.date, createdById: actor.personId } });
        decisions++;
      }
    }
    const link = notionUrlOf(notionUrl);
    if (link) await tx.meeting.update({ where: { id: m.id }, data: { notionUrl: link } });
    await audit(tx, actor, "meeting.intake", m.id, "Приём из Notion", null, `Задач: ${numbers.length}, решений: ${decisions}`);
  });
  const view = await getMeeting(actor, a.node.id, (await prisma.meeting.findUniqueOrThrow({ where: { id: String(meetingId) }, include: { week: { select: { start: true } } } })).week.start.toISOString().slice(0, 10) as WeekKey);
  return { meeting: view!, tasks: numbers, decisions };
}
