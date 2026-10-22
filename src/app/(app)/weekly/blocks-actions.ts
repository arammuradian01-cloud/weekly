"use server";

// Действия weekly по смысловым блокам (этап 66): отчёт CEO по блокам (сохранить, отправить CEO), список конкурентов.
// Права и правила проверяют сервисы.

import { runAction, type Result } from "@/lib/action-runner";
import type { WeekKey } from "@/domain/types";
import type { CeoReportView } from "@/lib/weekly/service";
import * as ceo from "@/lib/ceo/report";
import { saveCompetitors } from "@/lib/weekly-blocks/service";
import type { Competitor } from "@/lib/weekly-blocks/assemble";

const STALE = "Страница устарела: обновите её, чтобы сохранить отчёт. Свои правки сначала скопируйте";

/** Экран обязан прислать момент прошлого сохранения, который он видел (null: отчёт ещё не сохраняли) */
export async function saveCeoBlocksAction(week: WeekKey, blocks: unknown, meetings: unknown, expected: string | null): Promise<Result<CeoReportView>> {
  if (expected !== null && typeof expected !== "string") return { ok: false, error: STALE };
  return runAction("Отчёт CEO по блокам", (a) => ceo.saveCeoBlocks(a, week, blocks, meetings, expected));
}

export async function sendCeoReportAction(week: WeekKey, blocks: unknown, meetings: unknown, expected: string | null): Promise<Result<CeoReportView>> {
  if (expected !== null && typeof expected !== "string") return { ok: false, error: STALE };
  return runAction("Отправка weekly CEO", (a) => ceo.sendCeoReport(a, week, { blocks, meetings, expected }));
}

export async function saveCompetitorsAction(list: unknown): Promise<Result<Competitor[]>> {
  return runAction("Конкуренты в отчёте CEO", (a) => saveCompetitors(a, list));
}
