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
import { loadScope } from "@/lib/org/scope";

export type TaskActionResult = { ok: true; task: Task | null; number: number; undo?: string } | { ok: false; error: string };

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

function checkNumber(number: unknown): number {
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) throw new svc.TaskRuleError("Неверный номер задачи");
  return number;
}

async function run(fn: (a: svc.Actor) => Promise<svc.TaskResult>): Promise<TaskActionResult> {
  try {
    const r = await fn(await actor());
    return { ok: true, task: r.task, number: r.task.number, undo: r.undo };
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

export async function changeStateAction(number: number, next: StateCode, blockedBy?: string) {
  return run((a) => svc.changeState(a, checkNumber(number), next, blockedBy));
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

/** История задачи (матрица раздела 2): лидер видит историю своих задач, владелец и администраторы всю */
export async function taskHistoryAction(number: number): Promise<{ ok: true; items: HistoryItem[] } | { ok: false; error: string }> {
  const a = await actor();
  const task = await svc.getTask(checkNumber(number), { personId: a.personId, role: a.role });
  if (!task) return { ok: false, error: `Задачи ${number} нет` };
  if (task.archived && a.management !== "OWNER") return { ok: false, error: `Задача ${number} в архиве` };
  const scope = await loadScope(prisma, { id: a.personId, role: a.role });
  if (!canSeeTaskHistory(task, { slug: a.slug, management: a.management, observer: a.role === "OBSERVER", leads: scope.leads }))
    return { ok: false, error: "История видна участникам задачи, руководителю команды, владельцу и администраторам" };
  return { ok: true, items: await svc.taskHistory(task.number) };
}
