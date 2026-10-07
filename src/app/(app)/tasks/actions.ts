"use server";

// Действия с задачами из экранов. Права и правила проверяет сервис: экран лишь прячет то, что нельзя.

import { unstable_rethrow } from "next/navigation";
import { requestIp, requireContext } from "@/lib/auth";
import * as svc from "@/lib/tasks/service";
import { canSeeTaskHistory } from "@/lib/tasks/rules";
import type { EditInput, NewTaskInput } from "@/lib/tasks/service";
import type { PriorityCode, StateCode, StatusCode } from "@/domain/dictionaries";
import type { IsoDate } from "@/domain/dates";
import type { HistoryItem, Owner, PersonSlug, Task } from "@/domain/types";
import { prisma } from "@/lib/db";
import { loadScope, TOP_TEAM } from "@/lib/org/scope";
import { moveTask } from "@/lib/org/service";
import { taskStatusSpans, type StatusSpan } from "@/lib/tasks/changes";
import { blockOnPerson } from "@/lib/requests/service";

export type TaskActionResult = { ok: true; task: Task | null; number: number; undo?: string; warning?: string } | { ok: false; error: string };

async function actor(): Promise<svc.Actor> {
  const ctx = await requireContext();
  return {
    personId: ctx.person.id,
    slug: ctx.person.slug as PersonSlug,
    fullName: ctx.person.fullName,
    role: ctx.person.role,
    management: ctx.management?.role ?? null,
    ip: await requestIp(),
    via: ctx.via,
  };
}

/** Кто читает задачи: общий логин без режима управления видит только топ-команду (этап 14) */
function readerOf(a: svc.Actor): svc.TaskReader {
  return { personId: a.personId, role: a.role, limited: a.via === "TEAM" && !a.management };
}

function checkNumber(number: unknown): number {
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0 || number > 2_147_483_647) throw new svc.TaskRuleError("Неверный номер задачи");
  return number;
}

async function run(fn: (a: svc.Actor) => Promise<svc.TaskResult>): Promise<TaskActionResult> {
  try {
    const r = await fn(await actor());
    return { ok: true, task: r.task, number: r.task.number, undo: r.undo, ...(r.warning ? { warning: r.warning } : {}) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof svc.TaskRuleError) return { ok: false, error: error.message };
    console.error("Действие с задачей не прошло", error);
    return { ok: false, error: "Не получилось сохранить. Обновите страницу и попробуйте ещё раз" };
  }
}

export async function createTaskAction(input: NewTaskInput) {
  return run((a) => svc.createTask(a, input));
}

export async function changeStatusAction(number: number, next: StatusCode, note?: string) {
  return run((a) => svc.changeStatus(a, checkNumber(number), next, note));
}

export async function changeStateAction(number: number, next: StateCode, note?: string, waitTask?: number | null) {
  return run((a) => svc.changeState(a, checkNumber(number), next, note, { waitTask: waitTask === undefined || waitTask === null ? null : Number(waitTask) }));
}

/** «Заблокирована, ждёт человека» (этап 21): просьба человеку и состояние задачи разом */
export async function blockOnPersonAction(number: number, input: { to: string; text: string; due: IsoDate; note?: string | null }) {
  return run(async (a) => (await blockOnPerson(a, checkNumber(number), { to: String(input?.to ?? ""), text: String(input?.text ?? ""), due: String(input?.due ?? ""), note: input?.note ? String(input.note) : null })).task);
}

export async function addDependencyAction(number: number, blocker: number) {
  return run((a) => svc.addDependency(a, checkNumber(number), Number(blocker)));
}

export async function removeDependencyAction(number: number, blocker: number) {
  return run((a) => svc.removeDependency(a, checkNumber(number), Number(blocker)));
}

/** Передать задачу с комментарием (этап 21) */
export async function handOverAction(number: number, to: string, comment: string) {
  return run((a) => svc.handOver(a, checkNumber(number), String(to ?? "") as PersonSlug, String(comment ?? "")));
}

/** Связи задачи для карточки: что ждёт и кто ждёт её (этап 21) */
export async function taskLinksAction(number: number): Promise<{ ok: true; value: NonNullable<Awaited<ReturnType<typeof svc.taskLinks>>> } | { ok: false; error: string }> {
  try {
    const value = await svc.taskLinks(await actor(), checkNumber(number));
    if (!value) return { ok: false, error: `Задачи ${number} нет` };
    return { ok: true, value };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof svc.TaskRuleError) return { ok: false, error: error.message };
    console.error("Связи задачи не загрузились", error);
    return { ok: false, error: "Не загрузилось. Обновите страницу" };
  }
}

export async function changePriorityAction(number: number, next: PriorityCode) {
  return run((a) => svc.changePriority(a, checkNumber(number), next));
}

export async function updateWhereAction(number: number, text: string) {
  return run((a) => svc.updateWhere(a, checkNumber(number), text));
}

export async function transferDueAction(number: number, to: IsoDate, reason: string) {
  return run((a) => svc.transferDue(a, checkNumber(number), to, reason));
}

export async function editTaskAction(number: number, input: EditInput) {
  return run((a) => svc.editTask(a, checkNumber(number), input));
}

export async function assignOwnerAction(number: number, owner: Owner) {
  return run((a) => svc.assignOwner(a, checkNumber(number), owner));
}

export async function setCoExecutorsAction(number: number, slugs: PersonSlug[]) {
  return run((a) => svc.setCoExecutors(a, checkNumber(number), Array.isArray(slugs) ? slugs : []));
}

export async function addLinkAction(number: number, link: { title?: string; url: string }) {
  return run((a) => svc.addLink(a, checkNumber(number), link));
}

export async function removeLinkAction(number: number, linkId: string) {
  return run((a) => svc.removeLink(a, checkNumber(number), String(linkId)));
}

export async function archiveTaskAction(number: number, archived: boolean) {
  return run((a) => svc.archiveTask(a, checkNumber(number), archived));
}

export async function addCommentAction(number: number, text: string) {
  return run((a) => svc.addComment(a, checkNumber(number), text));
}

/** Правка и удаление своего комментария, реакции на комментарий (этап 20) */
export async function editCommentAction(number: number, commentId: string, text: string) {
  return run((a) => svc.editComment(a, checkNumber(number), String(commentId), String(text ?? "")));
}

export async function deleteCommentAction(number: number, commentId: string) {
  return run((a) => svc.deleteComment(a, checkNumber(number), String(commentId)));
}

export async function reactCommentAction(number: number, commentId: string, kind: string, question?: string | null) {
  return run((a) => svc.reactToComment(a, checkNumber(number), String(commentId), kind, question == null ? null : String(question)));
}

export async function undoAction(token: string): Promise<TaskActionResult> {
  try {
    const r = await svc.undoChange(await actor(), String(token));
    return { ok: true, task: r.task, number: r.number };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof svc.TaskRuleError) return { ok: false, error: error.message };
    console.error("Отмена не прошла", error);
    return { ok: false, error: "Не получилось отменить" };
  }
}

/** Задача целиком: карточка дозагружает её, если в списке она пришла без комментариев (этап 14) */
export async function getTaskAction(number: number): Promise<TaskActionResult> {
  const a = await actor();
  const task = await svc.getTask(checkNumber(number), readerOf(a));
  if (!task || (task.archived && a.management !== "OWNER")) return { ok: false, error: `Задачи ${number} нет` };
  return { ok: true, task, number };
}

/** Перенести задачу в другую команду (этап 14): режим управления или руководитель обеих команд */
export async function moveTaskAction(number: number, team: string): Promise<TaskActionResult> {
  try {
    const a = await actor();
    await moveTask(a, checkNumber(number), String(team ?? ""));
    const task = await svc.getTask(number, readerOf(a));
    return { ok: true, task, number };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof svc.TaskRuleError) return { ok: false, error: error.message };
    console.error("Перенос задачи в другую команду не прошёл", error);
    return { ok: false, error: "Не получилось перенести. Обновите страницу и попробуйте ещё раз" };
  }
}

/** История задачи (матрица раздела 2): лидер видит историю своих задач, владелец и администраторы всю */
export async function taskHistoryAction(number: number): Promise<{ ok: true; items: HistoryItem[] } | { ok: false; error: string }> {
  const a = await actor();
  const task = await svc.getTask(checkNumber(number), readerOf(a));
  if (!task) return { ok: false, error: `Задачи ${number} нет` };
  if (task.archived && a.management !== "OWNER") return { ok: false, error: `Задача ${number} в архиве` };
  const scope = await loadScope(prisma, { id: a.personId, role: a.role, limited: readerOf(a).limited });
  const people = (await prisma.person.findMany({ where: { id: { in: scope.leadPeople } }, select: { slug: true } })).map((p) => p.slug as PersonSlug);
  if (!canSeeTaskHistory(task, { slug: a.slug, management: a.management, observer: a.role === "OBSERVER", leads: scope.leads, people }))
    return { ok: false, error: "История видна участникам задачи, руководителю команды и руководителю ответственного, владельцу и администраторам" };
  return { ok: true, items: await svc.taskHistory(task.number) };
}

// ---------- Задачи команд (этап 16) ----------

export type TaskExtras = { watching: boolean; canAsk: boolean; spans: StatusSpan[] };

/** Для карточки: подписка, можно ли попросить обновить, сколько дней задача была в каждом статусе */
export async function taskExtrasAction(number: number): Promise<{ ok: true; extras: TaskExtras } | { ok: false; error: string }> {
  try {
    const a = await actor();
    const n = checkNumber(number);
    const task = await svc.getTask(n, readerOf(a));
    if (!task) return { ok: false, error: `Задачи ${n} нет` };
    if (task.archived && a.management !== "OWNER") return { ok: false, error: `Задача ${n} в архиве` };
    const scope = await loadScope(prisma, { id: a.personId, role: a.role, limited: readerOf(a).limited });
    const people = (await prisma.person.findMany({ where: { id: { in: scope.leadPeople } }, select: { slug: true } })).map((p) => p.slug as PersonSlug);
    // История статусов видна тем же, кому видна история задачи
    const history = canSeeTaskHistory(task, { slug: a.slug, management: a.management, observer: a.role === "OBSERVER", leads: scope.leads, people });
    const [watch, owner, spans] = await Promise.all([
      prisma.taskWatch.findFirst({ where: { personId: a.personId, task: { number: n } } }),
      task.owner !== "all" ? prisma.person.findUnique({ where: { slug: task.owner }, select: { id: true } }) : Promise.resolve(null),
      history ? taskStatusSpans(n) : Promise.resolve([]),
    ]);
    const open = (task.status === "in-progress" || task.status === "clarify") && !task.archived;
    const canAsk =
      a.role !== "OBSERVER" && open && !!owner && owner.id !== a.personId && (!!a.management || scope.leads.includes(task.team) || (task.team !== TOP_TEAM && scope.leadPeople.includes(owner.id)));
    return { ok: true, extras: { watching: !!watch, canAsk, spans } };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof svc.TaskRuleError) return { ok: false, error: error.message };
    console.error("Карточка задачи: подписка и история статусов не загрузились", error);
    return { ok: false, error: "Не загрузилось. Обновите страницу" };
  }
}

async function simple<T>(fn: (a: svc.Actor) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn(await actor()) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof svc.TaskRuleError) return { ok: false, error: error.message };
    console.error("Действие с задачей не прошло", error);
    return { ok: false, error: "Не получилось сохранить. Обновите страницу и попробуйте ещё раз" };
  }
}

export async function watchTaskAction(number: number, on: boolean) {
  return simple((a) => svc.watchTask(a, checkNumber(number), !!on));
}

export async function requestUpdateAction(number: number) {
  return simple((a) => svc.requestUpdate(a, checkNumber(number)));
}
