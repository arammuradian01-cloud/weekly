// Сохранённые виды списка (этап 25, модуль М10): фильтры и сортировка из адреса под своим именем. Виды личные:
// у каждого свои, но ссылкой с фильтрами можно поделиться, и у коллеги откроется тот же вид

import { prisma } from "@/lib/db";
import { normalizeQuery } from "./query";

export { normalizeQuery };

export const VIEW_LIMITS = { name: 60, query: 1000, perPath: 20 };
export const VIEW_PATHS = ["/tasks"] as const;
export type ViewPath = (typeof VIEW_PATHS)[number];

export type SavedViewDto = { id: string; name: string; query: string; path: ViewPath };

export class ViewRuleError extends Error {}

const fail = (message: string): never => {
  throw new ViewRuleError(message);
};

function checkPath(path: string): ViewPath {
  if (!(VIEW_PATHS as readonly string[]).includes(path)) fail("Виды сохраняются только в разделе «Задачи»");
  return path as ViewPath;
}

export async function listViews(personId: string, path: string): Promise<SavedViewDto[]> {
  const rows = await prisma.savedView.findMany({ where: { personId, path }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({ id: r.id, name: r.name, query: r.query, path: r.path as ViewPath }));
}

/** Сохранить вид. Одинаковое имя у того же человека в том же разделе заменяет фильтры вида */
export async function saveView(personId: string, input: { path: string; name: string; query: string }): Promise<SavedViewDto> {
  const path = checkPath(String(input.path ?? ""));
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) fail("Дайте виду имя");
  if (name.length > VIEW_LIMITS.name) fail(`Имя не длиннее ${VIEW_LIMITS.name} знаков`);
  const query = normalizeQuery(String(input.query ?? ""));
  if (!query) fail("Задайте хотя бы один фильтр или сортировку, иначе сохранять нечего");
  if (query.length > VIEW_LIMITS.query) fail("Слишком длинный набор фильтров");
  return prisma.$transaction(async (tx) => {
    const count = await tx.savedView.count({ where: { personId, path, name: { not: name } } });
    if (count >= VIEW_LIMITS.perPath) fail(`Не больше ${VIEW_LIMITS.perPath} видов в разделе. Удалите ненужный`);
    const row = await tx.savedView.upsert({
      where: { personId_path_name: { personId, path, name } },
      create: { personId, path, name, query, sortOrder: count },
      update: { query },
    });
    return { id: row.id, name: row.name, query: row.query, path: row.path as ViewPath };
  });
}

export async function deleteView(personId: string, id: string): Promise<void> {
  const row = await prisma.savedView.findUnique({ where: { id: String(id ?? "") } });
  if (!row || row.personId !== personId) return fail("Такого вида нет");
  await prisma.savedView.delete({ where: { id: row.id } });
}
