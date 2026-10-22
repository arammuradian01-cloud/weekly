"use server";

// Действия новостей (этап 60): источники и ключевые слова для владельца, дайджест в профиле, «Забрать сейчас».
// Права проверяет сервис. «Забрать сейчас» не держит запрос: забор лент идёт до полутора минут, поэтому экран сразу
// получает «Забор запущен», а сам забор идёт после ответа (after). Итог виден в настройках и в журнале.

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { runAction, type Result } from "@/lib/action-runner";
import * as news from "@/lib/news/service";

async function done<T>(result: Result<T>, path = "/settings"): Promise<Result<T>> {
  if (result.ok) revalidatePath(path);
  return result;
}

const sourceInput = (input: { name: string; url: string; strict?: boolean }) => ({ name: String(input?.name ?? ""), url: String(input?.url ?? ""), strict: input?.strict === true });

export async function addNewsSourceAction(input: { name: string; url: string; strict?: boolean }) {
  return done(await runAction("Новый источник новостей", (a) => news.addSource(a, sourceInput(input))));
}

export async function updateNewsSourceAction(id: string, input: { name: string; url: string; strict?: boolean }) {
  return done(await runAction("Правка источника новостей", (a) => news.updateSource(a, String(id), sourceInput(input))));
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
  const result = await runAction("Забор новостей", async (a) => {
    await news.startFetchNow(a);
    after(() =>
      news.runFetchNow(a).catch((error: unknown) => {
        console.error("Забор новостей вручную не прошёл:", error instanceof Error ? error.message : error);
      }),
    );
    return { started: true as const };
  });
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** Частота и продукты дайджеста (профиль). Только при личном входе */
export async function saveNewsPrefsAction(prefs: { frequency: string; directions: string[] | null }) {
  return done(await runAction("Дайджест новостей", (a) => news.saveNewsPrefs(a, prefs)), "/profile");
}
