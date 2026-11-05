// Комментарии к отправленному отчёту руководителю (этап 73+81). Решение Арама 01.11: «У полученного отчёта руководитель
// может оставить комментарий».
//
// - Комментарий пишет получатель: к отчёту целиком или к строке блока отправленной версии.
// - Ответить в ветке могут отправитель, нынешний руководитель команды как преемник и получатель.
// - Видят переписку только отправитель, преемник, получатель и владельцы в режиме управления. Участники команды нет: это разговор
//   руководителя с его руководителем.
// - Только при личном входе: по общему логину профиль выбирают сами, чужую переписку по нему не открыть.
// - Вторая сторона получает событие «Мне» (REPORT_COMMENT), каждый комментарий пишется в журнал.
// - Цитата строки хранится навсегда, но отдаётся не всем: на чтении она разрешается заново по блокам самого читателя,
//   поэтому строка с цифрами, закрытыми для него уровнем доступа (этап 57), не покажется ему и в цитате. Отчёт идёт
//   вверх, и цитата не должна возвращать цифры вниз тому, кому они закрыты.

import { prisma } from "@/lib/db";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate } from "@/lib/tasks/dates";
import { notify, quote } from "@/lib/inbox/notify";
import { auditVia } from "@/lib/audit";
import { isWeekKey, weekNumberOf } from "@/lib/weekly/weeks";
import { isFiguresPlaceholder } from "@/lib/weekly-blocks/types";
import { sentReport, rolesOf, type SentReport } from "./reports";
import { REPORT_COMMENT_MAX, canReplyComment, canStartComment, cleanCommentText, commentSubject, findLine, seesComments } from "./rules";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export type ReportReply = { id: string; author: string; mine: boolean; at: string; text: string };

/** Ветка комментариев: замечание получателя и ответы под ним */
export type ReportComment = ReportReply & {
  /** Комментарий к строке блока: ключ блока */
  blockKey: string | null;
  /**
   * Цитата строки — только если эта строка есть в отчёте у самого читателя. Цитата хранится в базе навсегда, но
   * отдаётся не всем: строку с цифрами, которую читателю закрыл уровень доступа (этап 57), он не увидит и в цитате.
   * null: цитату не показываем, экран пишет нейтральное «комментарий к строке блока «…»»
   */
  lineText: string | null;
  /** Название блока строки по версии читателя: подпись, когда цитаты нет */
  blockTitle: string | null;
  /** Строка есть в версии читателя. false: её убрали при повторной отправке или она ему закрыта */
  linePresent: boolean;
  replies: ReportReply[];
};

/** Что экран может делать с перепиской этого отчёта */
export type ReportCommentAccess = { sees: boolean; canStart: boolean; canReply: boolean };

export type ReportCommentsView = { access: ReportCommentAccess; comments: ReportComment[] };

export const EMPTY_COMMENTS: ReportCommentsView = { access: { sees: false, canStart: false, canReply: false }, comments: [] };

/**
 * Один и тот же отказ и когда отчёта нет, и когда человек не участник обсуждения: иначе перебором команд и недель
 * узнавали бы, за какие недели какая команда отправляла отчёт
 */
const NO_COMMENT = "Обсуждение этого отчёта вам недоступно: комментарий оставляет тот, кому отчёт отправили, ответить могут он и автор отчёта";

export const accessOf = (actor: Actor, report: SentReport): ReportCommentAccess => {
  const roles = rolesOf(actor, report);
  return { sees: seesComments(roles), canStart: canStartComment(roles), canReply: canReplyComment(roles) };
};

/** Переписка по отчёту для экрана. Зритель не автор, не получатель и не владелец: пусто */
export async function reportComments(actor: Actor, report: SentReport): Promise<ReportCommentsView> {
  const access = accessOf(actor, report);
  if (!access.sees) return EMPTY_COMMENTS;
  const week = await prisma.week.findUnique({ where: { start: dbDate(report.week) }, select: { id: true } });
  if (!week) return { access, comments: [] };
  const rows = await prisma.leaderReportComment.findMany({
    where: { teamId: report.teamId, weekId: week.id },
    include: { author: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
  });
  const mine = (id: string) => id === actor.personId;
  const replies = rows.filter((r) => r.parentId);
  return {
    access,
    comments: rows
      .filter((r) => !r.parentId)
      .map((r) => {
        // Цитату разрешаем заново по блокам самого читателя: строку, которой он в отчёте не видит, не возвращаем
        const present = !r.blockKey || !r.lineText ? true : findLine(report.blocks, r.blockKey, r.lineText, r.lineIndex) >= 0;
        return {
          id: r.id,
          author: r.author.fullName,
          mine: mine(r.authorId),
          at: r.createdAt.toISOString(),
          text: r.text,
          blockKey: r.blockKey,
          lineText: present ? r.lineText : null,
          blockTitle: r.blockKey ? (report.blocks.find((b) => b.key === r.blockKey)?.title ?? null) : null,
          linePresent: present,
          replies: replies
            .filter((x) => x.parentId === r.id)
            .map((x) => ({ id: x.id, author: x.author.fullName, mine: mine(x.authorId), at: x.createdAt.toISOString(), text: x.text })),
        };
      }),
  };
}

export type AddCommentInput = {
  teamId: string;
  week: string;
  /** Ответ в ветке: id первого комментария ветки */
  parentId?: string | null;
  /** Комментарий к строке блока: ключ блока и номер строки в отправленной версии */
  blockKey?: string | null;
  lineIndex?: number | null;
};

/**
 * Написать комментарий к отправленному отчёту. Права проверяются здесь, на сервере, а не только в интерфейсе: экран
 * прячет форму, но отказ даёт сервер. Строка берётся из отправленной версии на сервере: текст строки с экрана не
 * принимаем, иначе в журнал попало бы что угодно
 */
export async function addReportComment(actor: Actor, input: AddCommentInput, text: unknown, now = new Date()): Promise<ReportCommentsView> {
  // Наблюдатель в ресурсе ничего не пишет, как и в остальных действиях weekly. В получатели он попасть может:
  // руководителя берут по структуре, роль там не проверяется
  if (actor.role === "OBSERVER") fail("Наблюдатель отчёты не комментирует");
  if (actor.via === "TEAM") fail("Комментарий к отчёту пишут при личном входе: так видно, кто его написал");
  const key = String(input.week ?? "");
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  const parentId = input.parentId ? String(input.parentId) : null;
  const found = await sentReport(actor, String(input.teamId ?? ""), key as WeekKey);
  // Отказ один и тот же, есть отчёт или нет: иначе перебором узнавали бы, какая команда за какую неделю отправляла
  const access = found ? accessOf(actor, found) : EMPTY_COMMENTS.access;
  if (!(parentId ? access.canReply : access.canStart)) fail(NO_COMMENT);
  const report = found!;
  const week = await prisma.week.findUnique({ where: { start: dbDate(key as WeekKey) }, select: { id: true } });
  if (!week) fail(NO_COMMENT);
  const weekId = week!.id;
  const value = cleanCommentText(text);
  if (!value) fail("Напишите комментарий");
  if (value.length > REPORT_COMMENT_MAX) fail(`Комментарий длиннее ${REPORT_COMMENT_MAX} знаков: сократите`);
  const parent = parentId
    ? await prisma.leaderReportComment.findFirst({ where: { id: parentId, teamId: report.teamId, weekId, parentId: null }, select: { id: true, authorId: true } })
    : null;
  if (parentId && !parent) fail("Комментарий уже убрали: обновите страницу");
  // Строка отчёта: только из отправленной версии, и только у начала ветки
  let line: { blockKey: string; lineIndex: number; lineText: string } | null = null;
  if (!parentId && input.blockKey) {
    const blockKey = String(input.blockKey);
    const block = report.blocks.find((b) => b.key === blockKey);
    const index = typeof input.lineIndex === "number" ? input.lineIndex : -1;
    const row = block?.lines[index];
    if (!row) fail("Этой строки в отправленном отчёте нет: обновите страницу");
    // Строка-пометка вместо закрытых цифр это не строка отчёта: комментарий к ней ничего не значит ни автору, ни журналу
    if (isFiguresPlaceholder(row!)) fail("Это не строка отчёта, а пометка о закрытых цифрах: напишите комментарий к отчёту целиком или к другой строке");
    line = { blockKey, lineIndex: index, lineText: row!.text };
  }
  const authors = [report.leaderId, report.sentById].filter((id): id is string => !!id);
  const recipients = report.to.map((t) => t.id);
  // Событие второй стороне: получатель написал - автору в «Отправленные», автор ответил - получателю в «Полученные».
  // Владелец в режиме управления переписку только читает (canReplyComment), писать сюда он не доходит
  const toAuthors = !authors.includes(actor.personId);
  const side = toAuthors ? "sent" : "received";
  const people = toAuthors ? authors : recipients;
  const number = weekNumberOf(key as WeekKey);
  await prisma.$transaction(async (tx) => {
    await tx.leaderReportComment.create({
      data: {
        teamId: report.teamId,
        weekId,
        authorId: actor.personId,
        parentId: parent?.id ?? null,
        blockKey: line?.blockKey ?? null,
        lineIndex: line?.lineIndex ?? null,
        lineText: line?.lineText ?? null,
        text: value,
      },
    });
    await notify(
      tx,
      {
        kind: "REPORT_COMMENT",
        recipients: [...new Set([...people, ...(parent ? [parent.authorId] : [])])],
        actor,
        subject: commentSubject(side, report.teamId, key),
        text: `${actor.fullName} ${parentId ? "ответил в обсуждении отчёта" : "написал к отчёту"} команды «${report.teamName}» за неделю ${number}: ${quote(value)}`,
      },
      now,
    );
    await tx.auditLog.create({
      data: {
        action: "weekly.report.comment",
        actorId: actor.personId,
        actorName: actor.fullName,
        source: "APP",
        entity: "leader-report",
        entityId: `${report.teamId}/${key}`,
        field: `${parentId ? "Ответ в обсуждении" : "Комментарий"} к отчёту команды «${report.teamName}», неделя ${number}${line ? `, строка «${line.lineText}»` : ""}`,
        after: value,
        ip: actor.ip ?? null,
        ...auditVia(actor),
      },
    });
  });
  return reportComments(actor, report);
}
