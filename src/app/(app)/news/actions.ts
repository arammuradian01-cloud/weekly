"use server";

// Действия новостей (этап 60): источники и ключевые слова для владельца, дайджест в профиле, «Забрать сейчас».
// Права проверяет сервис.

import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as news from "@/lib/news/service";

async function done<T>(result: Result<T>, path = "/settings"): Promise<Result<T>> {
  if (result.ok) revalidatePath(path);
  return result;
}

export async function addNewsSourceAction(input: { name: string; url: string }) {
  return done(await runAction("Новый источник новостей", (a) => news.addSource(a, { name: String(input?.name ?? ""), url: String(input?.url ?? "") })));
}

export async function updateNewsSourceAction(id: string, input: { name: string; url: string }) {
  return done(await runAction("Правка источника новостей", (a) => news.updateSource(a, String(id), { name: String(input?.name ?? ""), url: String(input?.url ?? "") })));
}

export async function setNewsSourceActiveAction(id: string, active: boolean) {
  return done(await runAction("Включение источника новостей", (a) => news.setSourceActive(a, String(id), !!active)));
}

export async function removeNewsSourceAction(id: string) {
  return done(await runAction("Удаление источника новостей", (a) => news.removeSource(a, String(id))));
}

export async function saveNewsKeywordsAction(input: Record<string, string>) {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(input ?? {})) clean[String(k)] = String(v ?? "");
  return done(await runAction("Ключевые слова новостей", (a) => news.saveKeywords(a, clean)));
}

export async function fetchNewsNowAction() {
  const result = await runAction("Забор новостей", (a) => news.fetchNow(a));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Частота и продукты дайджеста (профиль). Только при личном входе */
export async function saveNewsPrefsAction(prefs: { frequency: string; directions: string[] | null }) {
  return done(await runAction("Дайджест новостей", (a) => news.saveNewsPrefs(a, prefs)), "/profile");
}
