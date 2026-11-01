// Какая версия собрана (этап 86): нужно, чтобы по странице «Состояние» понять, та ли сборка сейчас работает.
//
// Откуда берём, по порядку:
// 1. APP_VERSION: владелец может вписать в переменные Timeweb что угодно понятное, например номер этапа;
// 2. BUILD_SHA: если когда-нибудь сборка начнёт передавать отпечаток коммита;
// 3. отпечаток сборки Next (.next/BUILD_ID): меняется с каждой сборкой сам, ничего настраивать не нужно.
// Ничего из этого нет — «неизвестна».

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const UNKNOWN_VERSION = "неизвестна";

export type VersionEnv = { APP_VERSION?: string; BUILD_SHA?: string };

/** Чистая часть: её проверяют тесты, чтение файла передаётся снаружи */
export function buildVersionFrom(env: VersionEnv, buildId: string | null): string {
  const named = (env.APP_VERSION ?? "").trim();
  if (named) return named.slice(0, 60);
  const sha = (env.BUILD_SHA ?? "").trim();
  if (sha) return sha.slice(0, 12);
  const id = (buildId ?? "").trim();
  if (id) return id.slice(0, 40);
  return UNKNOWN_VERSION;
}

/** Отпечаток сборки Next. Читается один раз: внутри работающего контейнера он не меняется */
let cached: string | null = null;

export function readBuildId(): string | null {
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function buildVersion(env: VersionEnv = process.env): string {
  if (cached === null) cached = buildVersionFrom(env, readBuildId());
  return cached;
}
