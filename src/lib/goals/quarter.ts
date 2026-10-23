// Шкала квартала на экране целей (этап 68): куда попадает цель. Чистое правило без базы, его проверяют модульные тесты

import type { GoalResult } from "./parse";

export type GoalBucket = "done" | "risk" | "notasks" | "stale" | "closed" | "work";

/**
 * Отборы взаимоисключающие, по старшинству: достигнута; закрыта не полностью (частично, не достигнута или снята);
 * дальше только цели в работе: в риске, без задач, без свежего факта; остальные «в работе». Поэтому число на кнопке
 * совпадает с числом целей после нажатия, а кнопки и отрезки в сумме дают все цели
 */
export function goalBucket(g: { result: GoalResult; risk: string | null; progress: { total: number }; factStale: boolean }): GoalBucket {
  if (g.result === "ACHIEVED") return "done";
  if (g.result !== "IN_PROGRESS") return "closed";
  if (g.risk) return "risk";
  if (g.progress.total === 0) return "notasks";
  if (g.factStale) return "stale";
  return "work";
}
