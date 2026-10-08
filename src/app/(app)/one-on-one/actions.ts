"use server";

// Встречи один на один (этап 28): темы, итоги, встреча, заметки, задача из темы. Права проверяет сервис.

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-runner";
import { addTopic, closeTopic, completeMeeting, deleteTopic, editTopic, saveNotes, scheduleMeeting, topicToTask } from "@/lib/one-on-one/service";

const str = (v: unknown) => String(v ?? "");

function refreshed<R extends { ok: boolean }>(r: R): R {
  if (r.ok) revalidatePath("/one-on-one", "layout");
  return r;
}

export async function addTopicAction(other: string, text: string) {
  return refreshed(await runAction("Тема встречи один на один", (a) => addTopic(a, str(other), str(text))));
}

export async function editTopicAction(topicId: string, text: string) {
  return refreshed(await runAction("Правка темы один на один", (a) => editTopic(a, str(topicId), str(text))));
}

export async function deleteTopicAction(topicId: string) {
  return refreshed(await runAction("Удаление темы один на один", (a) => deleteTopic(a, str(topicId))));
}

export async function closeTopicAction(topicId: string, status: "discussed" | "dropped" | "open", outcome?: string | null) {
  const s = status === "discussed" || status === "dropped" || status === "open" ? status : ("" as never);
  return refreshed(await runAction("Итог темы один на один", (a) => closeTopic(a, str(topicId), s, outcome === undefined || outcome === null ? outcome : str(outcome))));
}

export async function scheduleMeetingAction(other: string, date: string) {
  return refreshed(await runAction("Встреча один на один", (a) => scheduleMeeting(a, str(other), str(date))));
}

export async function saveNotesAction(meetingId: string, input: { shared?: string; mine?: string; base?: string }) {
  const opt = (v: unknown) => (v === undefined ? undefined : str(v));
  const clean = { shared: opt(input?.shared), mine: opt(input?.mine), base: opt(input?.base) };
  return refreshed(await runAction("Заметки встречи один на один", (a) => saveNotes(a, str(meetingId), clean)));
}

export async function completeMeetingAction(meetingId: string, next: string | null) {
  return refreshed(await runAction("Завершение встречи один на один", (a) => completeMeeting(a, str(meetingId), next === null ? null : str(next))));
}

export async function topicToTaskAction(topicId: string, input: { title: string; outcome: string; owner: string; direction: string; due: string }) {
  const clean = { title: str(input?.title), outcome: str(input?.outcome), owner: str(input?.owner), direction: str(input?.direction), due: str(input?.due) };
  return refreshed(await runAction("Задача из темы один на один", (a) => topicToTask(a, str(topicId), clean)));
}
