// Обсуждение записей weekly (этап 20): короткая ветка комментариев под записью, реакции, вопросы к встрече.
//
// Правила:
// - комментирует и реагирует тот, кто видит запись (как в ленте его команд), наблюдатель только читает;
// - автор записи получает в «Мне» каждый комментарий и реакцию, подписчики записи (кто уже писал в ветке или кого
//   упомянули) получают комментарии. Упомянутый получает упоминание вместо комментария;
// - свой комментарий правят 15 минут, удаляет автор или режим управления, текст остаётся в журнале;
// - «Обсудить на встрече» с вопросом ставит пункт в повестку встречи команды, «обсуждено» снимает его.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import type { Comment, PersonSlug, ReactionView, WeekKey, WeeklyEntry } from "@/domain/types";
import { entrySubject, notify, quote } from "@/lib/inbox/notify";
import { loadTeamNodes, loadScope, type Scope, type TeamNode } from "@/lib/org/scope";
import { isoFromDbDate, dbDate } from "@/lib/tasks/dates";
import { shiftWeek } from "@/lib/weekly/weeks";
import { DISCUSS_LIMITS, REACTION_LABEL, commentDto, editable, mentionsIn, namesOf, reactionDto, reactionInclude } from "./common";
import { entryReaders, seesEntry } from "./access";
import { seesTask } from "@/lib/tasks/watch";
import { getEntry } from "@/lib/weekly/service";
import { applyReaction } from "./reactions";
import { CLOSED_DB } from "@/lib/tasks/codes";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/[—–]/g, "-").trim();
}

function commentText(text: string): string {
  const value = clean(text);
  if (!value) fail("Напишите комментарий");
  if (value.length > DISCUSS_LIMITS.comment) fail(`Комментарий: не длиннее ${DISCUSS_LIMITS.comment} знаков`);
  return value;
}

const accessInclude = { promotions: { select: { byId: true } } } satisfies Prisma.WeeklyEntryInclude;
type EntryAccessRow = Prisma.WeeklyEntryGetPayload<{ include: typeof accessInclude }>;

const accessOf = (e: EntryAccessRow) => ({ authorId: e.authorId, ceo: e.ceo, promotedBy: e.promotions.map((p) => p.byId) });

/** Общий логин без режима управления видит только топ-команду (этап 14) */
function subjectOf(actor: Actor) {
  return { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management };
}

/** Запись, если человек её видит. Чужую запись не подтверждаем даже по id */
async function visibleEntry(tx: Tx | typeof prisma, actor: Actor, entryId: string): Promise<{ entry: EntryAccessRow; scope: Scope; nodes: TeamNode[] }> {
  const entry = await tx.weeklyEntry.findUnique({ where: { id: String(entryId) }, include: accessInclude });
  if (!entry) return fail("Записи нет: её удалили");
  const nodes = await loadTeamNodes(tx);
  const scope = await loadScope(tx, subjectOf(actor));
  if (!seesEntry(scope, nodes, accessOf(entry), actor.personId)) fail("Записи нет: её удалили");
  return { entry, scope, nodes };
}

function canWrite(actor: Actor) {
  if (actor.role === "OBSERVER") fail("Наблюдатель только читает");
}

export type CommentResult = { comment: Comment | null; warning?: string };

async function warningFor(tx: Tx, mentioned: string[], reach: string[]): Promise<{ warning?: string }> {
  const lost = mentioned.filter((id) => !reach.includes(id));
  if (!lost.length) return {};
  const names = await namesOf(tx, lost);
  return { warning: `Упоминание не дошло: ${names.join(", ")} ${names.length > 1 ? "не видят" : "не видит"} эту запись` };
}

const commentInclude = { author: { select: { slug: true } }, reactions: { include: reactionInclude, orderBy: { createdAt: "asc" as const } } } satisfies Prisma.EntryCommentInclude;

/** Комментарий к записи weekly */
export async function addEntryComment(actor: Actor, entryId: string, text: string): Promise<CommentResult> {
  canWrite(actor);
  const value = commentText(text);
  return prisma.$transaction(async (tx) => {
    const { entry } = await visibleEntry(tx, actor, entryId);
    const access = accessOf(entry);
    const mentioned = await mentionsIn(tx, [value], actor.personId);
    const reach = mentioned.length ? await entryReaders(tx, access, mentioned) : [];
    const comment = await tx.entryComment.create({ data: { entryId: entry.id, authorId: actor.personId, text: value, mentions: reach }, include: commentInclude });
    // Кто написал в ветке или кого упомянули, дальше получает комментарии к записи
    await tx.entryWatch.createMany({
      data: [actor.personId, ...reach].filter((id) => id !== entry.authorId).map((personId) => ({ entryId: entry.id, personId })),
      skipDuplicates: true,
    });
    const subject = entrySubject(entry.id);
    if (reach.length) {
      await notify(tx, {
        kind: "MENTION",
        recipients: reach,
        actor,
        subject,
        entryId: entry.id,
        entryCommentId: comment.id,
        text: `Упоминание в обсуждении записи: «${quote(value)}»`,
      });
    }
    const watchers = (await tx.entryWatch.findMany({ where: { entryId: entry.id }, select: { personId: true } })).map((w) => w.personId);
    const audience = [entry.authorId, ...watchers].filter((id): id is string => !!id && id !== actor.personId && !reach.includes(id));
    const readers = audience.length ? await entryReaders(tx, access, audience) : [];
    await notify(tx, {
      kind: "ENTRY_COMMENT",
      recipients: readers,
      actor,
      subject,
      entryId: entry.id,
      entryCommentId: comment.id,
      text: `Комментарий к записи «${quote(entry.what)}»: «${quote(value)}»`,
    });
    await audit(tx, actor, "weekly.comment", entry.id, "Комментарий к записи", null, value);
    return { comment: commentDto(comment), ...(await warningFor(tx, mentioned, reach)) };
  });
}

async function ownComment(tx: Tx, actor: Actor, commentId: string) {
  const comment = await tx.entryComment.findUnique({ where: { id: String(commentId) } });
  if (!comment) return fail("Комментарий уже удалён");
  const found = await visibleEntry(tx, actor, comment.entryId);
  return { comment, ...found };
}

/** Свой комментарий правят 15 минут: пометка «изменено», в журнале было и стало */
export async function editEntryComment(actor: Actor, commentId: string, text: string, now = new Date()): Promise<CommentResult> {
  canWrite(actor);
  const value = commentText(text);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "entry_comments" WHERE id = ${String(commentId)} FOR UPDATE`;
    const { comment, entry } = await ownComment(tx, actor, commentId);
    if (comment.authorId !== actor.personId) fail("Править можно только свой комментарий");
    if (!editable(comment.at, now)) fail("Комментарий правят 15 минут после отправки. Напишите новый");
    const mentioned = (await mentionsIn(tx, [value], actor.personId)).filter((id) => !comment.mentions.includes(id));
    const reach = mentioned.length ? await entryReaders(tx, accessOf(entry), mentioned) : [];
    if (comment.text !== value) {
      await tx.entryComment.update({ where: { id: comment.id }, data: { text: value, editedAt: now, mentions: [...comment.mentions, ...reach] } });
      if (reach.length) {
        await tx.entryWatch.createMany({ data: reach.filter((id) => id !== entry.authorId).map((personId) => ({ entryId: entry.id, personId })), skipDuplicates: true });
        await notify(tx, {
          kind: "MENTION",
          recipients: reach,
          actor,
          subject: entrySubject(entry.id),
          entryId: entry.id,
          entryCommentId: comment.id,
          text: `Упоминание в обсуждении записи: «${quote(value)}»`,
        });
      }
      await audit(tx, actor, "weekly.comment.edit", entry.id, "Комментарий к записи изменён", comment.text, value);
    }
    const saved = await tx.entryComment.findUniqueOrThrow({ where: { id: comment.id }, include: commentInclude });
    return { comment: commentDto(saved), ...(await warningFor(tx, mentioned, reach)) };
  });
}

/** Удалить комментарий: свой или любой в режиме управления. Текст остаётся в журнале */
export async function deleteEntryComment(actor: Actor, commentId: string): Promise<CommentResult> {
  return prisma.$transaction(async (tx) => {
    const { comment, entry } = await ownComment(tx, actor, commentId);
    if (comment.authorId !== actor.personId && !actor.management) fail("Удалить можно только свой комментарий");
    await tx.entryComment.delete({ where: { id: comment.id } });
    await audit(tx, actor, "weekly.comment.delete", entry.id, "Комментарий к записи удалён", comment.text, null);
    return { comment: null };
  });
}

export type ReactionResult = { reactions: ReactionView[]; on: boolean };

/**
 * Реакция на запись или на комментарий к ней. Автор записи или комментария видит её в «Мне».
 * «Обсудить на встрече» требует вопрос. Строка записи блокируется: два нажатия из разных вкладок не спорят.
 * Сняли реакцию: событие о ней уходит вместе с ней (связь в базе)
 */
export async function reactToEntry(actor: Actor, target: { entryId: string } | { entryCommentId: string }, kind: unknown, question?: string | null): Promise<ReactionResult> {
  canWrite(actor);
  return prisma.$transaction(async (tx) => {
    let entry: EntryAccessRow;
    let authorId: string | null;
    let commentId: string | null = null;
    if ("entryCommentId" in target) {
      const comment = await tx.entryComment.findUnique({ where: { id: String(target.entryCommentId) } });
      if (!comment) return fail("Комментарий уже удалён");
      await tx.$queryRaw`SELECT id FROM "weekly_entries" WHERE id = ${comment.entryId} FOR UPDATE`;
      ({ entry } = await visibleEntry(tx, actor, comment.entryId));
      if (!(await tx.entryComment.findUnique({ where: { id: comment.id }, select: { id: true } }))) return fail("Комментарий уже удалён");
      authorId = comment.authorId;
      commentId = comment.id;
    } else {
      await tx.$queryRaw`SELECT id FROM "weekly_entries" WHERE id = ${String(target.entryId)} FOR UPDATE`;
      ({ entry } = await visibleEntry(tx, actor, target.entryId));
      authorId = entry.authorId;
    }
    const change = await applyReaction(tx, actor, commentId ? { entryCommentId: commentId } : { entryId: entry.id }, kind, question);
    if (change.kind === "discuss") {
      await audit(
        tx,
        actor,
        "weekly.discuss",
        entry.id,
        change.on ? "Обсудить на встрече" : "Обсудить на встрече снято",
        change.was?.question ?? null,
        change.on ? change.question : null,
      );
    }
    if (change.on && authorId) {
      const [reader] = await entryReaders(tx, accessOf(entry), [authorId]);
      if (reader) {
        await notify(tx, {
          kind: "REACTION",
          recipients: [reader],
          actor,
          subject: entrySubject(entry.id),
          entryId: entry.id,
          entryCommentId: commentId,
          reactionId: change.id,
          text: change.question
            ? `${REACTION_LABEL[change.kind]}: «${quote(change.question)}»`
            : `«${REACTION_LABEL[change.kind]}» к ${commentId ? "вашему комментарию к записи" : "вашей записи"} «${quote(entry.what)}»`,
        });
      }
    }
    const rows = await tx.reaction.findMany({ where: commentId ? { entryCommentId: commentId } : { entryId: entry.id }, include: reactionInclude, orderBy: { createdAt: "asc" } });
    return { reactions: rows.map(reactionDto), on: change.on };
  });
}

/**
 * «Обсуждено»: пункт уходит из повестки. Отмечает ведущий встречи (режим управления), руководитель автора записи
 * или ответственного по задаче и сам автор вопроса. Тот, о чьей работе вопрос, снять его не может
 */
export async function setDiscussed(actor: Actor, reactionId: string, discussed: boolean, now = new Date()): Promise<{ discussed: boolean }> {
  canWrite(actor);
  return prisma.$transaction(async (tx) => {
    const r = await tx.reaction.findUnique({
      where: { id: String(reactionId) },
      include: {
        entry: { include: accessInclude },
        entryComment: { include: { entry: { include: accessInclude } } },
        taskComment: { include: { task: { include: { coExecutors: true } } } },
      },
    });
    if (!r || r.kind !== "DISCUSS") return fail("Вопроса уже нет");
    const scope = await loadScope(tx, subjectOf(actor));
    const entry = r.entry ?? r.entryComment?.entry ?? null;
    let ownerOfSubject: string | null;
    if (entry) {
      const nodes = await loadTeamNodes(tx);
      if (!seesEntry(scope, nodes, accessOf(entry), actor.personId)) fail("Вопроса уже нет");
      ownerOfSubject = entry.authorId;
    } else {
      const task = r.taskComment!.task;
      if (task.archivedAt && actor.role !== "OWNER") fail("Вопроса уже нет");
      if (!seesTask(scope, task, actor.personId)) fail("Вопроса уже нет");
      ownerOfSubject = task.ownerId;
    }
    const allowed = !!actor.management || r.personId === actor.personId || (!!ownerOfSubject && ownerOfSubject !== actor.personId && scope.leadPeople.includes(ownerOfSubject));
    if (!allowed) fail("Отметить «обсуждено» может ведущий встречи, руководитель или автор вопроса");
    if ((r.discussedAt !== null) === discussed) return { discussed };
    await tx.reaction.update({ where: { id: r.id }, data: discussed ? { discussedAt: now, discussedById: actor.personId } : { discussedAt: null, discussedById: null } });
    if (entry) await audit(tx, actor, "weekly.discuss", entry.id, discussed ? "Вопрос обсуждён" : "Вопрос снова в повестке", null, r.question);
    else {
      await tx.auditLog.create({
        data: {
          action: "task.discuss",
          actorId: actor.personId,
          actorName: actor.fullName,
          source: "APP",
          entity: "task",
          entityId: String(r.taskComment!.task.number),
          field: discussed ? "Вопрос обсуждён" : "Вопрос снова в повестке",
          after: r.question ?? undefined,
          ip: actor.ip ?? null,
          via: actor.via ?? null,
        },
      });
    }
    return { discussed };
  });
}

async function audit(tx: Tx, actor: Actor, action: string, entryId: string, field: string, before: string | null, after: string | null) {
  await tx.auditLog.create({
    data: {
      action,
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP",
      entity: "weekly-entry",
      entityId: entryId,
      field,
      before: before ?? undefined,
      after: after ?? undefined,
      ip: actor.ip ?? null,
      via: actor.via ?? null,
    },
  });
}

// ---------- Чтение ----------

/** Вопрос к встрече: что спросили, кто, к какой записи или задаче */
export type MeetingQuestion = {
  id: string;
  question: string;
  by: PersonSlug;
  discussed: boolean;
  /** Неделя записи, если вопрос пришёл с прошлой недели и ещё не обсуждён */
  week: WeekKey | null;
  entry: { id: string; what: string; author: PersonSlug | null } | null;
  task: { number: number; title: string } | null;
};

/**
 * Повестка: вопросы «Обсудить на встрече» к записям показанной ленты за неделю и необсуждённые за три недели до неё,
 * и к комментариям задач показанных команд. Видно только то, что человек видит и так
 */
export async function meetingQuestions(actor: Actor, key: WeekKey, entryIds: { current: string[] }, teamIds: string[]): Promise<MeetingQuestion[]> {
  const from = shiftWeek(key, -3);
  const scope = await loadScope(prisma, subjectOf(actor));
  const nodes = await loadTeamNodes(prisma);
  const include = {
    person: { select: { slug: true } },
    entry: { include: { ...accessInclude, author: { select: { slug: true } }, week: { select: { start: true } } } },
    entryComment: { include: { entry: { include: { ...accessInclude, author: { select: { slug: true } }, week: { select: { start: true } } } } } },
    taskComment: { include: { task: { include: { coExecutors: true } } } },
  } satisfies Prisma.ReactionInclude;
  const past = { gte: dbDate(from), lt: dbDate(key) };
  // Записи и задачи отдельно: старые вопросы к задачам не вытесняют вопросы этой недели
  const [entryRows, taskRows] = await Promise.all([
    prisma.reaction.findMany({
      where: {
        kind: "DISCUSS",
        OR: [
          { entryId: { in: entryIds.current } },
          { entryComment: { entryId: { in: entryIds.current } } },
          { discussedAt: null, entry: { week: { start: past } } },
          { discussedAt: null, entryComment: { entry: { week: { start: past } } } },
        ],
      },
      include,
      orderBy: { createdAt: "asc" },
      take: 300,
    }),
    // Вопросы к задачам показанных команд: открытые задачи, вопрос за последние 8 недель, свежие первыми
    teamIds.length
      ? prisma.reaction.findMany({
          where: {
            kind: "DISCUSS",
            createdAt: { gte: dbDate(shiftWeek(key, -8)) },
            taskComment: { task: { teamId: { in: teamIds }, archivedAt: null, status: { notIn: CLOSED_DB } } },
            OR: [{ discussedAt: null }, { createdAt: { gte: dbDate(key) } }],
          },
          include,
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : Promise.resolve([]),
  ]);
  const rows = [...entryRows, ...taskRows.reverse()];
  const out: MeetingQuestion[] = [];
  for (const r of rows) {
    const entry = r.entry ?? r.entryComment?.entry ?? null;
    if (entry) {
      // Прошлые недели: только записи, которые человек видит
      if (!seesEntry(scope, nodes, accessOf(entry), actor.personId)) continue;
      const week = isoFromDbDate(entry.week.start);
      out.push({
        id: r.id,
        question: r.question ?? "",
        by: r.person.slug as PersonSlug,
        discussed: r.discussedAt !== null,
        week: week === key ? null : week,
        entry: { id: entry.id, what: entry.what, author: (entry.author?.slug as PersonSlug | undefined) ?? null },
        task: null,
      });
    } else if (r.taskComment) {
      const task = r.taskComment.task;
      if (!seesTask(scope, task, actor.personId)) continue;
      out.push({
        id: r.id,
        question: r.question ?? "",
        by: r.person.slug as PersonSlug,
        discussed: r.discussedAt !== null,
        week: null,
        entry: null,
        task: { number: task.number, title: task.title },
      });
    }
  }
  // Необсуждённые сверху, внутри по времени вопроса
  return out.sort((a, b) => Number(a.discussed) - Number(b.discussed));
}

/** Запись с обсуждением для отдельной страницы: на неё ведут «Мне» и письма. null: записи нет или она не видна */
export async function entryForPage(actor: Actor, entryId: string): Promise<WeeklyEntry | null> {
  try {
    await visibleEntry(prisma, actor, entryId);
  } catch (error) {
    if (error instanceof TaskRuleError) return null;
    throw error;
  }
  return getEntry(entryId);
}
