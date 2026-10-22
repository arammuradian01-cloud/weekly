// Разбор встречи из Notion (этап 61). Решение Арама 21.10: Excel-борд больше не главный, главное приложение. Ведущий
// встречи даёт ссылку на страницу встречи в Notion, ресурс читает её через внутреннюю интеграцию, разбирает текст (Claude
// по API, без ключа или при сбое правилами) и показывает итоги встречи, черновик weekly для CEO и черновики задач.
// Ведущий правит черновики, отправляет weekly CEO (только в приложении) и создаёт задачи разом, одной транзакцией через
// сервис задач с правилами согласования этапа 54. Повторное нажатие ничего не дублирует.
//
// Права: разбор видят те, кто видит встречу команды; запускают и правят те, кто её ведёт (canLead этапа 23). Полный текст
// страницы видят только ведущие при личном входе, черновик weekly для CEO не видят наблюдатель и общий логин. Отправить
// CEO может владелец или администратор в режиме управления, создать задачи ведущий; и то и другое при личном входе:
// по общему логину профиль выбирают сами, а CEO и ответственные должны видеть настоящего автора.
// В журнал пишется каждое действие, текст встречи в журнал и логи не попадает.

import { prisma } from "@/lib/db";
import type { MeetingParseMethod, MeetingParseStatus, Prisma } from "@/generated/prisma/client";
import { plural, type IsoDate } from "@/domain/dates";
import type { PersonSlug, WeekKey } from "@/domain/types";
import { TaskRuleError, createTaskIn, type Actor } from "@/lib/tasks/service";
import { dbDate, isIsoDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { SYSTEM_ACTOR_ID, notify } from "@/lib/inbox/notify";
import { loadTeamNodes } from "@/lib/org/scope";
import { isWeekKey } from "@/lib/weekly/weeks";
import { NameIndex } from "@/lib/bord/names";
import { suggestGoals } from "@/lib/goals/service";
import { goalFits } from "@/lib/goals/personal";
import { quarterOf } from "@/lib/goals/parse";
import { getCeoReport, saveCeoReportIn, type CeoReportView } from "@/lib/weekly/service";
import type { CeoSections } from "@/lib/weekly/rules";
import type { CeoMeeting } from "@/lib/ceo/text";
import { ceoContext, type CeoContext } from "@/lib/ceo/assembled";
import { ceoRecipients } from "@/lib/ceo/report";
import { meetingIdFor, meetingRights, notionUrlOf, MEETING_LIMITS } from "./service";
import { NotionError, NOTION_MESSAGES, meaningfulText, notionDepsFromEnv, notionPageIdFromUrl, readNotionPage, type NotionDeps } from "./notion-api";
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
  sameTask,
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

/** Идущий разбор обновляет отметку «жив» так часто */
export const BEAT_MS = 15_000;
/** Без отметки «жив» столько времени разбор считается зависшим (сервер перезапустился посреди разбора) */
export const STALE_MS = 75_000;

const STATUS: Record<MeetingParseStatus, "pending" | "ready" | "failed"> = { PENDING: "pending", READY: "ready", FAILED: "failed" };
const METHOD: Record<MeetingParseMethod, "ai" | "rules"> = { AI: "ai", RULES: "rules" };

const parseInclude = {
  meeting: { select: { id: true, date: true, teamId: true, team: { select: { name: true, leaderId: true } }, week: { select: { start: true, isoNumber: true } } } },
  createdBy: { select: { fullName: true } },
  startedBy: { select: { fullName: true } },
  ceoSentBy: { select: { fullName: true } },
  tasksCreatedBy: { select: { fullName: true } },
} satisfies Prisma.MeetingParseInclude;
type ParseRow = Prisma.MeetingParseGetPayload<{ include: typeof parseInclude }>;

/** Когда разбор последний раз подавал признаки жизни */
const aliveAt = (row: { startedAt: Date; lastBeatAt: Date | null }) => (row.lastBeatAt && row.lastBeatAt > row.startedAt ? row.lastBeatAt : row.startedAt);
const isStale = (row: { status: MeetingParseStatus; startedAt: Date; lastBeatAt: Date | null }, now: Date) => row.status === "PENDING" && now.getTime() - aliveAt(row).getTime() >= STALE_MS;

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
  /** Полный текст страницы: только ведущим при личном входе, остальным пусто */
  pageText: string;
  canSeeText: boolean;
  result: ParseResult;
  startedAt: string;
  finishedAt: string | null;
  /** Разбор давно не подавал признаков жизни: можно повторить, экран всё равно ждёт поздний результат */
  stale: boolean;
  createdBy: string | null;
  /** Кто запустил последнюю попытку */
  startedBy: string | null;
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
  /** Черновик weekly для CEO: не видят наблюдатель и общий логин */
  canSeeCeo: boolean;
  canSendCeo: boolean;
  canCreateTasks: boolean;
  /** Почему нельзя отправить CEO или создать задачи: подсказка вместо кнопки */
  sendHint: string | null;
  tasksHint: string | null;
  /** Отчёт CEO за неделю и кому уйдёт: только тем, кто может отправить */
  ceo: { existing: CeoReportView; recipients: string[] } | null;
  /** Живые части собранного отчёта для предпросмотра: цифры, решения и благодарности. Только тем, кто отправляет CEO */
  ceoPreview: CeoContext | null;
};

const personal = (actor: Actor) => actor.via !== "TEAM";
const canSend = (actor: Actor) => personal(actor) && (actor.management === "OWNER" || actor.management === "ADMIN");
const seesCeoDraft = (actor: Actor) => personal(actor) && actor.role !== "OBSERVER";
const seesText = (actor: Actor, canLead: boolean) => canLead && personal(actor) && actor.role !== "OBSERVER";
type GoalWho = { personId: string; role: Actor["role"]; management: Actor["management"]; limited?: boolean };
const whoOf = (actor: Actor): GoalWho => ({ personId: actor.personId, role: actor.role, management: actor.management, limited: actor.via === "TEAM" && !actor.management });

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
    decisions: Array.isArray(v.decisions) ? (v.decisions as ParseDecision[]).map((d, i) => ({ ...d, key: d.key ?? `d${i + 1}`, on: d.on === true })) : [],
    risks: Array.isArray(v.risks) ? v.risks.map(String) : [],
    next: Array.isArray(v.next) ? v.next.map(String) : [],
    ceo: v.ceo && typeof v.ceo === "object" ? { main: String(v.ceo.main ?? ""), risks: String(v.ceo.risks ?? ""), next: String(v.ceo.next ?? "") } : EMPTY_RESULT.ceo,
    tasks: Array.isArray(v.tasks) ? (v.tasks as ParseTaskDraft[]) : [],
    ...(typeof v.unreadable === "number" && v.unreadable > 0 ? { unreadable: v.unreadable } : {}),
  };
}

// ---------- Кто CEO ----------

// Кто CEO и отчёт глазами CEO живут в src/lib/ceo/report.ts (этап 66): их же берёт отправка со страницы «Отчёт CEO»
export { ceoRecipients, ceoSentReports, isCeo, type CeoInboxView } from "@/lib/ceo/report";

// ---------- Запуск ----------

/** Номера задач, уже созданных из прошлых разборов этой встречи. page: только разборы этой страницы */
async function createdBefore(meetingId: string, page?: string): Promise<number[]> {
  const rows = await prisma.meetingParse.findMany({ where: { meetingId, ...(page ? { notionPageId: page } : {}), tasksCreatedAt: { not: null } }, select: { taskNumbers: true } });
  return [...new Set(rows.flatMap((r) => r.taskNumbers))].sort((a, b) => a - b);
}

export type StartResult = { id: string | null; started: boolean; created?: number[] };

/**
 * Начать разбор: встреча команды за неделю (нет, собирается), строка разбора «идёт». Сам разбор: runParse. Если по этой
 * встрече и странице задачи уже созданы, разбор без repeat не начинается: экран показывает номера и спрашивает ещё раз
 */
export async function startParse(actor: Actor, teamId: string, key: WeekKey, url: string, opts: { repeat?: boolean } = {}, now = new Date()): Promise<StartResult> {
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  const link = String(url ?? "").trim();
  const pageId = notionPageIdFromUrl(link);
  if (!pageId) return fail(NOTION_MESSAGES["bad-url"]);
  const meetingId = await meetingIdFor(actor, String(teamId), key);
  const rights = await meetingRights(actor, meetingId);
  if (!rights.canLead) fail("Разобрать встречу может тот, кто её ведёт: руководитель команды, руководитель выше или режим управления");
  const created = await createdBefore(meetingId, pageId);
  if (created.length && !opts.repeat) return { id: null, started: false, created };
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${meetingId} FOR UPDATE`;
    // Двойное нажатие: идущий разбор той же страницы не запускается второй раз
    const pending = await tx.meetingParse.findMany({ where: { meetingId, notionPageId: pageId, status: "PENDING" }, select: { id: true, status: true, startedAt: true, lastBeatAt: true } });
    const running = pending.find((p) => !isStale(p, now));
    if (running) return { id: running.id, started: false };
    // Зависшие разборы той же страницы закрываются: иначе они вечно «идут» в списке разборов встречи
    const stuck = pending.map((p) => p.id);
    if (stuck.length) await tx.meetingParse.updateMany({ where: { id: { in: stuck }, status: "PENDING" }, data: { status: "FAILED", note: "Прервано: запущен новый разбор этой страницы", finishedAt: now } });
    const row = await tx.meetingParse.create({ data: { meetingId, notionUrl: notionUrlOf(link) ?? link.slice(0, 500), notionPageId: pageId, createdById: actor.personId, startedById: actor.personId, startedAt: now, attempts: 1 } });
    await tx.meeting.update({ where: { id: meetingId }, data: { notionUrl: notionUrlOf(link) } });
    await audit(tx, actor, "meeting.parse.start", meetingId, `Разбор встречи из Notion, ${rights.teamName}`, `${link.slice(0, 500)}${created.length ? `. Повторный разбор: задачи ${created.join(", ")} уже созданы` : ""}`);
    return { id: row.id, started: true };
  });
}

/** Повторить разбор: не получился, завис или ведущий хочет разобрать страницу заново (пока ничего не отправлено) */
export async function retryParse(actor: Actor, id: string, now = new Date()): Promise<{ id: string }> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  if (!rights.canLead) fail("Повторить разбор может тот, кто ведёт встречу");
  if (row.status === "PENDING" && !isStale(row, now)) fail("Разбор уже идёт: подождите минуту");
  const SENT = "Из этого разбора уже отправлен weekly или созданы задачи. Чтобы разобрать страницу снова, запустите новый разбор со страницы встречи";
  if (row.tasksCreatedAt || row.ceoSentAt) fail(SENT);
  const cutoff = new Date(now.getTime() - STALE_MS);
  await prisma.$transaction(async (tx) => {
    // Замок строки и условие в самом запросе: одновременные «Создать задачи» или «Отправить CEO» не проскочат между
    // проверкой и повтором
    await tx.$queryRaw`SELECT id FROM meeting_parses WHERE id = ${row.id} FOR UPDATE`;
    const done = await tx.meetingParse.updateMany({
      where: {
        id: row.id,
        tasksCreatedAt: null,
        ceoSentAt: null,
        OR: [{ status: { in: ["READY", "FAILED"] } }, { status: "PENDING", startedAt: { lt: cutoff }, OR: [{ lastBeatAt: null }, { lastBeatAt: { lt: cutoff } }] }],
      },
      data: { status: "PENDING", startedAt: now, startedById: actor.personId, lastBeatAt: null, finishedAt: null, note: null, attempts: { increment: 1 } },
    });
    if (!done.count) {
      const fresh = await tx.meetingParse.findUniqueOrThrow({ where: { id: row.id }, select: { tasksCreatedAt: true, ceoSentAt: true } });
      fail(fresh.tasksCreatedAt || fresh.ceoSentAt ? SENT : "Разбор уже идёт: подождите минуту");
    }
    await audit(tx, actor, "meeting.parse.retry", row.meetingId, `Разбор встречи из Notion, ${rights.teamName}`, `Попытка ${row.attempts + 1}`);
  });
  return { id: row.id };
}

async function loadRow(id: string): Promise<ParseRow> {
  const row = await prisma.meetingParse.findUnique({ where: { id }, include: parseInclude });
  return row ?? fail("Такого разбора нет");
}

export type ParseDeps = { notion?: NotionDeps; claude?: ClaudeDeps | null; now?: Date; beatMs?: number };

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
  const knows = (name: string) =>
    indexes.some((idx) => {
      const r = idx.find(name);
      return !!r.person || !!r.ambiguous;
    });
  return { people, find, knows };
}

const blocksWord = (n: number) => `${n} ${plural(n, "блок", "блока", "блоков")}`;

/**
 * Сделать разбор: прочитать страницу, разобрать текст, сопоставить людей, подобрать цели. Ничего не бросает: ошибка
 * Notion и пустая страница становятся статусом «не разобрано» с понятным текстом, сбой Claude уводит разбор в правила.
 * Пока идёт, обновляет отметку «жив»; когда закончил, тому, кто запустил, и руководителю команды событие в «Мне»
 */
export async function runParse(id: string, deps: ParseDeps = {}): Promise<void> {
  const row = await prisma.meetingParse.findUnique({ where: { id }, include: { ...parseInclude, createdBy: { select: { id: true, fullName: true, role: true } }, startedBy: { select: { id: true, fullName: true, role: true } } } });
  if (!row || row.status !== "PENDING") return;
  const startedAt = row.startedAt;
  const now = deps.now ?? new Date();
  const starter = row.startedBy ?? row.createdBy;
  const mine = { id, status: "PENDING" as const, startedAt };
  const beatOnce = () => prisma.meetingParse.updateMany({ where: mine, data: { lastBeatAt: new Date() } }).catch(() => undefined);
  await beatOnce();
  const beat = setInterval(() => void beatOnce(), deps.beatMs ?? BEAT_MS);
  beat.unref?.();
  const finish = async (data: Prisma.MeetingParseUpdateManyMutationInput, action: string, after: string, ok: boolean) => {
    await prisma.$transaction(async (tx) => {
      // Разбор, который обогнал повтор, ничего не перезаписывает: пишет только попытка, начатая последней
      const done = await tx.meetingParse.updateMany({ where: mine, data: { ...data, finishedAt: new Date(), lastBeatAt: new Date() } });
      if (!done.count) return;
      await tx.auditLog.create({
        data: { action, actorId: starter?.id ?? null, actorName: starter?.fullName ?? null, source: "SYSTEM", entity: "meeting", entityId: row.meetingId, field: `Разбор встречи из Notion, ${row.meeting.team.name}`, after },
      });
      // Событие тому, кто запустил эту попытку (первый запуск или «Повторить»), и руководителю команды
      await notify(tx, {
        kind: "MEETING",
        recipients: [starter?.id, row.meeting.team.leaderId],
        actor: { personId: SYSTEM_ACTOR_ID, fullName: "Ресурс" },
        subject: `meeting-parse:${id}`,
        text: ok ? `Встреча «${row.meeting.team.name}» разобрана: проверьте итоги, weekly для CEO и задачи` : `Встречу «${row.meeting.team.name}» не разобрали: ${after.slice(0, 160)}`,
      });
    });
  };
  try {
    let page;
    try {
      page = await readNotionPage(row.notionPageId, deps.notion ?? (await notionDepsFromEnv()));
    } catch (error) {
      const message = error instanceof NotionError ? error.message : NOTION_MESSAGES.other;
      if (!(error instanceof NotionError)) console.error("Разбор встречи: Notion не прочитан", error instanceof Error ? error.name : "ошибка");
      await finish({ status: "FAILED", note: message }, "meeting.parse.fail", message, false);
      return;
    }
    const unreadNote = page.unreadable
      ? `${blocksWord(page.unreadable)} не прочитано: например, AI-заметки встречи Notion API не отдаёт${page.syncedSkipped ? `, а копии синхронизированных блоков с других страниц (${page.syncedSkipped}) не читаются, пока задана NOTION_ALLOWED_PARENTS` : ""}. Если итогов там больше, перенесите их обычным текстом на страницу`
      : null;
    if (!meaningfulText(page.text)) {
      const message = ["На странице нет текста, который можно разобрать", unreadNote].filter(Boolean).join(". ");
      await finish({ status: "FAILED", note: message, title: page.title, pageText: page.text }, "meeting.parse.fail", message, false);
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
    note = [note, page.cutByTime ? "Notion отвечал долго: текст обрезан по времени, разобрано начало страницы" : page.truncated ? "Страница длинная: разобрано начало" : null, unreadNote].filter(Boolean).join(". ");

    const existing = await prisma.task.findMany({
      where: { number: { in: await createdBefore(row.meetingId) }, archivedAt: null },
      select: { number: true, title: true, owner: { select: { slug: true } } },
    });
    const who = starter ? { personId: starter.id, role: starter.role, management: starter.role === "OWNER" ? ("OWNER" as const) : starter.role === "ADMIN" ? ("ADMIN" as const) : null } : null;
    const result = await buildResult(raw, {
      meetingDate,
      today,
      teamId: row.meeting.teamId,
      directions: directions.map((d) => d.code),
      find: names.find,
      who,
      existing: existing.map((t) => ({ number: t.number, title: t.title, owner: t.owner?.slug ?? null })),
    });
    if (page.unreadable) result.unreadable = page.unreadable;
    await finish(
      { status: "READY", method, model, note: note || null, title: page.title, pageText: page.text, result: result as unknown as Prisma.InputJsonValue },
      "meeting.parse.done",
      `${method === "AI" ? `Разобрал Claude (${model})` : "Разобрано правилами"}: главного ${result.summary.length}, решений ${result.decisions.length}, задач ${result.tasks.length}${page.unreadable ? `, не прочитано блоков ${page.unreadable}` : ""}`,
      true,
    );
  } catch (error) {
    console.error("Разбор встречи не получился", error instanceof Error ? error.name : "ошибка");
    await finish({ status: "FAILED", note: "Разбор не получился из-за ошибки на сервере. Нажмите «Повторить»" }, "meeting.parse.fail", "Ошибка на сервере", false).catch(() => undefined);
  } finally {
    clearInterval(beat);
  }
}

type BuildContext = {
  meetingDate: IsoDate;
  today: IsoDate;
  teamId: string;
  directions: string[];
  find: (name: string | null | undefined) => { id: string; slug: string; defaultDirection: { code: string } | null } | null;
  who: GoalWho | null;
  /** Задачи, уже созданные из прошлых разборов этой встречи */
  existing?: { number: number; title: string; owner: string | null }[];
};

/** Сырой разбор в черновики: люди по именам, сроки, направления, цели по тексту (этап 55), уже созданные задачи */
export async function buildResult(raw: RawMeeting, ctx: BuildContext): Promise<ParseResult> {
  const fallbackDirection = ctx.directions.includes("department") ? "department" : (ctx.directions[0] ?? "department");
  const tasks: ParseTaskDraft[] = [];
  for (const [i, t] of raw.tasks.entries()) {
    const owner = ctx.find(t.owner);
    const co = t.coExecutors.map((n) => ({ text: n, p: ctx.find(n) }));
    const dueOk = t.due && t.due >= ctx.today ? t.due : null;
    const due = dueOk ?? defaultDue(ctx.meetingDate, ctx.today);
    const direction = t.direction && ctx.directions.includes(t.direction) ? t.direction : owner?.defaultDirection?.code && ctx.directions.includes(owner.defaultDirection.code) ? owner.defaultDirection.code : fallbackDirection;
    const twin = (ctx.existing ?? []).find((e) => sameTask({ title: t.title, owner: owner?.slug ?? null }, e));
    tasks.push({
      key: `t${i + 1}`,
      on: !twin,
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
      goal: null,
      goalTitle: null,
      existing: twin?.number ?? null,
    });
  }
  return {
    summary: raw.summary,
    decisions: raw.decisions.map((d, i) => {
      const p = ctx.find(d.owner);
      return { key: `d${i + 1}`, on: false, text: d.text, ownerText: d.owner, owner: p?.slug ?? null };
    }),
    risks: raw.risks,
    next: raw.next,
    ceo: ceoDraftOf(raw),
    tasks: await resolveGoals(ctx.who, ctx.teamId, tasks),
  };
}

/**
 * Цель задачи (этап 55): цель из черновика, если она всё ещё допустима для команды, людей задачи и квартала срока; иначе
 * подбор по тексту тем же правилом, что в форме новой задачи. Одна функция и для черновика, и для создания задачи: что
 * показано в черновике, то и получит задача
 */
export async function resolveGoals(who: GoalWho | null, teamId: string, drafts: ParseTaskDraft[]): Promise<ParseTaskDraft[]> {
  if (!who || !drafts.length) return drafts;
  const nodes = await loadTeamNodes(prisma);
  const today = moscowToday();
  const slugs = [...new Set(drafts.flatMap((d) => [d.owner, ...d.coExecutors].filter((s): s is string => !!s)))];
  const ids = new Map((await prisma.person.findMany({ where: { slug: { in: slugs } }, select: { slug: true, id: true } })).map((p) => [p.slug, p.id]));
  const goals = new Map(
    (await prisma.goal.findMany({ where: { id: { in: drafts.map((d) => d.goal).filter((g): g is string => !!g) } }, select: { id: true, title: true, code: true, teamId: true, ownerId: true, source: true, quarter: true, result: true } })).map((g) => [g.id, g]),
  );
  // Подбор по тексту для черновиков без годной цели идёт параллельно: на 50 задачах последовательный подбор заметен
  return Promise.all(
    drafts.map(async (d): Promise<ParseTaskDraft> => {
      if (d.goalMode === "none") return { ...d, goal: null, goalTitle: null };
      const g = d.goal ? goals.get(d.goal) : undefined;
      const people = [d.owner, ...d.coExecutors].map((s) => (s ? ids.get(s) : undefined)).filter((x): x is string => !!x);
      if (g && g.result !== "DROPPED" && [quarterOf(today), quarterOf(d.due)].includes(g.quarter) && goalFits(g, { teamId }, people, nodes)) {
        return { ...d, goalTitle: g.code ? `${g.code}. ${g.title}` : g.title };
      }
      try {
        const s = await suggestGoals(who, { team: teamId, due: d.due, title: d.title, outcome: d.outcome, owner: d.owner });
        const best = s.best ? s.options.find((o) => o.id === s.best) : null;
        return { ...d, goal: best?.id ?? null, goalTitle: best?.title ?? null };
      } catch {
        // Подбор цели не обязателен: без него черновик остаётся
        return { ...d, goal: null, goalTitle: null };
      }
    }),
  );
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
  const canSeeCeo = seesCeoDraft(actor);
  const canSeeText = seesText(actor, rights.canLead);
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
  const stored = resultOf(row.result);
  // Цель в черновике хранится подобранной: пересчёт при сохранении черновика и при создании задач, а не на каждом показе
  const result: ParseResult = { ...stored, ceo: canSeeCeo ? stored.ceo : EMPTY_RESULT.ceo };
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
    statusLabel: parseStatusLabel({ status, stale: isStale(row, now), ceoSentAt: row.ceoSentAt?.toISOString(), tasksCreatedAt: row.tasksCreatedAt?.toISOString() }),
    method: row.method ? METHOD[row.method] : null,
    model: row.model,
    note: row.note,
    pageText: canSeeText ? row.pageText : "",
    canSeeText,
    result,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    stale: isStale(row, now),
    createdBy: row.createdBy?.fullName ?? null,
    startedBy: row.startedBy?.fullName ?? row.createdBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ceoSentAt: row.ceoSentAt?.toISOString() ?? null,
    ceoSentBy: row.ceoSentBy?.fullName ?? null,
    tasksCreatedAt: row.tasksCreatedAt?.toISOString() ?? null,
    tasksCreatedBy: row.tasksCreatedBy?.fullName ?? null,
    createdTasks: await createdTasks(row.taskNumbers),
    decisionsCreated: row.decisionsCreated,
    canEdit: rights.canLead && ready,
    canRetry: rights.canLead && !row.ceoSentAt && !row.tasksCreatedAt && (row.status !== "PENDING" || isStale(row, now)),
    canSeeCeo,
    canSendCeo: sendAllowed && ready,
    canCreateTasks: tasksAllowed && ready && !row.tasksCreatedAt,
    sendHint,
    tasksHint,
    ceo,
    // Собранный отчёт (цифры, решения и благодарности топ-команды) только тем, кто отправляет CEO
    ceoPreview: sendAllowed && ready ? await ceoContext(actor, key) : null,
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
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: parseStatusLabel({ status: STATUS[r.status], stale: isStale(r, now), ceoSentAt: r.ceoSentAt?.toISOString(), tasksCreatedAt: r.tasksCreatedAt?.toISOString() }),
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
      ownerText: cleanText(String(old?.ownerText ?? t.ownerText ?? ""), PARSE_LIMITS.name),
      owner,
      coText: Array.isArray(t.coText) ? t.coText.map((s) => cleanText(String(s), PARSE_LIMITS.name)).filter(Boolean).slice(0, PARSE_LIMITS.coExecutors) : [],
      coExecutors: co,
      due: isIsoDate(t.due) ? t.due : (old?.due ?? moscowToday()),
      dueText: old?.dueText ?? null,
      dueGuessed: !!old?.dueGuessed && old.due === t.due,
      direction: typeof t.direction === "string" && codes.has(t.direction) ? t.direction : (old?.direction ?? "department"),
      goalMode: t.goalMode === "none" ? "none" : "auto",
      goal: typeof t.goal === "string" ? t.goal.slice(0, 40) : null,
      goalTitle: null,
      // Пометку «уже есть задача» ставит сервер при разборе, с экрана она не приходит
      existing: old?.existing ?? null,
    });
  }
  return out;
}

/** Решения с экрана: текст можно поправить, владелец только из компании, в журнал идут отмеченные */
async function cleanDecisions(input: unknown, fallback: ParseDecision[]): Promise<ParseDecision[]> {
  if (!Array.isArray(input)) return fallback;
  if (input.length > PARSE_LIMITS.decisions) fail(`В разборе не больше ${PARSE_LIMITS.decisions} решений`);
  const slugs = new Set((await prisma.person.findMany({ where: { active: true }, select: { slug: true } })).map((p) => p.slug));
  const out: ParseDecision[] = [];
  for (const [i, raw] of input.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const text = cleanText(String(d.text ?? ""), MEETING_LIMITS.decision);
    if (!text) continue;
    const old = fallback.find((f) => f.key === d.key);
    out.push({
      key: typeof d.key === "string" && d.key ? d.key.slice(0, 20) : `d${i + 1}`,
      on: d.on === true,
      text,
      ownerText: old?.ownerText ?? null,
      owner: typeof d.owner === "string" && slugs.has(d.owner) ? d.owner : null,
    });
  }
  return out;
}

const cleanCeo = (c: unknown): CeoSections => {
  const v = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
  return { main: bullets(String(v.main ?? "")), risks: bullets(String(v.risks ?? "")), next: bullets(String(v.next ?? "")) };
};

export type DraftPatch = { ceo?: CeoSections; tasks?: ParseTaskDraft[]; decisions?: ParseDecision[] };

/**
 * Сохранить правки черновиков: weekly для CEO, задачи и решения. expected: момент, который видел экран, иначе чужие
 * правки затрутся. Черновик weekly для CEO правит только тот, кому он показан
 */
export async function saveParseDraft(actor: Actor, id: string, patch: DraftPatch, expected?: string | null): Promise<ParseView> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  if (!rights.canLead) fail("Править разбор может тот, кто ведёт встречу");
  if (row.status !== "READY") fail("Разбор ещё не готов");
  const current = resultOf(row.result);
  const ceoAllowed = seesCeoDraft(actor) && patch.ceo !== undefined;
  // Цель пересчитывается здесь: черновик хранит ту цель, что получит задача у этого ведущего
  const tasks = patch.tasks !== undefined && !row.tasksCreatedAt ? await resolveGoals(whoOf(actor), row.meeting.teamId, await cleanDrafts(patch.tasks, current.tasks)) : current.tasks;
  const decisions = patch.decisions !== undefined && !row.tasksCreatedAt ? await cleanDecisions(patch.decisions, current.decisions) : current.decisions;
  const ceo = ceoAllowed ? cleanCeo(patch.ceo) : current.ceo;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM meeting_parses WHERE id = ${row.id} FOR UPDATE`;
    const fresh = await tx.meetingParse.findUniqueOrThrow({ where: { id: row.id }, select: { updatedAt: true } });
    if (expected && fresh.updatedAt.toISOString() !== expected) fail("Разбор уже поправили с другого устройства или другой человек. Обновите страницу, чтобы не затереть чужие правки");
    await tx.meetingParse.update({ where: { id: row.id }, data: { result: { ...current, ceo, tasks, decisions } as unknown as Prisma.InputJsonValue } });
    const parts = [
      ceoAllowed ? "weekly для CEO" : null,
      patch.tasks !== undefined ? `задачи (${tasks.filter((t) => t.on).length} из ${tasks.length})` : null,
      patch.decisions !== undefined ? `решения (${decisions.filter((d) => d.on).length} из ${decisions.length})` : null,
    ]
      .filter(Boolean)
      .join(", ");
    await audit(tx, actor, "meeting.parse.edit", row.meetingId, `Черновик разбора встречи, ${rights.teamName}`, `Сохранено: ${parts || "без изменений"}`);
  });
  return getParse(actor, row.id);
}

// ---------- Отправить CEO ----------

export type SendCeoInput = { ceo: CeoSections; mode?: CeoMergeMode | null; expected?: string | null };

/** Что ушло CEO: разделы и встречи в момент отправки */
type Snapshot = CeoSections & { meetings: CeoMeeting[] };

/**
 * Отправить weekly для CEO. Только в приложении: отчёт CEO за неделю сохраняется, помечается отправленным (кем, когда,
 * кому) со снимком разделов, CEO получает событие в «Мне» и видит собранный отчёт на странице отчёта CEO. Отчёт за
 * неделю уже есть: черновик не затирает его молча, ведущий выбирает «дописать по разделам» или «заменить», и сервер
 * сверяет, что отчёт не поменялся с тех пор, как экран его показал
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
      // Пока ждали замок, разбор могли запустить заново: отправлять можно только готовый
      const locked = await tx.meetingParse.findUniqueOrThrow({ where: { id: row.id }, select: { status: true } });
      if (locked.status !== "READY") fail("Разбор запущен заново: дождитесь результата и проверьте черновик");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ceo-report:${key}`}))`;
      const week = await tx.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
      const before = week ? await tx.ceoReport.findUnique({ where: { weekId: week.id } }) : null;
      const existing = before ? { main: before.main, risks: before.risks, next: before.next } : null;
      const filled = hasCeoText(existing);
      if (filled && (input.expected ?? null) !== before!.updatedAt.toISOString()) fail("Отчёт CEO за эту неделю поменялся, пока вы смотрели разбор. Обновите страницу и проверьте, что будет дописано или заменено");
      if (filled && input.mode !== "merge" && input.mode !== "replace") fail("За неделю уже есть отчёт CEO: выберите, дописать черновик по разделам или заменить отчёт");
      const mode: CeoMergeMode = filled ? input.mode! : "replace";
      const final = mergeCeoSections(existing, draft, mode);
      const saved = await saveCeoReportIn(tx, actor, key, final);
      const savedWeek = await tx.week.findUniqueOrThrow({ where: { start: dbDate(key) }, select: { id: true } });
      const to = recipients.map((r) => ({ id: r.id, name: r.fullName }));
      // Снимок из того, что действительно сохранилось: после чистки текста в отчёте
      const snapshot: Snapshot = { ...(saved.sections ?? final), meetings: saved.meetings };
      // Момент отправки тот же, что момент записи отчёта: правка после отправки видна по более позднему updatedAt.
      // Запрос мимо Prisma, иначе @updatedAt сдвинулся бы ещё раз
      await tx.$executeRaw`UPDATE ceo_reports SET "sentAt" = "updatedAt", "sentById" = ${actor.personId}, "sentTo" = ${JSON.stringify(to)}::jsonb, "sentSnapshot" = ${JSON.stringify(snapshot)}::jsonb WHERE "weekId" = ${savedWeek.id}`;
      const result = resultOf(row.result);
      await tx.meetingParse.update({ where: { id: row.id }, data: { ceoSentAt: now, ceoSentById: actor.personId, result: { ...result, ceo: draft } as unknown as Prisma.InputJsonValue } });
      await notify(
        tx,
        {
          kind: "MEETING",
          recipients: recipients.map((r) => r.id),
          actor,
          subject: `ceo-report:${key}`,
          text: `${actor.fullName} отправил weekly для CEO за неделю ${row.meeting.week.isoNumber} по итогам встречи «${rights.teamName}»`,
        },
        now,
      );
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
 * строка требует выбора. Решения встречи записываются только отмеченные, по одному. Повторное нажатие возвращает уже
 * созданные номера и ничего не создаёт
 */
export async function createParseTasks(actor: Actor, id: string, input: { tasks?: ParseTaskDraft[]; decisions?: ParseDecision[] } = {}): Promise<CreateTasksResult> {
  const row = await loadRow(String(id));
  const rights = await meetingRights(actor, row.meetingId);
  if (!rights.canLead) fail("Создать задачи может тот, кто ведёт встречу");
  if (!personal(actor)) fail("Создать задачи можно при личном входе: так ответственные видят, кто их поставил");
  if (row.tasksCreatedAt) return { numbers: row.taskNumbers, created: await createdTasks(row.taskNumbers), decisions: row.decisionsCreated, already: true };
  if (row.status !== "READY") fail("Разбор ещё не готов");
  const current = resultOf(row.result);
  const drafts = input.tasks !== undefined ? await cleanDrafts(input.tasks, current.tasks) : current.tasks;
  const allDecisions = input.decisions !== undefined ? await cleanDecisions(input.decisions, current.decisions) : current.decisions;
  const chosen = drafts.filter((t) => t.on);
  const decisions = allDecisions.filter((d) => d.on);
  if (!chosen.length && !decisions.length) fail("Отметьте задачи или решения, которые записать");
  for (const t of chosen) {
    if (!t.owner) fail(`Выберите ответственного в задаче «${t.title}»${t.ownerText ? `: в тексте встречи «${t.ownerText}», такого человека ресурс не нашёл однозначно` : ""}`);
  }
  // Цели до транзакции (этап 55): цель черновика, если всё ещё подходит, иначе подбор тем же правилом, что у создающего
  const goals = new Map((await resolveGoals(whoOf(actor), row.meeting.teamId, chosen)).map((t) => [t.key, t.goal]));
  const ownerIds = new Map((await prisma.person.findMany({ where: { slug: { in: decisions.map((d) => d.owner).filter((s): s is string => !!s) } }, select: { slug: true, id: true } })).map((p) => [p.slug, p.id]));
  const out = await prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM meeting_parses WHERE id = ${row.id} FOR UPDATE`;
      // Второе нажатие ждало первое: задачи уже созданы, отдаём те же номера
      const fresh = await tx.meetingParse.findUniqueOrThrow({ where: { id: row.id }, select: { status: true, tasksCreatedAt: true, taskNumbers: true, decisionsCreated: true } });
      if (fresh.tasksCreatedAt) return { numbers: fresh.taskNumbers, decisions: fresh.decisionsCreated, already: true };
      // Пока ждали замок, разбор могли запустить заново: задачи создаются только из готового
      if (fresh.status !== "READY") fail("Разбор запущен заново: дождитесь результата и проверьте черновики");
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
        const ownerId = d.owner ? (ownerIds.get(d.owner) ?? null) : null;
        const created = await tx.decision.create({ data: { meetingId: row.meetingId, teamId: row.meeting.teamId, text: d.text, ownerId, date: row.meeting.date, createdById: actor.personId } });
        if (ownerId) await notify(tx, { kind: "MEETING", recipients: [ownerId], actor, subject: `decision:${created.id}`, text: `Вы владелец решения встречи: «${d.text.slice(0, 120)}»` });
        made++;
      }
      await tx.meetingParse.update({
        where: { id: row.id },
        data: { tasksCreatedAt: new Date(), tasksCreatedById: actor.personId, taskNumbers: numbers, decisionsCreated: made, result: { ...current, tasks: drafts, decisions: allDecisions } as unknown as Prisma.InputJsonValue },
      });
      await audit(tx, actor, "meeting.parse.tasks", row.meetingId, `Задачи из разбора встречи, ${rights.teamName}`, `Создано задач: ${numbers.length}${numbers.length ? ` (${numbers.join(", ")})` : ""}, решений: ${made}`);
      return { numbers, decisions: made, already: false };
    },
    { timeout: 60_000 },
  );
  return { ...out, created: await createdTasks(out.numbers) };
}
