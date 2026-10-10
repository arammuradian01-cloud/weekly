"use server";

// Действия страницы «Структура» (этап 14). Права проверяет сервис: экран лишь прячет то, что нельзя.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as org from "@/lib/org/service";
import type { StructurePlan } from "@/lib/org/import";
import type { UnitKind } from "@/generated/prisma/enums";

const done = <T,>(r: Result<T>): Result<T> => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

export async function previewStructureAction(text: string): Promise<Result<StructurePlan>> {
  return runAction("Предпросмотр структуры", (a) => org.previewStructure(a, String(text ?? "")));
}

export async function applyStructureAction(text: string): Promise<Result<org.StructureResult>> {
  return done(await runAction("Загрузка структуры", (a) => org.applyStructure(a, String(text ?? ""))));
}

export async function syncTeamsAction(): Promise<Result<{ teams: number; members: number }>> {
  return done(await runAction("Команды по структуре", (a) => org.syncTeams(a)));
}

export async function createTeamAction(input: org.TeamInput): Promise<Result<{ id: string }>> {
  return done(await runAction("Новая команда", (a) => org.createTeam(a, input)));
}

export async function updateTeamAction(id: string, input: org.TeamInput): Promise<Result<void>> {
  return done(await runAction("Правка команды", (a) => org.updateTeam(a, String(id), input)));
}

export async function addMemberAction(team: string, slug: string): Promise<Result<void>> {
  return done(await runAction("Участник команды", (a) => org.addTeamMember(a, String(team), String(slug))));
}

export async function removeMemberAction(team: string, slug: string): Promise<Result<void>> {
  return done(await runAction("Участник команды", (a) => org.removeTeamMember(a, String(team), String(slug))));
}

export async function setPersonOrgAction(slug: string, input: org.PersonOrgInput): Promise<Result<void>> {
  return done(await runAction("Человек в структуре", (a) => org.setPersonOrg(a, String(slug), input)));
}

export async function updateUnitAction(id: string, input: org.UnitInput): Promise<Result<void>> {
  return done(await runAction("Правка подразделения", (a) => org.updateUnit(a, String(id), input)));
}

export async function createUnitAction(input: { name: string; kind: UnitKind; parent?: string | null }): Promise<Result<{ id: string }>> {
  return done(await runAction("Новое подразделение", (a) => org.createUnit(a, input)));
}

export async function setTeamRhythmAction(team: string, input: org.RhythmInput): Promise<Result<void>> {
  return done(await runAction("Ритм команды", (a) => org.setTeamRhythm(a, String(team), input)));
}
