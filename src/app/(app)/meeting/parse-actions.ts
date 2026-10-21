"use server";

// Действия разбора встречи из Notion (этап 61). Права и правила проверяет сервис. Сам разбор долгий (чтение Notion и
// ответ Claude до двух минут), поэтому он идёт после ответа экрану (after): экран сразу переходит на страницу разбора
// и показывает «Разбираем встречу…», пока статус не сменится.

import { after } from "next/server";
import { runAction, type Result } from "@/lib/action-runner";
import type { WeekKey } from "@/domain/types";
import type { CeoSections } from "@/lib/weekly/rules";
import type { ParseTaskDraft } from "@/lib/meeting/parse-types";
import * as svc from "@/lib/meeting/parse-service";

export async function startParseAction(team: string, week: WeekKey, url: string): Promise<Result<{ id: string }>> {
  const r = await runAction("Разбор встречи из Notion", (a) => svc.startParse(a, String(team), week, String(url ?? "")));
  if (!r.ok) return r;
  if (r.value.started) after(() => svc.runParse(r.value.id));
  return { ok: true, value: { id: r.value.id } };
}

export async function retryParseAction(id: string): Promise<Result<{ id: string }>> {
  const r = await runAction("Повтор разбора встречи", (a) => svc.retryParse(a, String(id)));
  if (r.ok) after(() => svc.runParse(r.value.id));
  return r;
}

export async function parseStatusAction(id: string): Promise<Result<{ status: string; stale: boolean }>> {
  return runAction("Разбор встречи", async (a) => {
    const v = await svc.getParse(a, String(id));
    return { status: v.status, stale: v.stale };
  });
}

export async function saveParseDraftAction(id: string, patch: { ceo?: CeoSections; tasks?: ParseTaskDraft[] }, expected?: string | null): Promise<Result<svc.ParseView>> {
  return runAction("Черновик разбора", (a) => svc.saveParseDraft(a, String(id), patch ?? {}, expected == null ? null : String(expected)));
}

export async function sendParseToCeoAction(id: string, input: svc.SendCeoInput): Promise<Result<svc.ParseView>> {
  return runAction("Отправка weekly CEO", (a) => svc.sendParseToCeo(a, String(id), input));
}

export async function createParseTasksAction(id: string, input: { tasks?: ParseTaskDraft[]; decisions?: boolean }): Promise<Result<svc.CreateTasksResult>> {
  return runAction("Задачи из разбора встречи", (a) => svc.createParseTasks(a, String(id), input ?? {}));
}
