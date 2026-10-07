"use server";

// Переключатель команды в шапке (этап 14): выбор живёт в cookie, сервер проверяет, что команда человеку видна.

import { cookies } from "next/headers";
import { requireContext } from "@/lib/auth";
import { ALL_TEAMS, TEAM_COOKIE, currentTeam, subjectOf } from "@/lib/org/current";

export async function setTeamAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireContext();
  const team = await currentTeam(subjectOf(ctx));
  const allowed = id === ALL_TEAMS ? team.options.length > 1 : team.options.some((o) => o.id === id);
  if (!allowed) return { ok: false, error: "Эта команда вам не видна" };
  const jar = await cookies();
  jar.set(TEAM_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: 365 * 24 * 3600,
  });
  return { ok: true };
}
