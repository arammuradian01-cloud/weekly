"use server";

// Действия weekly по смысловым блокам (этап 66): отчёт CEO по блокам (сохранить, отправить CEO), список конкурентов,
// шаблон блоков команды и weekly команды по блокам (сохранить, отправить своему руководителю).
// Права и правила проверяют сервисы.

import { runAction, type Result } from "@/lib/action-runner";
import type { WeekKey } from "@/domain/types";
import type { CeoReportView } from "@/lib/weekly/service";
import * as ceo from "@/lib/ceo/report";
import { saveCompetitors } from "@/lib/weekly-blocks/service";
import * as team from "@/lib/weekly-blocks/team";
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

// ---------- Weekly команды по блокам ----------

export async function saveTeamTemplateAction(teamId: string, blocks: unknown): Promise<Result<team.TeamTemplateView>> {
  return runAction("Блоки weekly команды", (a) => team.saveTeamTemplate(a, String(teamId), blocks));
}

export async function saveTeamReportAction(teamId: string, week: WeekKey, blocks: unknown, expected: string | null): Promise<Result<team.TeamReportView>> {
  if (expected !== null && typeof expected !== "string") return { ok: false, error: STALE };
  return runAction("Weekly команды по блокам", (a) => team.saveTeamReport(a, String(teamId), week, blocks, expected));
}

export async function sendTeamReportAction(teamId: string, week: WeekKey, blocks: unknown, expected: string | null): Promise<Result<team.TeamReportView>> {
  if (expected !== null && typeof expected !== "string") return { ok: false, error: STALE };
  return runAction("Отправка weekly команды", (a) => team.sendTeamReport(a, String(teamId), week, blocks, expected));
}
