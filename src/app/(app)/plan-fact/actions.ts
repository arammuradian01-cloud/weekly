"use server";

// Неделя к плану (этап 81): загрузка плана и факта по неделям. Права и проверки в сервисе

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/weekplan/service";

export async function previewWeekPlanAction(): Promise<Result<svc.PlanPreview>> {
  return runAction("Проверка плана по неделям", (a) => svc.previewPlan(a));
}

export async function applyWeekPlanAction(): Promise<Result<{ lines: number; rows: number; fact: svc.FactState }>> {
  const r = await runAction("Загрузка плана по неделям", (a) => svc.applyPlan(a));
  if (r.ok) revalidatePath("/plan-fact");
  return r;
}

export async function pullWeekFactAction(): Promise<Result<svc.FactState>> {
  const r = await runAction("Факт по неделям", (a) => svc.pullFactNow(a));
  if (r.ok) revalidatePath("/plan-fact");
  return r;
}

export async function setWeekPlanSourcesAction(input: { plan?: string; fact?: string; factTab?: string }): Promise<Result<svc.Sources>> {
  const clean = { plan: String(input?.plan ?? ""), fact: String(input?.fact ?? ""), factTab: String(input?.factTab ?? "") };
  const r = await runAction("Источники плана и факта по неделям", (a) => svc.setWeekPlanSources(a, clean));
  if (r.ok) revalidatePath("/plan-fact");
  return r;
}
