"use server";

// Прогноз до конца месяца (этап 24): права и правила проверяет сервис

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/forecast/service";
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
