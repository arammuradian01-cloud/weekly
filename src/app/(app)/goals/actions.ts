"use server";

// Действия страницы «Цели» и карточки задачи (этап 17). Права проверяет сервис целей.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as goals from "@/lib/goals/service";
import { applyBordGoals, previewBordGoals } from "@/lib/goals/bord";
import type { GoalResult } from "@/generated/prisma/enums";

const done = <T,>(r: Result<T>): Result<T> => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

export async function createGoalAction(input: goals.GoalInput): Promise<Result<{ id: string }>> {
  return done(await runAction("Новая цель", (a) => goals.createGoal(a, input)));
}

export async function updateGoalAction(id: string, input: goals.GoalInput & { atRisk?: boolean; riskNote?: string | null; result?: GoalResult }): Promise<Result<void>> {
  return done(await runAction("Правка цели", (a) => goals.updateGoal(a, String(id), input)));
}

export async function deleteGoalAction(id: string): Promise<Result<void>> {
  return done(await runAction("Удаление цели", (a) => goals.deleteGoal(a, String(id))));
}

export async function previewGoalsAction(text: string, team: string, quarter: string | null): Promise<Result<goals.GoalsPlan>> {
  return runAction("Проверка целей", (a) => goals.planGoals(a, String(text ?? ""), { team: String(team), quarter }));
}

export async function applyGoalsAction(text: string, team: string, quarter: string | null): Promise<Result<{ added: number; changed: number }>> {
  return done(await runAction("Загрузка целей", (a) => goals.applyGoals(a, String(text ?? ""), { team: String(team), quarter })));
}

export async function previewBordGoalsAction(tab: string, team: string, quarter: string | null): Promise<Result<goals.GoalsPlan>> {
  return runAction("Цели из Bord", (a) => previewBordGoals(a, String(tab ?? ""), { team: String(team), quarter }));
}

export async function applyBordGoalsAction(tab: string, team: string, quarter: string | null): Promise<Result<{ added: number; changed: number }>> {
  return done(await runAction("Цели из Bord", (a) => applyBordGoals(a, String(tab ?? ""), { team: String(team), quarter })));
}

export async function goalOptionsAction(number: number): Promise<Result<{ id: string; label: string }[]>> {
  return runAction("Цели для задачи", (a) => goals.goalOptions({ personId: a.personId, role: a.role, management: a.management }, Number(number)));
}

export async function linkGoalAction(number: number, goalId: string | null): Promise<Result<{ goal: string | null }>> {
  return done(await runAction("Цель задачи", (a) => goals.linkTaskGoal(a, Number(number), goalId ? String(goalId) : null)));
}
