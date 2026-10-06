"use server";

// Действия экрана «Настройки». Права и правила проверяет сервис: справочники и ритм недели для режима управления,
// люди и роли только для владельца.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/admin/service";

async function done<T>(result: Result<T>): Promise<Result<T>> {
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function addDictItemAction(kind: string, label: string) {
  return done(await runAction("Новое значение справочника", (a) => svc.addDictItem(a, String(kind), String(label ?? ""))));
}

export async function renameDictItemAction(kind: string, code: string, label: string) {
  return done(await runAction("Переименование значения", (a) => svc.renameDictItem(a, String(kind), String(code), String(label ?? ""))));
}

export async function setDictItemActiveAction(kind: string, code: string, active: boolean) {
  return done(await runAction("Видимость значения", (a) => svc.setDictItemActive(a, String(kind), String(code), !!active)));
}

export async function createPersonAction(input: svc.PersonInput) {
  return done(await runAction("Новый человек", (a) => svc.createPerson(a, input)));
}

export async function updatePersonAction(slug: string, input: Partial<svc.PersonInput>) {
  return done(await runAction("Правка человека", (a) => svc.updatePerson(a, String(slug), input)));
}

export async function setPersonActiveAction(slug: string, active: boolean) {
  return done(await runAction("Включение человека", (a) => svc.setPersonActive(a, String(slug), !!active)));
}

export async function saveRhythmAction(input: svc.Rhythm) {
  return done(
    await runAction("Ритм недели", (a) =>
      svc.saveRhythm(a, {
        deadlineWeekday: Number(input.deadlineWeekday),
        deadlineTime: String(input.deadlineTime ?? ""),
        meetingWeekday: Number(input.meetingWeekday),
        staleDays: Number(input.staleDays),
      }),
    ),
  );
}

export async function saveStandBannerAction(mode: svc.StandBanner) {
  return done(await runAction("Плашка над страницами", (a) => svc.saveStandBanner(a, mode)));
}

export async function previewReloadAction(tasksText: string, weeklyText: string) {
  return runAction("Проверка выгрузки Bord", (a) => svc.previewReload(a, String(tasksText ?? ""), String(weeklyText ?? "")));
}

export async function runReloadAction(tasksText: string, weeklyText: string, confirm: string) {
  return done(await runAction("Перезаливка из выгрузки Bord", (a) => svc.runReload(a, String(tasksText ?? ""), String(weeklyText ?? ""), String(confirm ?? ""))));
}
