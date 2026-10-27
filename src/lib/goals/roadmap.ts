// Цели для roadmap (этап 77): цели квартала выбранной команды и цели выше, на которые работают её открытые задачи.
// Статус, риск и прогресс считает goalsView, как на экране «Цели»: одно правило на оба экрана. На roadmap уходит
// только строка цели, без истории фактов, описания и списка задач.

import { prisma } from "@/lib/db";
import type { RoadmapGoal } from "@/lib/tasks/roadmap-goals";
import { goalsView } from "./service";

type Who = Parameters<typeof goalsView>[0];

/**
 * team: выбранная команда (null: «Все мои команды» или без команды, тогда цели всего департамента); own: команды, чьи
 * цели квартала свои (видны и без задач). Чужая цель уходит, только если на неё работает открытая задача: остальное
 * на экране «Цели»
 */
export async function roadmapGoals(who: Who, opts: { team: string | null; own: string[]; quarter?: string | null }): Promise<{ quarter: string; goals: RoadmapGoal[] }> {
  const view = await goalsView(who, { team: opts.team, quarter: opts.quarter ?? null });
  const own = new Set(opts.own);
  const others = view.goals.filter((g) => !own.has(g.team.id)).map((g) => g.id);
  const used = others.length
    ? await prisma.task.findMany({
        where: { goalId: { in: others }, archivedAt: null, status: { in: ["IN_PROGRESS", "CLARIFY", "PROPOSED"] } },
        select: { goalId: true },
        distinct: ["goalId"],
      })
    : [];
  const usedIds = new Set(used.map((u) => u.goalId));
  const goals = view.goals
    .filter((g) => own.has(g.team.id) || usedIds.has(g.id))
    .map(
      (g): RoadmapGoal => ({
        id: g.id,
        code: g.code,
        title: g.title,
        quarter: g.quarter,
        team: g.team,
        owner: g.owner,
        result: g.result,
        risk: g.risk,
        progress: g.progress,
        numeric: g.numeric,
        fact: g.fact?.value ?? null,
        base: g.base,
        target: g.target,
        metric: g.metric,
        own: own.has(g.team.id),
        known: true,
      }),
    );
  return { quarter: view.quarter, goals };
}
