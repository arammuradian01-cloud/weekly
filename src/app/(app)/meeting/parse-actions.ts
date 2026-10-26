"use server";

// Действия разбора встречи из Notion (этап 61). Права и правила проверяет сервис. Сам разбор долгий (чтение Notion до
// полутора минут и ответ Claude до четырёх), поэтому он идёт после ответа экрану (after): экран сразу переходит на
// страницу разбора и показывает «Разбираем встречу…», пока статус не сменится.

import { after } from "next/server";
import { runAction, type Result } from "@/lib/action-runner";
import type { WeekKey } from "@/domain/types";
import type { ParseDecision } from "@/lib/meeting/parse-types";
import * as svc from "@/lib/meeting/parse-service";

/** repeat: разобрать ещё раз, хотя по этой странице задачи уже созданы. Без него сервис вернёт их номера */
export async function startParseAction(team: string, week: WeekKey, url: string, repeat = false): Promise<Result<svc.StartResult>> {
  const r = await runAction("Разбор встречи из Notion", (a) => svc.startParse(a, String(team), week, String(url ?? ""), { repeat: repeat === true }));
  if (r.ok && r.value.started && r.value.id) {
    const id = r.value.id;
    after(() => svc.runParse(id));
  }
  return r;
}

export async function retryParseAction(id: string): Promise<Result<{ id: string }>> {
  const r = await runAction("Повтор разбора встречи", (a) => svc.retryParse(a, String(id)));
  if (r.ok) after(() => svc.runParse(r.value.id));
  return r;
}

export async function saveParseDraftAction(id: string, patch: svc.DraftPatch, expected?: string | null): Promise<Result<svc.ParseView>> {
  return runAction("Черновик разбора", (a) => svc.saveParseDraft(a, String(id), patch ?? {}, expected == null ? null : String(expected)));
}

export async function sendParseToCeoAction(id: string, input: svc.SendCeoInput): Promise<Result<svc.ParseView>> {
  return runAction("Отправка отчёта руководителю", (a) => svc.sendParseToCeo(a, String(id), input));
}

export async function createParseTasksAction(id: string, input: { tasks?: svc.ParseView["result"]["tasks"]; decisions?: ParseDecision[] }): Promise<Result<svc.CreateTasksResult>> {
  return runAction("Задачи из разбора встречи", (a) => svc.createParseTasks(a, String(id), input ?? {}));
}
