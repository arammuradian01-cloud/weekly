"use server";

// Действия экрана «Weekly-команды» (этап 64). Тонкие обёртки над сервисами команд и проектов: права, правила
// согласия и журнал там же, где были. Экран лишь прячет то, что нельзя.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as org from "@/lib/org/service";
import * as projects from "@/lib/org/projects";
import * as teams from "@/lib/org/teams";

const done = <T,>(r: Result<T>): Result<T> => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

/** Кого добавить: целое подразделение со всеми ниже (помощник «Собрать из структуры») или отдельных людей */
type Who = { unit?: string | null; slugs?: string[] | null };

async function slugsOf(who: Who | null | undefined): Promise<string[]> {
  if (who?.unit) return projects.unitPeople(String(who.unit));
  return Array.isArray(who?.slugs) ? who!.slugs!.map(String) : [];
}

/**
 * Новая команда сразу с людьми, одной транзакцией. Руководит ею тот, кто создаёт (weekly-проект этапа 57); владелец в
 * режиме управления может сразу назначить другого руководителя
 */
export async function createTeamAction(name: string, who?: Who | null, leader?: string | null): Promise<Result<teams.CreatedTeam>> {
  return done(await runAction("Новая weekly-команда", async (a) => teams.createTeam(a, String(name ?? ""), await slugsOf(who), leader ? String(leader) : null)));
}

/** Люди в команду пачкой: своя ветка сразу, другие ветки после согласия руководителя (этапы 53 и 57) */
export async function addPeopleAction(teamId: string, who: Who): Promise<Result<projects.AddPeopleResult>> {
  return done(await runAction("Люди в weekly-команду", async (a) => projects.addProjectPeople(a, String(teamId), await slugsOf(who))));
}

export async function removeMemberAction(teamId: string, slug: string): Promise<Result<void>> {
  return done(await runAction("Участник команды", (a) => org.removeTeamMember(a, String(teamId), String(slug))));
}

export async function cancelRequestAction(requestId: string): Promise<Result<void>> {
  return done(await runAction("Запрос в команду", (a) => org.cancelJoinRequest(a, String(requestId))));
}

/** Согласие или отказ руководителя человека на запрос в команду другой ветки (этап 53) */
export async function decideJoinAction(requestId: string, approve: boolean): Promise<Result<void>> {
  return done(await runAction("Запрос в команду", (a) => org.decideJoinRequest(a, String(requestId), !!approve)));
}

export async function renameTeamAction(teamId: string, name: string): Promise<Result<{ id: string; name: string }>> {
  return done(await runAction("Название команды", (a) => teams.renameTeam(a, String(teamId), String(name ?? ""))));
}

export async function closeTeamAction(teamId: string): Promise<Result<void>> {
  return done(await runAction("Закрыть команду", (a) => teams.closeTeam(a, String(teamId))));
}

/** Вернуть закрытую команду: владелец в режиме управления */
export async function reopenTeamAction(teamId: string): Promise<Result<void>> {
  return done(await runAction("Вернуть команду", (a) => org.updateTeam(a, String(teamId), { active: true })));
}

/** Руководитель и команда выше: владелец в режиме управления. Поле не передано: не меняется */
export async function updateTeamAction(teamId: string, input: { leader?: string | null; parent?: string | null }): Promise<Result<void>> {
  const clean: org.TeamInput = {};
  if (input?.leader !== undefined) clean.leader = input.leader ? String(input.leader) : null;
  if (input?.parent !== undefined) clean.parent = input.parent ? String(input.parent) : null;
  return done(await runAction("Правка команды", (a) => org.updateTeam(a, String(teamId), clean)));
}

export async function setRhythmAction(teamId: string, input: org.RhythmInput): Promise<Result<void>> {
  return done(await runAction("Ритм команды", (a) => org.setTeamRhythm(a, String(teamId), input)));
}

/** Создать недостающие команды руководителей подразделений по структуре: владелец в режиме управления */
export async function syncTeamsAction(): Promise<Result<{ teams: number; members: number }>> {
  return done(await runAction("Команды по структуре", (a) => org.syncTeams(a)));
}
