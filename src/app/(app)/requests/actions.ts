"use server";

// Просьбы коллегам (этап 21): создать, ответить, напомнить, отозвать, сделать задачей.

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-runner";
import {
  acceptRequest,
  completeRequest,
  createRequest,
  declineRequest,
  remindRequest,
  requestToTask,
  requestsForTask,
  withdrawRequest,
  type NewRequestInput,
} from "@/lib/requests/service";

const num = (n: unknown) => Number(n);

function refreshed<R extends { ok: boolean }>(r: R): R {
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function createRequestAction(input: NewRequestInput) {
  const clean: NewRequestInput = {
    to: String(input?.to ?? ""),
    text: String(input?.text ?? ""),
    due: String(input?.due ?? ""),
    task: input?.task === undefined || input?.task === null ? null : num(input.task),
    entry: input?.entry ? String(input.entry) : null,
  };
  return refreshed(await runAction("Просьба коллеге", (a) => createRequest(a, clean)));
}

export async function acceptRequestAction(number: number, due: string) {
  return refreshed(await runAction("Принять просьбу", (a) => acceptRequest(a, num(number), String(due ?? ""))));
}

export async function declineRequestAction(number: number, reason: string) {
  return refreshed(await runAction("Отклонить просьбу", (a) => declineRequest(a, num(number), String(reason ?? ""))));
}

export async function completeRequestAction(number: number, note: string | null) {
  return refreshed(await runAction("Просьба выполнена", (a) => completeRequest(a, num(number), note === null ? null : String(note ?? ""))));
}

export async function withdrawRequestAction(number: number) {
  return refreshed(await runAction("Отозвать просьбу", (a) => withdrawRequest(a, num(number))));
}

export async function remindRequestAction(number: number) {
  return refreshed(await runAction("Напомнить о просьбе", (a) => remindRequest(a, num(number))));
}

export async function requestToTaskAction(number: number, direction: string | null) {
  return refreshed(await runAction("Сделать задачей", (a) => requestToTask(a, num(number), direction ? String(direction) : null)));
}

/** Просьбы по задаче для карточки: грузятся при открытии */
export async function taskRequestsAction(taskNumber: number) {
  return runAction("Просьбы по задаче", (a) => requestsForTask(a, num(taskNumber)));
}
