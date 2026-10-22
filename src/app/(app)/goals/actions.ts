"use server";

// Действия страницы «Цели» и карточки задачи (этап 17). Права проверяет сервис целей.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as goals from "@/lib/goals/service";
import { BULK_MAX, TaskRuleError, setTasksGoal, undoChange } from "@/lib/tasks/service";
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

/** Факт цели (этап 33) */
export async function setGoalFactAction(id: string, value: string, note: string | null): Promise<Result<goals.GoalFactView>> {
  return done(await runAction("Факт цели", (a) => goals.setGoalFact(a, String(id), { value: String(value ?? ""), note: note === null ? null : String(note ?? "") })));
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

export async function goalOptionsAction(number: number): Promise<Result<goals.GoalOption[]>> {
  return runAction("Цели для задачи", (a) => goals.goalOptions({ personId: a.personId, role: a.role, management: a.management, limited: a.via === "TEAM" && !a.management }, Number(number)));
}

/** Цель для новой задачи по тексту (этап 55): лучшая подставляется в форму, остальные в поиске */
export async function suggestGoalsAction(input: { team: string; due: string; title: string; outcome: string; owner?: string | null }): Promise<Result<{ options: goals.GoalOption[]; best: string | null }>> {
  return runAction("Цели для новой задачи", (a) =>
    goals.suggestGoals({ personId: a.personId, role: a.role, management: a.management, limited: a.via === "TEAM" && !a.management }, { team: String(input?.team ?? ""), due: String(input?.due ?? ""), title: String(input?.title ?? ""), outcome: String(input?.outcome ?? ""), owner: input?.owner ? String(input.owner) : null }),
  );
}

export async function linkGoalAction(number: number, goalId: string | null): Promise<Result<{ goal: string | null }>> {
  return done(await runAction("Цель задачи", (a) => goals.linkTaskGoal(a, Number(number), goalId ? String(goalId) : null)));
}

/** Что вышло у задач, которые тянули к цели (этап 65): у каждой своя отмена */
export type GoalLinkResult = { done: { number: number; undo: string | null }[]; failed: { number: number; error: string }[] };

/**
 * Задачи к цели перетаскиванием или кнопкой «К цели» (этап 65), goalId null снимает цель. Связь пишет сервис задач
 * с журналом. Страницу экран обновляет сам после ответа: правка уже видна на нём, ждать перерисовки не нужно
 */
export async function linkTasksToGoalAction(numbers: number[], goalId: string | null): Promise<Result<GoalLinkResult>> {
  return runAction("Задачи к цели", async (a) => {
    const list = Array.isArray(numbers) ? numbers.slice(0, BULK_MAX + 1).map(Number) : [];
    const r = await setTasksGoal(a, list, goalId ? String(goalId) : null);
    return { done: r.done.map((d) => ({ number: d.number, undo: d.undo ?? null })), failed: r.failed };
  });
}

/** «Отменить» в тосте после связи с целью: прежняя цель возвращается, если задачу с тех пор не трогали */
export async function undoGoalLinksAction(items: { number: number; token: string }[]): Promise<Result<{ done: { number: number; goal: string | null }[]; failed: { number: number; error: string }[] }>> {
  return runAction("Отмена связи с целью", async (a) => {
    const list = Array.isArray(items) ? items.slice(0, BULK_MAX) : [];
    const out: { done: { number: number; goal: string | null }[]; failed: { number: number; error: string }[] } = { done: [], failed: [] };
    for (const it of list) {
      try {
        const r = await undoChange(a, String(it?.token ?? ""));
        out.done.push({ number: r.number, goal: r.task?.goal?.id ?? null });
      } catch (error) {
        out.failed.push({ number: Number(it?.number), error: error instanceof TaskRuleError ? error.message : "Не получилось отменить" });
      }
    }
    return out;
  });
}
