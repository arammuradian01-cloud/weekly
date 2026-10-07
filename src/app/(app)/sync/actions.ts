"use server";

// Действия страницы «Синхронизация». Права проверяет сервис: только владелец в режиме управления.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/sheet/service";
import * as bord from "@/lib/bord/service";
import * as numbers from "@/lib/numbers/service";

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

// Цифры недели из недельного отчёта (этап 24)
export async function setNumbersSourceAction(input: string, tab?: string) {
  return done(await runAction("Ссылка на недельный отчёт", (a) => numbers.setNumbersSource(a, String(input ?? ""), tab === undefined ? undefined : String(tab))));
}

export async function pullNumbersNowAction() {
  return done(await runAction("Чтение недельного отчёта", (a) => numbers.pullNumbersNow(a)));
}

export async function searchReportRowsAction(query: string) {
  return runAction("Строки отчёта", (a) => numbers.searchReportRows(a, String(query ?? "")));
}

export async function setMetricsAction(list: numbers.Metric[]) {
  return done(await runAction("Цифры недели", (a) => numbers.setMetrics(a, list)));
}
