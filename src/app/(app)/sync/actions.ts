"use server";

// Действия страницы «Синхронизация». Права проверяет сервис: только владелец в режиме управления.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/sheet/service";
import * as bord from "@/lib/bord/service";

async function done<T>(result: Result<T>): Promise<Result<T>> {
  if (result.ok) revalidatePath("/sync");
  return result;
}

export async function setSpreadsheetAction(input: string) {
  return done(await runAction("Ссылка на таблицу", (a) => svc.setSpreadsheet(a, String(input ?? ""))));
}

export async function pushNowAction() {
  return done(await runAction("Выгрузка в таблицу", (a) => svc.pushNow(a)));
}

export async function reconcileNowAction() {
  return done(await runAction("Сверка с таблицей", (a) => svc.reconcileNow(a)));
}

export async function rebuildNowAction() {
  return done(await runAction("Пересборка вкладок", (a) => svc.rebuildNow(a)));
}

export async function setBordSourceAction(input: string) {
  return done(await runAction("Ссылка на Bord", (a) => bord.setBordSource(a, String(input ?? ""))));
}

export async function pullBordNowAction() {
  return done(await runAction("Забор задач из Bord", (a) => bord.pullBordNow(a)));
}
