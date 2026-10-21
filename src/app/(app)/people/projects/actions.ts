"use server";

// Weekly-проекты руководителей (этап 57). Права проверяет сервис: экран лишь прячет то, что нельзя.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as projects from "@/lib/org/projects";
import { removeTeamMember } from "@/lib/org/service";

const done = <T,>(r: Result<T>): Result<T> => {
  if (r.ok) revalidatePath("/", "layout");
  return r;
};

/** Кого добавить: целое подразделение со всеми ниже или отдельных людей */
type Who = { unit?: string | null; slugs?: string[] | null };

async function slugsOf(who: Who | null | undefined): Promise<string[]> {
  if (who?.unit) return projects.unitPeople(String(who.unit));
  return Array.isArray(who?.slugs) ? who!.slugs!.map(String) : [];
}

export async function createProjectAction(name: string, who?: Who | null): Promise<Result<{ id: string; name: string; result: projects.AddPeopleResult | null }>> {
  return done(
    await runAction("Новый weekly-проект", async (a) => {
      const team = await projects.createProject(a, { name: String(name ?? "") });
      const slugs = await slugsOf(who);
      return { ...team, result: slugs.length ? await projects.addProjectPeople(a, team.id, slugs) : null };
    }),
  );
}

export async function addToProjectAction(teamId: string, who: Who): Promise<Result<projects.AddPeopleResult>> {
  return done(await runAction("Люди в weekly-проект", async (a) => projects.addProjectPeople(a, String(teamId), await slugsOf(who))));
}

export async function removeFromProjectAction(teamId: string, slug: string): Promise<Result<void>> {
  return done(await runAction("Участник проекта", (a) => removeTeamMember(a, String(teamId), String(slug))));
}
