// Цикл новостей (этап 60, проверка 21.10): забор лент раз в час, уточнение через Claude, дайджесты утром и очистка
// раз в сутки. Отдельно от цикла писем и со своей арендой: долгий забор чужих лент не задерживает напоминания,
// дайджест к встрече и письма о событиях. Аренда продлевается между шагами и в длинной рассылке дайджестов,
// поэтому второй контейнер во время выкладки не начнёт тот же проход. Выключается вместе с письмами: MAIL_LOOP=off.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ENRICH_BUDGET_MS, FETCH_BUDGET_MS, LOOP_STARTED_KEY, cleanupIfDue, enrichPass, fetchIfDue, newsDigestPass, type PassResult } from "./service";

const TICK_MS = 60_000;
const LEASE = "5 minutes";
const LOCK = "news.lock";

const g = globalThis as unknown as { __newsOwner?: string; __newsLoop?: ReturnType<typeof setTimeout> };

/** Проход под арендой. null: проход делает другой процесс. fn получает продление аренды: false значит аренду потеряли */
async function leased<T>(fn: (renew: () => Promise<boolean>) => Promise<T>): Promise<T | null> {
  g.__newsOwner ??= randomUUID();
  const owner = g.__newsOwner;
  const got = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "settings" ("key", "value", "updatedAt")
    VALUES (${LOCK}, jsonb_build_object('owner', ${owner}::text, 'until', now() + ${LEASE}::interval), now())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE ("settings"."value"->>'until')::timestamptz < now() OR "settings"."value"->>'owner' = ${owner}::text
    RETURNING "key"`;
  if (!got.length) return null;
  const renew = async () => {
    const n = await prisma.$executeRaw`
      UPDATE "settings" SET "value" = jsonb_build_object('owner', ${owner}::text, 'until', now() + ${LEASE}::interval), "updatedAt" = now()
      WHERE "key" = ${LOCK} AND "value"->>'owner' = ${owner}::text`;
    return n > 0;
  };
  try {
    return await fn(renew);
  } finally {
    await prisma.$executeRaw`
      UPDATE "settings" SET "value" = jsonb_build_object('owner', '', 'until', now() - interval '1 second'), "updatedAt" = now()
      WHERE "key" = ${LOCK} AND "value"->>'owner' = ${owner}::text`;
  }
}

export type NewsTick = { fetched: boolean; enriched: number; digest: PassResult; cleaned: boolean };

/** Один проход новостей. Шаги независимы: сбой забора не мешает дайджестам с их узким окном */
export async function newsTick(now = new Date()): Promise<NewsTick | null> {
  const safe = async <T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      console.error(`${what}: проход не прошёл, повторим через минуту:`, error instanceof Error ? error.message : error);
      return fallback;
    }
  };
  return leased(async (renew) => {
    // Первый проход на стенде запоминается один раз: догоняющий еженедельный только за недели, когда цикл уже работал
    await prisma.$executeRaw`
      INSERT INTO "settings" ("key", "value", "updatedAt") VALUES (${LOOP_STARTED_KEY}, to_jsonb(${now.toISOString()}::text), now())
      ON CONFLICT ("key") DO NOTHING`;
    // Дайджесты первыми: у них окно утром, а забор и уточнение могут занять минуты
    const digest = await safe("Дайджесты новостей", () => newsDigestPass(now, { renew }), { sent: 0, skipped: 0, failed: 1 });
    if (!(await renew())) return { fetched: false, enriched: 0, digest, cleaned: false };
    const fetched = await safe("Забор новостей", () => fetchIfDue(now, { budgetMs: FETCH_BUDGET_MS }), false);
    if (!(await renew())) return { fetched, enriched: 0, digest, cleaned: false };
    const enriched = fetched ? await safe("Уточнение новостей", () => enrichPass(now, { budgetMs: ENRICH_BUDGET_MS }), 0) : 0;
    if (!(await renew())) return { fetched, enriched, digest, cleaned: false };
    const cleaned = await safe("Очистка новостей", () => cleanupIfDue(now), false);
    return { fetched, enriched, digest, cleaned };
  });
}

/** Запустить фоновый цикл новостей один раз на процесс */
export function startNewsLoop(): void {
  if (g.__newsLoop) return;
  const step = async () => {
    try {
      await newsTick();
    } catch (error) {
      console.error("Проход новостей не прошёл, повторим через минуту:", error instanceof Error ? error.message : error);
    } finally {
      g.__newsLoop = setTimeout(() => void step(), TICK_MS);
      g.__newsLoop.unref?.();
    }
  };
  g.__newsLoop = setTimeout(() => void step(), TICK_MS);
  g.__newsLoop.unref?.();
}
