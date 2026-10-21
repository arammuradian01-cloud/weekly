// Разбор встречи из Notion (этап 61). Решение Арама 21.10: Excel-борд больше не главный, главное приложение. Ведущий
// встречи даёт ссылку на страницу встречи в Notion, ресурс читает её через внутреннюю интеграцию, разбирает текст (Claude
// по API, без ключа или при сбое правилами) и показывает итоги встречи, черновик weekly для CEO и черновики задач.
// Ведущий правит черновики, отправляет weekly CEO (только в приложении) и создаёт задачи разом, одной транзакцией через
// сервис задач с правилами согласования этапа 54. Повторное нажатие ничего не дублирует.
//
// Права: разбор видят те, кто видит встречу команды; запускают и правят те, кто её ведёт (canLead этапа 23). Отправить
// CEO может владелец или администратор в режиме управления, создать задачи ведущий; и то и другое при личном входе:
// по общему логину профиль выбирают сами, а CEO и ответственные должны видеть настоящего автора.
// В журнал пишется каждое действие, текст встречи в журнал и логи не попадает.

import { prisma } from "@/lib/db";
import type { MeetingParseMethod, MeetingParseStatus, Prisma } from "@/generated/prisma/client";
import type { IsoDate } from "@/domain/dates";
import type { PersonSlug, WeekKey } from "@/domain/types";
import { TaskRuleError, createTaskIn, type Actor } from "@/lib/tasks/service";
import { dbDate, isIsoDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { notify } from "@/lib/inbox/notify";
import { loadTeamNodes } from "@/lib/org/scope";
import { isWeekKey } from "@/lib/weekly/weeks";
import { NameIndex } from "@/lib/bord/names";
import { suggestGoals } from "@/lib/goals/service";
import { getCeoReport, saveCeoReportIn, type CeoReportView } from "@/lib/weekly/service";
import type { CeoSections } from "@/lib/weekly/rules";
import { meetingIdFor, meetingRights, notionUrlOf, MEETING_LIMITS } from "./service";
import { NotionError, NOTION_MESSAGES, notionDepsFromEnv, notionPageIdFromUrl, readNotionPage, type NotionDeps } from "./notion-api";
import { ClaudeError, claudeDepsFromEnv, parseWithClaude, type ClaudeDeps } from "./claude";
import { parseByRules } from "./parse-rules";
import {
  EMPTY_RESULT,
  PARSE_LIMITS,
  bullets,
  ceoDraftOf,
  cleanText,
  defaultDue,
  hasCeoText,
  mergeCeoSections,
  parseStatusLabel,
  taskTitle,
  type CeoMergeMode,
  type ParseDecision,
  type ParseResult,
  type ParseTaskDraft,
  type RawMeeting,
} from "./parse-types";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Разбор дольше этого считается прерванным (сервер перезапустился посреди разбора): экран предлагает повторить */
export const STALE_MS = 4 * 60_000;

const STATUS: Record<MeetingParseStatus, "pending" | "ready" | "failed"> = { PENDING: "pending", READY: "ready", FAILED: "failed" };
const METHOD: Record<MeetingParseMethod, "ai" | "rules"> = { AI: "ai", RULES: "rules" };

const parseInclude = {
  meeting: { select: { id: true, date: true, teamId: true, team: { select: { name: true } }, week: { select: { start: true, isoNumber: true } } } },
  createdBy: { select: { fullName: true } },
  ceoSentBy: { select: { fullName: true } },
  tasksCreatedBy: { select: { fullName: true } },
} satisfies Prisma.MeetingParseInclude;
type ParseRow = Prisma.MeetingParseGetPayload<{ include: typeof parseInclude }>;

export type CreatedTask = { number: number; title: string; owner: PersonSlug | null; proposed: boolean; approval: "pending" | "informed" | null; approver: string | null };

export type ParseView = {
  id: string;
  meetingId: string;
  team: { id: string; name: string };
  week: WeekKey;
  weekNumber: number;
  meetingDate: IsoDate;
  notionUrl: string;
  title: string;
  status: "pending" | "ready" | "failed";
  statusLabel: string;
  method: "ai" | "rules" | null;
  model: string | null;
  note: string | null;
  pageText: string;
  result: ParseResult;
  startedAt: string;
  finishedAt: string | null;
  /** Разбор идёт дольше обычного: сервер, скорее всего, перезапустился, можно повторить */
  stale: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  ceoSentAt: string | null;
  ceoSentBy: string | null;
  tasksCreatedAt: string | null;
  tasksCreatedBy: string | null;
  createdTasks: CreatedTask[];
  decisionsCreated: number;
  canEdit: boolean;
  /** Повторить разбор: не получился, завис или ещё ничего не отправлено */
  canRetry: boolean;
  canSendCeo: boolean;
  canCreateTasks: boolean;
  /** Почему нельзя отправить CEO или создать задачи: подсказка вместо кнопки */
  sendHint: string | null;
  tasksHint: string | null;
  /** Отчёт CEO за неделю и кому уйдёт: только тем, кто может отправить */
  ceo: { existing: CeoReportView; recipients: string[] } | null;
};

const personal = (actor: Actor) => actor.via !== "TEAM";
const canSend = (actor: Actor) => personal(actor) && (actor.management === "OWNER" || actor.management === "ADMIN");

async function audit(db: Tx | typeof prisma, actor: Actor, action: string, entityId: string, field: string, after: string | null, before: string | null = null) {
  await db.auditLog.create({ data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "meeting", entityId, field, before: before ?? undefined, after: after ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null } });
}

const keyOf = (row: Pick<ParseRow, "meeting">) => isoFromDbDate(row.meeting.week.start) as WeekKey;

/** Результат из базы: то, что не похоже на разбор, становится пустым разбором, а не ошибкой экрана */
function resultOf(value: unknown): ParseResult {
  if (!value || typeof value !== "object") return EMPTY_RESULT;
  const v = value as Partial<ParseResult>;
  return {
    summary: Array.isArray(v.summary) ? v.summary.map(String) : [],
    decisions: Array.isArray(v.decisions) ? (v.decisions as ParseDecision[]) : [],
    risks: Array.isArray(v.risks) ? v.risks.map(String) : [],
    next: Array.isArray(v.next) ? v.next.map(String) : [],
    ceo: v.ceo && typeof v.ceo === "object" ? { main: String(v.ceo.main ?? ""), risks: String(v.ceo.risks ?? ""), next: String(v.ceo.next ?? "") } : EMPTY_RESULT.ceo,
    tasks: Array.isArray(v.tasks) ? (v.tasks as ParseTaskDraft[]) : [],
  };
}

// ---------- Кто CEO ----------

/**
 * Кому уходит weekly для CEO: руководитель подразделения уровня «компания» (корень структуры, этап 53). Если его нет,
 * включённый профиль CEO из стартовых людей (короткое имя ceo)
 */
export async function ceoRecipients(db: Tx | typeof prisma = prisma): Promise<{ id: string; slug: string; fullName: string }[]> {
  const company = await db.orgUnit.findFirst({
    where: { kind: "COMPANY", active: true, headId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { head: { select: { id: true, slug: true, fullName: true, active: true } } },
  });
  if (company?.head?.active) return [{ id: company.head.id, slug: company.head.slug, fullName: company.head.fullName }];
  return db.person.findMany({ where: { slug: "ceo", active: true }, select: { id: true, slug: true, fullName: true } });
}

export async function isCeo(personId: string): Promise<boolean> {
  return (await ceoRecipients()).some((p) => p.id === personId);
}

// ---------- Запуск ----------

/** Начать разбор: встреча команды за неделю (нет, собирается), строка разбора «идёт». Сам разбор: runParse */
export async function startParse(actor: Actor, teamId: string, key: WeekKey, url: string, now = new Date()): Promise<{ id: string; started: boolean }> {
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  const link = String(url ?? "").trim();
  const pageId = notionPageIdFromUrl(link);
  if (!pageId) fail(NOTION_MESSAGES["bad-url"]);
  const meetingId = await meetingIdFor(actor, String(teamId), key);
  const rights = await meetingRights(actor, meetingId);
  if (!rights.canLead) fail("Разобрать встречу может тот, кто её ведёт: руководитель команды, руководитель выше или режим управления");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${meetingId} FOR UPDATE`;
    // Двойное нажатие: идущий разбор той же страницы не запускается второй раз
    const running = await tx.meetingParse.findFirst({ where: { meetingId, notionPageId: pageId!, status: "PENDING", startedAt: { gt: new Date(now.getTime() - STALE_MS) } }, select: { id: true } });
    if (running) return { id: running.id, started: false };
    const row = await tx.meetingParse.create({ data: { meetingId, notionUrl: notionUrlOf(link) ?? link.slice(0, 500), notionPageId: pageId!, createdById: actor.personId, startedAt: now, attempts: 1 } });
    await tx.meeting.update({ where: { id: meetingId }, data: { notionUrl: notionUrlOf(link) } });
    await audit(tx, actor, "meeting.parse.start", meetingId, `Разбор встречи из Notion, ${rights.teamName}`, link.slice(0, 500));
    return { id: row.id, started: true };
  });
}

/** Повторить разбор: не получился, завис или ведущий хочет разобрать страницу заново (пока ничего не отправлено) */
export async function retryParse(actor: Actor, id: string, now = new Date()): Promise<{ id: string }> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  if (!rights.canLead) fail("Повторить разбор может тот, кто ведёт встречу");
  if (row.status === "PENDING" && now.getTime() - row.startedAt.getTime() < STALE_MS) fail("Разбор уже идёт: подождите минуту");
  if (row.tasksCreatedAt || row.ceoSentAt) fail("Из этого разбора уже отправлен weekly или созданы задачи. Чтобы разобрать страницу снова, запустите новый разбор со страницы встречи");
  await prisma.$transaction(async (tx) => {
    await tx.meetingParse.update({ where: { id: row.id }, data: { status: "PENDING", startedAt: now, finishedAt: null, note: null, attempts: { increment: 1 } } });
    await audit(tx, actor, "meeting.parse.retry", row.meetingId, `Разбор встречи из Notion, ${rights.teamName}`, `Попытка ${row.attempts + 1}`);
  });
  return { id: row.id };
}

async function loadRow(id: string): Promise<ParseRow> {
  const row = await prisma.meetingParse.findUnique({ where: { id }, include: parseInclude });
  return row ?? fail("Такого разбора нет");
}

export type ParseDeps = { notion?: NotionDeps; claude?: ClaudeDeps | null; now?: Date };

/** Люди компании для сопоставления имён: сначала участники команды встречи, потом все включённые */
async function nameIndexes(participants: string[]) {
  const people = await prisma.person.findMany({
    where: { active: true, role: { not: "OBSERVER" } },
    select: { id: true, slug: true, fullName: true, shortName: true, defaultDirection: { select: { code: true } } },
    orderBy: { sortOrder: "asc" },
  });
  // В структуре ФИО с отчеством, на встрече говорят «Погосова Сабина»: второй указатель по фамилии и имени
  const short = (list: typeof people) => list.map((p) => ({ ...p, fullName: p.fullName.split(/\s+/).slice(0, 2).join(" ") }));
  const teamPeople = people.filter((p) => participants.includes(p.id));
  const indexes = [new NameIndex(teamPeople), new NameIndex(short(teamPeople)), new NameIndex(people), new NameIndex(short(people))];
  const byId = new Map(people.map((p) => [p.id, p]));
  const find = (name: string | null | undefined) => {
    const n = String(name ?? "").trim();
    if (!n) return null;
    for (const idx of indexes) {
      const hit = idx.find(n).person;
      if (hit) return byId.get(hit.id) ?? null;
    }
    return null;
  };
  const knows = (name: string) => indexes.some((idx) => {
    const r = idx.find(name);
    return !!r.person || !!r.ambiguous;
  });
  return { people, find, knows };
}

/**
 * Сделать разбор: прочитать страницу, разобрать текст, сопоставить людей, подобрать цели. Ничего не бросает: ошибка
 * Notion становится статусом «не разобрано» с понятным текстом, сбой Claude уводит разбор в правила
 */
export async function runParse(id: string, deps: ParseDeps = {}): Promise<void> {
  const row = await prisma.meetingParse.findUnique({ where: { id }, include: { ...parseInclude, createdBy: { select: { id: true, fullName: true, role: true } } } });
  if (!row || row.status !== "PENDING") return;
  const startedAt = row.startedAt;
  const now = deps.now ?? new Date();
  const finish = async (data: Prisma.MeetingParseUpdateManyMutationInput, action: string, after: string) => {
    // Разбор, который обогнал повтор, ничего не перезаписывает: пишет только попытка, начатая последней
    const done = await prisma.meetingParse.updateMany({ where: { id, status: "PENDING", startedAt }, data: { ...data, finishedAt: new Date() } });
    if (done.count) {
      await prisma.auditLog.create({
        data: { action, actorId: row.createdById, actorName: row.createdBy?.fullName ?? null, source: "SYSTEM", entity: "meeting", entityId: row.meetingId, field: `Разбор встречи из Notion, ${row.meeting.team.name}`, after },
      });
    }
  };
  try {
    let page;
    try {
      page = await readNotionPage(row.notionPageId, deps.notion ?? (await notionDepsFromEnv()));
    } catch (error) {
      const message = error instanceof NotionError ? error.message : NOTION_MESSAGES.other;
      if (!(error instanceof NotionError)) console.error("Разбор встречи: Notion не прочитан", error instanceof Error ? error.name : "ошибка");
      await finish({ status: "FAILED", note: message }, "meeting.parse.fail", message);
      return;
    }
    const meetingDate = isoFromDbDate(row.meeting.date);
    const today = moscowToday(now);
    const nodes = await loadTeamNodes(prisma);
    const node = nodes.find((n) => n.id === row.meeting.teamId);
    const participants = node ? [...new Set([...(node.leaderId ? [node.leaderId] : []), ...node.members])] : [];
    const names = await nameIndexes(participants);
    const directions = await prisma.dictionaryItem.findMany({ where: { kind: "DIRECTION", active: true }, select: { code: true, label: true }, orderBy: { sortOrder: "asc" } });

    let raw: RawMeeting | null = null;
    let method: MeetingParseMethod = "RULES";
    let model: string | null = null;
    let note: string | null = null;
    const claude = deps.claude === undefined ? claudeDepsFromEnv(row.notionPageId) : deps.claude;
    if (claude) {
      try {
        const people = [...names.people].sort((a, b) => Number(participants.includes(b.id)) - Number(participants.includes(a.id))).slice(0, 300).map((p) => p.fullName);
        const res = await parseWithClaude({ title: page.title, text: page.text, today, meetingDate, team: row.meeting.team.name, people, directions }, claude);
        raw = res.raw;
        method = "AI";
        model = claude.model;
        if (res.skipped) note = `Claude вернул ${res.skipped} строк без нужных полей: их нет в черновиках`;
      } catch (error) {
        const reason = error instanceof ClaudeError ? error.message : "непредвиденная ошибка";
        if (!(error instanceof ClaudeError)) console.error("Разбор встречи: сбой вызова Claude", error instanceof Error ? error.name : "ошибка");
        note = `Claude не разобрал встречу: ${reason}. Разобрано правилами, проверьте итоги и задачи внимательнее`;
      }
    } else {
      note = "Ключ Claude не задан на сервере (ANTHROPIC_API_KEY): разобрано правилами по заголовкам и спискам. Проверьте итоги и задачи внимательнее";
    }
    raw ??= parseByRules(page.text, { base: meetingDate, knows: names.knows });
    if (page.truncated) note = [note, "Страница длинная: разобрано начало"].filter(Boolean).join(". ");

    const result = await buildResult(raw, {
      meetingDate,
      today,
      teamId: row.meeting.teamId,
      directions: directions.map((d) => d.code),
      find: names.find,
      who: row.createdBy ? { personId: row.createdBy.id, role: row.createdBy.role, management: row.createdBy.role === "OWNER" ? "OWNER" : row.createdBy.role === "ADMIN" ? "ADMIN" : null } : null,
    });
    await finish(
      { status: "READY", method, model, note, title: page.title, pageText: page.text, result: result as unknown as Prisma.InputJsonValue },
      "meeting.parse.done",
      `${method === "AI" ? `Разобрал Claude (${model})` : "Разобрано правилами"}: главного ${result.summary.length}, решений ${result.decisions.length}, задач ${result.tasks.length}`,
    );
  } catch (error) {
    console.error("Разбор встречи не получился", error instanceof Error ? error.name : "ошибка");
    await finish({ status: "FAILED", note: "Разбор не получился из-за ошибки на сервере. Нажмите «Повторить»" }, "meeting.parse.fail", "Ошибка на сервере");
  }
}

type BuildContext = {
  meetingDate: IsoDate;
  today: IsoDate;
  teamId: string;
  directions: string[];
  find: (name: string | null | undefined) => { id: string; slug: string; defaultDirection: { code: string } | null } | null;
  who: { personId: string; role: Actor["role"]; management: Actor["management"] } | null;
};

/** Сырой разбор в черновики: люди по именам, сроки, направления, цели по тексту (этап 55) */
export async function buildResult(raw: RawMeeting, ctx: BuildContext): Promise<ParseResult> {
  const fallbackDirection = ctx.directions.includes("department") ? "department" : (ctx.directions[0] ?? "department");
  const tasks: ParseTaskDraft[] = [];
  for (const [i, t] of raw.tasks.entries()) {
    const owner = ctx.find(t.owner);
    const co = t.coExecutors.map((n) => ({ text: n, p: ctx.find(n) }));
    const dueOk = t.due && t.due >= ctx.today ? t.due : null;
    const due = dueOk ?? defaultDue(ctx.meetingDate, ctx.today);
    const direction = t.direction && ctx.directions.includes(t.direction) ? t.direction : (owner?.defaultDirection?.code && ctx.directions.includes(owner.defaultDirection.code) ? owner.defaultDirection.code : fallbackDirection);
    let goal: { id: string; title: string } | null = null;
    if (ctx.who) {
      try {
        const s = await suggestGoals(ctx.who, { team: ctx.teamId, due, title: t.title, outcome: t.outcome, owner: owner?.slug ?? null });
        const best = s.best ? s.options.find((o) => o.id === s.best) : null;
        if (best) goal = { id: best.id, title: best.title };
      } catch {
        // Подбор цели не обязателен: без него черновик остаётся
      }
    }
    tasks.push({
      key: `t${i + 1}`,
      on: true,
      title: t.title,
      outcome: t.outcome || t.title,
      ownerText: t.owner ?? "",
      owner: owner?.slug ?? null,
      coText: co.filter((c) => !c.p).map((c) => c.text),
      coExecutors: [...new Set(co.map((c) => c.p?.slug).filter((s): s is string => !!s && s !== owner?.slug))],
      due,
      dueText: t.dueText ?? (t.due && !dueOk ? t.due : null),
      dueGuessed: !dueOk,
      direction,
      goalMode: "auto",
      goal: goal?.id ?? null,
      goalTitle: goal?.title ?? null,
    });
  }
  return {
    summary: raw.summary,
    decisions: raw.decisions.map((d) => {
      const p = ctx.find(d.owner);
      return { text: d.text, ownerText: d.owner, owner: p?.slug ?? null };
    }),
    risks: raw.risks,
    next: raw.next,
    ceo: ceoDraftOf(raw),
    tasks,
  };
}

// ---------- Чтение ----------

async function createdTasks(numbers: number[]): Promise<CreatedTask[]> {
  if (!numbers.length) return [];
  const rows = await prisma.task.findMany({
    where: { number: { in: numbers } },
    select: { number: true, title: true, status: true, approvalState: true, owner: { select: { slug: true } }, approver: { select: { fullName: true } } },
    orderBy: { number: "asc" },
  });
  return rows.map((t) => ({
    number: t.number,
    title: t.title,
    owner: (t.owner?.slug as PersonSlug | undefined) ?? null,
    proposed: t.status === "PROPOSED",
    approval: t.approvalState === "PENDING" ? "pending" : t.approvalState === "INFORMED" ? "informed" : null,
    approver: t.approver?.fullName ?? null,
  }));
}

async function toView(actor: Actor, row: ParseRow, rights: { canLead: boolean; teamName: string }, now = new Date()): Promise<ParseView> {
  const status = STATUS[row.status];
  const ready = row.status === "READY";
  const sendAllowed = rights.canLead && canSend(actor);
  const tasksAllowed = rights.canLead && personal(actor);
  const sendHint = !rights.canLead
    ? null
    : !personal(actor)
      ? "Отправить CEO можно при личном входе: так CEO видит, кто отправил"
      : !canSend(actor)
        ? "Отправить CEO может владелец или администратор в режиме управления: отчёт CEO за неделю у департамента один"
        : null;
  const tasksHint = !rights.canLead ? null : !personal(actor) ? "Создать задачи можно при личном входе: так ответственные видят, кто их поставил" : null;
  const key = keyOf(row);
  let ceo: ParseView["ceo"] = null;
  if (sendAllowed && ready) {
    const [existing, recipients] = await Promise.all([getCeoReport(key), ceoRecipients()]);
    ceo = { existing, recipients: recipients.map((r) => r.fullName) };
  }
  return {
    id: row.id,
    meetingId: row.meetingId,
    team: { id: row.meeting.teamId, name: row.meeting.team.name },
    week: key,
    weekNumber: row.meeting.week.isoNumber,
    meetingDate: isoFromDbDate(row.meeting.date),
    notionUrl: row.notionUrl,
    title: row.title,
    status,
    statusLabel: parseStatusLabel({ status, ceoSentAt: row.ceoSentAt?.toISOString(), tasksCreatedAt: row.tasksCreatedAt?.toISOString() }),
    method: row.method ? METHOD[row.method] : null,
    model: row.model,
    note: row.note,
    pageText: row.pageText,
    result: resultOf(row.result),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    stale: row.status === "PENDING" && now.getTime() - row.startedAt.getTime() >= STALE_MS,
    createdBy: row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ceoSentAt: row.ceoSentAt?.toISOString() ?? null,
    ceoSentBy: row.ceoSentBy?.fullName ?? null,
    tasksCreatedAt: row.tasksCreatedAt?.toISOString() ?? null,
    tasksCreatedBy: row.tasksCreatedBy?.fullName ?? null,
    createdTasks: await createdTasks(row.taskNumbers),
    decisionsCreated: row.decisionsCreated,
    canEdit: rights.canLead && ready,
    canRetry: rights.canLead && !row.ceoSentAt && !row.tasksCreatedAt && (row.status !== "PENDING" || now.getTime() - row.startedAt.getTime() >= STALE_MS),
    canSendCeo: sendAllowed && ready,
    canCreateTasks: tasksAllowed && ready && !row.tasksCreatedAt,
    sendHint,
    tasksHint,
    ceo,
  };
}

/** Разбор для экрана: видят участники команды встречи и те, кто видит её встречи */
export async function getParse(actor: Actor, id: string, now = new Date()): Promise<ParseView> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  return toView(actor, row, rights, now);
}

export type ParseListItem = { id: string; title: string; status: string; createdAt: string; createdBy: string | null };

/** Разборы встречи команды за неделю: для строки на странице встречи */
export async function listParses(actor: Actor, teamId: string, key: WeekKey): Promise<ParseListItem[]> {
  const meeting = await prisma.meeting.findFirst({ where: { teamId: String(teamId), week: { start: dbDate(key) } }, select: { id: true } });
  if (!meeting) return [];
  await meetingRights(actor, meeting.id);
  const rows = await prisma.meetingParse.findMany({ where: { meetingId: meeting.id }, include: { createdBy: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 10 });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: parseStatusLabel({ status: STATUS[r.status], ceoSentAt: r.ceoSentAt?.toISOString(), tasksCreatedAt: r.tasksCreatedAt?.toISOString() }),
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy?.fullName ?? null,
  }));
}

// ---------- Правка черновиков ----------

/** Черновики задач с экрана: строки без названия отбрасываются, люди только из компании, сроки и направления проверены */
async function cleanDrafts(input: unknown, fallback: ParseTaskDraft[]): Promise<ParseTaskDraft[]> {
  if (!Array.isArray(input)) return fallback;
  if (input.length > PARSE_LIMITS.tasks) fail(`В разборе не больше ${PARSE_LIMITS.tasks} задач`);
  const [people, directions] = await Promise.all([
    prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, select: { slug: true } }),
    prisma.dictionaryItem.findMany({ where: { kind: "DIRECTION", active: true }, select: { code: true } }),
  ]);
  const slugs = new Set(people.map((p) => p.slug));
  const codes = new Set(directions.map((d) => d.code));
  const out: ParseTaskDraft[] = [];
  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const title = taskTitle(String(t.title ?? ""));
    if (!title) continue;
    const owner = typeof t.owner === "string" && slugs.has(t.owner) ? t.owner : null;
    const co = Array.isArray(t.coExecutors) ? [...new Set(t.coExecutors.map(String).filter((s) => slugs.has(s) && s !== owner))].slice(0, PARSE_LIMITS.coExecutors) : [];
    const old = fallback.find((f) => f.key === t.key);
    out.push({
      key: typeof t.key === "string" && t.key ? t.key.slice(0, 20) : `t${i + 1}`,
      on: t.on !== false,
      title,
      outcome: cleanText(String(t.outcome ?? ""), PARSE_LIMITS.outcome) || title,
      ownerText: cleanText(String(t.ownerText ?? old?.ownerText ?? ""), PARSE_LIMITS.name),
      owner,
      coText: Array.isArray(t.coText) ? t.coText.map((s) => cleanText(String(s), PARSE_LIMITS.name)).filter(Boolean).slice(0, PARSE_LIMITS.coExecutors) : [],
      coExecutors: co,
      due: isIsoDate(t.due) ? t.due : (old?.due ?? moscowToday()),
      dueText: typeof t.dueText === "string" ? cleanText(t.dueText, PARSE_LIMITS.dueText) || null : (old?.dueText ?? null),
      dueGuessed: t.dueGuessed === true && (!old || old.due === t.due),
      direction: typeof t.direction === "string" && codes.has(t.direction) ? t.direction : (old?.direction ?? "department"),
      goalMode: t.goalMode === "none" ? "none" : "auto",
      goal: typeof t.goal === "string" ? t.goal.slice(0, 40) : null,
      goalTitle: typeof t.goalTitle === "string" ? cleanText(t.goalTitle, 300) : null,
    });
  }
  return out;
}

const cleanCeo = (c: unknown): CeoSections => {
  const v = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  return { main: bullets(String(v.main ?? "")), risks: bullets(String(v.risks ?? "")), next: bullets(String(v.next ?? "")) };
};

/** Сохранить правки черновиков: weekly для CEO и задачи. expected: момент, который видел экран, иначе чужие правки затрутся */
export async function saveParseDraft(actor: Actor, id: string, patch: { ceo?: CeoSections; tasks?: ParseTaskDraft[] }, expected?: string | null): Promise<ParseView> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  if (!rights.canLead) fail("Править разбор может тот, кто ведёт встречу");
  if (row.status !== "READY") fail("Разбор ещё не готов");
  const current = resultOf(row.result);
  const tasks = patch.tasks !== undefined ? await cleanDrafts(patch.tasks, current.tasks) : current.tasks;
  const ceo = patch.ceo !== undefined ? cleanCeo(patch.ceo) : current.ceo;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM meeting_parses WHERE id = ${row.id} FOR UPDATE`;
    const fresh = await tx.meetingParse.findUniqueOrThrow({ where: { id: row.id }, select: { updatedAt: true } });
    if (expected && fresh.updatedAt.toISOString() !== expected) fail("Разбор уже поправили с другого устройства или другой человек. Обновите страницу, чтобы не затереть чужие правки");
    await tx.meetingParse.update({ where: { id: row.id }, data: { result: { ...current, ceo, tasks } as unknown as Prisma.InputJsonValue } });
    const parts = [patch.ceo !== undefined ? "weekly для CEO" : null, patch.tasks !== undefined ? `задачи (${tasks.filter((t) => t.on).length} из ${tasks.length})` : null].filter(Boolean).join(", ");
    await audit(tx, actor, "meeting.parse.edit", row.meetingId, `Черновик разбора встречи, ${rights.teamName}`, `Сохранено: ${parts || "без изменений"}`);
  });
  return getParse(actor, row.id);
}

// ---------- Отправить CEO ----------

export type SendCeoInput = { ceo: CeoSections; mode?: CeoMergeMode | null; expected?: string | null };

/**
 * Отправить weekly для CEO. Только в приложении: отчёт CEO за неделю сохраняется, помечается отправленным (кем, когда,
 * кому), CEO получает событие в «Мне» и видит отчёт на странице отчёта CEO. Отчёт за неделю уже есть: черновик не
 * затирает его молча, ведущий выбирает «дописать по разделам» или «заменить», и сервер сверяет, что отчёт не
 * поменялся с тех пор, как экран его показал
 */
export async function sendParseToCeo(actor: Actor, id: string, input: SendCeoInput, now = new Date()): Promise<ParseView> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  if (!rights.canLead) fail("Отправить CEO может тот, кто ведёт встречу");
  if (!personal(actor)) fail("Отправить CEO можно при личном входе: так CEO видит, кто отправил");
  if (!canSend(actor)) fail("Отправить CEO может владелец или администратор в режиме управления");
  if (row.status !== "READY") fail("Разбор ещё не готов");
  const draft = cleanCeo(input?.ceo);
  if (!hasCeoText(draft)) fail("Weekly для CEO пустой: напишите хотя бы главное");
  const recipients = await ceoRecipients();
  if (!recipients.length) fail("Не найден CEO: назначьте руководителя компании в «Структуре» или включите профиль CEO в «Людях»");
  const key = keyOf(row);
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM meeting_parses WHERE id = ${row.id} FOR UPDATE`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ceo-report:${key}`}))`;
      const week = await tx.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
      const before = week ? await tx.ceoReport.findUnique({ where: { weekId: week.id } }) : null;
      const existing = before ? { main: before.main, risks: before.risks, next: before.next } : null;
      const filled = hasCeoText(existing);
      if (filled && (input.expected ?? null) !== before!.updatedAt.toISOString()) fail("Отчёт CEO за эту неделю поменялся, пока вы смотрели разбор. Обновите страницу и проверьте, что будет дописано или заменено");
      if (filled && input.mode !== "merge" && input.mode !== "replace") fail("За неделю уже есть отчёт CEO: выберите, дописать черновик по разделам или заменить отчёт");
      const mode: CeoMergeMode = filled ? input.mode! : "replace";
      const final = mergeCeoSections(existing, draft, mode);
      await saveCeoReportIn(tx, actor, key, final);
      // Неделю сохранение уже завело, если её не было
      const saved = await tx.week.findUniqueOrThrow({ where: { start: dbDate(key) }, select: { id: true } });
      const to = recipients.map((r) => ({ id: r.id, name: r.fullName }));
      await tx.ceoReport.update({ where: { weekId: saved.id }, data: { sentAt: now, sentById: actor.personId, sentTo: to } });
      const result = resultOf(row.result);
      await tx.meetingParse.update({ where: { id: row.id }, data: { ceoSentAt: now, ceoSentById: actor.personId, result: { ...result, ceo: draft } as unknown as Prisma.InputJsonValue } });
      await notify(tx, {
        kind: "MEETING",
        recipients: recipients.map((r) => r.id),
        actor,
        subject: `ceo-report:${key}`,
        text: `${actor.fullName} отправил weekly для CEO за неделю ${row.meeting.week.isoNumber} по итогам встречи «${rights.teamName}»`,
      }, now);
      await audit(
        tx,
        actor,
        "meeting.parse.ceo",
        row.meetingId,
        `Weekly для CEO, неделя ${row.meeting.week.isoNumber}`,
        `Отправлен в приложении: ${to.map((t) => t.name).join(", ")}. ${!filled ? "Новый отчёт" : mode === "merge" ? "Дописан к отчёту недели" : "Заменил отчёт недели"}`,
      );
    },
    { timeout: 30_000 },
  );
  return getParse(actor, row.id, now);
}

// ---------- Создать задачи ----------

export type CreateTasksResult = { numbers: number[]; created: CreatedTask[]; decisions: number; already: boolean };

/**
 * Создать отмеченные задачи разом: одна транзакция, сервис задач с правилами согласования этапа 54 (людям других
 * департаментов задача уходит на согласование их руководителю). Нераспознанный ответственный не создаётся молча:
 * строка требует выбора. Повторное нажатие возвращает уже созданные номера и ничего не создаёт
 */
export async function createParseTasks(actor: Actor, id: string, input: { tasks?: ParseTaskDraft[]; decisions?: boolean } = {}): Promise<CreateTasksResult> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  if (!rights.canLead) fail("Создать задачи может тот, кто ведёт встречу");
  if (!personal(actor)) fail("Создать задачи можно при личном входе: так ответственные видят, кто их поставил");
  if (row.tasksCreatedAt) return { numbers: row.taskNumbers, created: await createdTasks(row.taskNumbers), decisions: row.decisionsCreated, already: true };
  if (row.status !== "READY") fail("Разбор ещё не готов");
  const current = resultOf(row.result);
  const drafts = input.tasks !== undefined ? await cleanDrafts(input.tasks, current.tasks) : current.tasks;
  const chosen = drafts.filter((t) => t.on);
  const decisions = input.decisions ? current.decisions.filter((d) => d.text.trim()) : [];
  if (!chosen.length && !decisions.length) fail("Отметьте задачи, которые создать");
  for (const t of chosen) {
    if (!t.owner) fail(`Выберите ответственного в задаче «${t.title}»${t.ownerText ? `: в тексте встречи «${t.ownerText}», такого человека ресурс не нашёл однозначно` : ""}`);
  }
  // Цели по тексту до транзакции (этап 55): подбор читает цели, а транзакция задач должна быть короткой
  const goals = new Map<string, string | null>();
  for (const t of chosen) {
    if (t.goalMode === "none") goals.set(t.key, null);
    else {
      const s = await suggestGoals({ personId: actor.personId, role: actor.role, management: actor.management, limited: false }, { team: row.meeting.teamId, due: t.due, title: t.title, outcome: t.outcome, owner: t.owner });
      goals.set(t.key, s.best);
    }
  }
  const ownerIds = new Map((await prisma.person.findMany({ where: { slug: { in: decisions.map((d) => d.owner).filter((s): s is string => !!s) } }, select: { slug: true, id: true } })).map((p) => [p.slug, p.id]));
  const out = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM meeting_parses WHERE id = ${row.id} FOR UPDATE`;
      // Второе нажатие ждало первое: задачи уже созданы, отдаём те же номера
      const fresh = await tx.meetingParse.findUniqueOrThrow({ where: { id: row.id }, select: { tasksCreatedAt: true, taskNumbers: true, decisionsCreated: true } });
      if (fresh.tasksCreatedAt) return { numbers: fresh.taskNumbers, decisions: fresh.decisionsCreated, already: true };
      const numbers: number[] = [];
      for (const t of chosen) {
        try {
          const r = await createTaskIn(tx, actor, {
            title: t.title,
            outcome: t.outcome || t.title,
            owner: t.owner as PersonSlug,
            coExecutors: t.coExecutors as PersonSlug[],
            direction: t.direction,
            due: t.due,
            source: "meeting",
            sourceNote: `Разбор встречи из Notion, неделя ${row.meeting.week.isoNumber}`,
            team: row.meeting.teamId,
            goal: goals.get(t.key) ?? null,
          });
          numbers.push(r.task.number);
        } catch (error) {
          if (error instanceof TaskRuleError) fail(`Задача «${t.title}»: ${error.message}. Ни одна задача не создана, поправьте строку и нажмите ещё раз`);
          throw error;
        }
      }
      let made = 0;
      for (const d of decisions) {
        const text = cleanText(d.text, MEETING_LIMITS.decision);
        const ownerId = d.owner ? (ownerIds.get(d.owner) ?? null) : null;
        const created = await tx.decision.create({ data: { meetingId: row.meetingId, teamId: row.meeting.teamId, text, ownerId, date: row.meeting.date, createdById: actor.personId } });
        if (ownerId) await notify(tx, { kind: "MEETING", recipients: [ownerId], actor, subject: `decision:${created.id}`, text: `Вы владелец решения встречи: «${text.slice(0, 120)}»` });
        made++;
      }
      await tx.meetingParse.update({
        where: { id: row.id },
        data: { tasksCreatedAt: new Date(), tasksCreatedById: actor.personId, taskNumbers: numbers, decisionsCreated: made, result: { ...current, tasks: drafts } as unknown as Prisma.InputJsonValue },
      });
      await audit(tx, actor, "meeting.parse.tasks", row.meetingId, `Задачи из разбора встречи, ${rights.teamName}`, `Создано задач: ${numbers.length}${numbers.length ? ` (${numbers.join(", ")})` : ""}, решений: ${made}`);
      return { numbers, decisions: made, already: false };
    },
    { timeout: 60_000 },
  );
  return { ...out, created: await createdTasks(out.numbers) };
}

// ---------- Отчёт CEO глазами CEO ----------

export type CeoInboxView = {
  weeks: { key: WeekKey; number: number; sentAt: string }[];
  current: { key: WeekKey; number: number; sections: CeoSections; sentAt: string; sentBy: string | null; editedAfter: boolean } | null;
};

/** Отправленные CEO отчёты: CEO видит их только для чтения. Неделя не задана или не отправлена: последняя отправленная */
export async function ceoSentReports(personId: string, key?: string | null): Promise<CeoInboxView | null> {
  const ceo = await isCeo(personId);
  const rows = await prisma.ceoReport.findMany({
    where: { sentAt: { not: null } },
    include: { week: { select: { start: true, isoNumber: true } }, sentBy: { select: { fullName: true } } },
    orderBy: { week: { start: "desc" } },
    take: 30,
  });
  const mine = rows.filter((r) => ceo || (Array.isArray(r.sentTo) && (r.sentTo as { id?: string }[]).some((t) => t?.id === personId)));
  if (!ceo && !mine.length) return null;
  const pick = mine.find((r) => isoFromDbDate(r.week.start) === key) ?? mine[0] ?? null;
  return {
    weeks: mine.map((r) => ({ key: isoFromDbDate(r.week.start) as WeekKey, number: r.week.isoNumber, sentAt: r.sentAt!.toISOString() })),
    current: pick
      ? {
          key: isoFromDbDate(pick.week.start) as WeekKey,
          number: pick.week.isoNumber,
          sections: { main: pick.main, risks: pick.risks, next: pick.next },
          sentAt: pick.sentAt!.toISOString(),
          sentBy: pick.sentBy?.fullName ?? null,
          editedAfter: pick.updatedAt.getTime() - pick.sentAt!.getTime() > 1000,
        }
      : null,
  };
}

