"use server";

// Шкала готовности крупных инициатив (этап 30)

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-runner";
import {
  closeInitiative,
  createInitiative,
  editInitiative,
  reopenInitiative,
  setInitiativeState,
  updateInitiativeNote,
  type InitiativeInput,
} from "@/lib/initiatives/service";

type Form = { title: string; why: string; owner: string; team: string; goal: string; note?: string };

const input = (f: Form): InitiativeInput => ({
  title: String(f?.title ?? ""),
  why: String(f?.why ?? ""),
  owner: String(f?.owner ?? ""),
  team: String(f?.team ?? ""),
  goal: String(f?.goal ?? ""),
  note: String(f?.note ?? ""),
});

function done<T>(result: T) {
  revalidatePath("/initiatives");
  return result;
}

export async function createInitiativeAction(form: Form) {
  return done(await runAction("Новая инициатива", (a) => createInitiative(a, input(form))));
}

export async function editInitiativeAction(id: string, form: Form) {
  return done(await runAction("Правка инициативы", (a) => editInitiative(a, String(id ?? ""), input(form))));
}

export async function setInitiativeStateAction(id: string, state: string, note: string) {
  return done(await runAction("Шкала готовности", (a) => setInitiativeState(a, String(id ?? ""), state, String(note ?? ""))));
}

export async function initiativeNoteAction(id: string, note: string) {
  return done(await runAction("Заметка инициативы", (a) => updateInitiativeNote(a, String(id ?? ""), String(note ?? ""))));
}

export async function closeInitiativeAction(id: string, result: string, note: string) {
  return done(await runAction("Закрыть инициативу", (a) => closeInitiative(a, String(id ?? ""), result, String(note ?? ""))));
}

export async function reopenInitiativeAction(id: string) {
  return done(await runAction("Вернуть инициативу", (a) => reopenInitiative(a, String(id ?? ""))));
}
