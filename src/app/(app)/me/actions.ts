"use server";

// «Мне»: разобрать событие, отложить до утра, разобрать всё (этап 11)

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-runner";
import { markAllDone, markDone, snooze, type SnoozeChoice } from "@/lib/inbox/service";

export async function markDoneAction(subject: string) {
  const r = await runAction("Разобрано", (a) => markDone(a, String(subject)));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function snoozeAction(subject: string, choice: SnoozeChoice) {
  const r = await runAction("Напомнить", async (a) => (await snooze(a, String(subject), choice)).toISOString());
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function markAllDoneAction() {
  const r = await runAction("Разобрать всё", (a) => markAllDone(a));
  if (r.ok) revalidatePath("/", "layout");
  return r;
}
