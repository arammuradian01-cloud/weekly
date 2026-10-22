"use server";

// Прогноз до конца месяца (этап 24): права и правила проверяет сервис

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/forecast/service";
import * as plan from "@/lib/plan/service";
import * as processes from "@/lib/plan/processes";
import * as hub from "@/lib/plan/hub-service";
import { isWeekKey } from "@/lib/weekly/weeks";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError } from "@/lib/tasks/service";
// Этап 57: все действия прогноза только у тех, кому открыты все цифры (настройка «Доступ к цифрам»)
import { withNumbers as numbers } from "@/lib/plan/access";

function weekOf(key: unknown): WeekKey {
  if (!isWeekKey(key)) throw new TaskRuleError("Неверная неделя");
  return key;
}

export async function saveForecastAction(key: string, lines: svc.ForecastLineInput[]): Promise<Result<svc.MyForecast>> {
  const r = await runAction("Прогноз месяца", (a) => numbers(a, () => svc.saveForecast(a, weekOf(key), lines)));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function myForecastAction(key: string): Promise<Result<svc.MyForecast>> {
  return runAction("Прогноз месяца", (a) => numbers(a, () => svc.myForecast(a, weekOf(key))));
}

// Прогноз месяца по драйверам (этап 32): права, границы значений и обоснование проверяет сервис

export async function adjustPlanAction(input: plan.AdjustInput): Promise<Result<plan.MonthPlanView>> {
  const r = await runAction("Корректировка прогноза", (a) => numbers(a, () => plan.adjust(a, input)));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function previewPullAction(month: string): Promise<Result<plan.PullPreview>> {
  return runAction("Проверка LRF", (a) => numbers(a, () => plan.previewPull(a, month)));
}

export async function applyPullAction(month: string): Promise<Result<{ month: string; lines: number }>> {
  const r = await runAction("Загрузка версий из LRF", (a) => numbers(a, () => plan.applyPull(a, month)));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function setPlanOwnersAction(product: string, slugs: string[]): Promise<Result<{ slug: string; name: string }[]>> {
  const r = await runAction("Команда продукта", (a) => numbers(a, () => plan.setOwners(a, product, slugs)));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function planPeopleAction(): Promise<Result<{ slug: string; name: string }[]>> {
  return runAction("Люди", (a) => numbers(a, () => plan.planPeople(a)));
}

export async function setPlanSourceAction(input: string): Promise<Result<string>> {
  return runAction("Источник прогноза", (a) => numbers(a, () => plan.setPlanSource(a, input)));
}

// Прогноз в процессах (этап 35): отметка «Прогноз проверен» и факт по дням

export async function checkPlanAction(month: string, product: string): Promise<Result<plan.MonthPlanView>> {
  const r = await runAction("Прогноз проверен", (a) => numbers(a, () => processes.checkPlan(a, month, product)));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function previewFactsAction(text: string): Promise<Result<processes.FactsPreview>> {
  return runAction("Проверка факта", (a) => numbers(a, () => processes.previewFacts(a, String(text ?? ""))));
}

export async function applyFactsAction(text: string): Promise<Result<{ saved: number; replaced: number }>> {
  const r = await runAction("Загрузка факта", (a) => numbers(a, () => processes.applyFacts(a, String(text ?? ""))));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

// Партнёрский канал (этап 35б): корректировка драйвера партнёра командой канала

export async function adjustPartnerAction(input: plan.PartnerAdjustInput): Promise<Result<plan.MonthPlanView>> {
  const r = await runAction("Корректировка партнёра", (a) => numbers(a, () => processes.adjustPartner(a, input)));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

// Хаб «Единая воронка: данные» (этап 58): снимок «Все СК» на день и план ОСАГО по СК, ранрейт по СК. Как остальные
// действия прогноза, только при всех цифрах; права управления и владельца проверяет сервис

export async function previewHubAction(): Promise<Result<hub.HubPreview>> {
  return runAction("Проверка хаба", (a) => numbers(a, () => hub.previewHub(a)));
}

export async function applyHubAction(): Promise<Result<hub.HubApplied>> {
  const r = await runAction("Загрузка из хаба", (a) => numbers(a, () => hub.applyHub(a)));
  if (r.ok) revalidatePath("/forecast");
  return r;
}

export async function setHubSourceAction(input: string): Promise<Result<string>> {
  return runAction("Хаб данных", (a) => numbers(a, () => hub.setHubSource(a, input)));
}

export async function setSkAliasesAction(input: string): Promise<Result<string>> {
  const r = await runAction("Соответствие названий СК", (a) => numbers(a, () => hub.setSkAliases(a, String(input ?? ""))));
  if (r.ok) revalidatePath("/forecast");
  return r;
}
