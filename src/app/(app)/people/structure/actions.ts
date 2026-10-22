"use server";

// Действия страницы «Структура» (этап 14). Права проверяет сервис: экран лишь прячет то, что нельзя.
// Этап 64: команды и их состав правятся на экране «Weekly-команды», действия в people/teams/actions.ts

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

export async function setPersonOrgAction(slug: string, input: org.PersonOrgInput): Promise<Result<void>> {
  return done(await runAction("Человек в структуре", (a) => org.setPersonOrg(a, String(slug), input)));
}

export async function updateUnitAction(id: string, input: org.UnitInput): Promise<Result<void>> {
  return done(await runAction("Правка подразделения", (a) => org.updateUnit(a, String(id), input)));
}

export async function createUnitAction(input: { name: string; kind: UnitKind; parent?: string | null }): Promise<Result<{ id: string }>> {
  return done(await runAction("Новое подразделение", (a) => org.createUnit(a, input)));
}

