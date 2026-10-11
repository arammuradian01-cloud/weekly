"use server";

// Прогноз до конца месяца (этап 24): права и правила проверяет сервис

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/forecast/service";
import * as plan from "@/lib/plan/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError } from "@/lib/tasks/service";

function weekOf(key: unknown): WeekKey {
  if (!isWeekKey(key)) throw new TaskRuleError("Неверная неделя");
  return key;
}

export async function saveForecastAction(key: string, lines: svc.ForecastLineInput[]): Promise<Result<svc.MyForecast>> {
  const r = await runAction("Прогноз месяца", (a) => svc.saveForecast(a, weekOf(key), lines));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function myForecastAction(key: string): Promise<Result<svc.MyForecast>> {
  return runAction("Прогноз месяца", (a) => svc.myForecast(a, weekOf(key)));
}

// Прогноз месяца по драйверам (этап 32): права, границы значений и обоснование проверяет сервис

export async function adjustPlanAction(input: plan.AdjustInput): Promise<Result<plan.MonthPlanView>> {
  const r = await runAction("Корректировка прогноза", (a) => plan.adjust(a, input));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function previewPullAction(month: string): Promise<Result<plan.PullPreview>> {
  return runAction("Проверка LRF", (a) => plan.previewPull(a, month));
}

export async function applyPullAction(month: string): Promise<Result<{ month: string; lines: number }>> {
  const r = await runAction("Загрузка версий из LRF", (a) => plan.applyPull(a, month));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function setPlanOwnersAction(product: string, slugs: string[]): Promise<Result<{ slug: string; name: string }[]>> {
  const r = await runAction("Команда продукта", (a) => plan.setOwners(a, product, slugs));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function planPeopleAction(): Promise<Result<{ slug: string; name: string }[]>> {
  return runAction("Люди", (a) => plan.planPeople(a));
}

export async function setPlanSourceAction(input: string): Promise<Result<string>> {
  return runAction("Источник прогноза", (a) => plan.setPlanSource(a, input));
}
