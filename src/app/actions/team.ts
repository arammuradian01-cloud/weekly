"use server";

// Переключатель команды в шапке (этап 14): выбор живёт в cookie, сервер проверяет, что команда человеку видна.

import { cookies } from "next/headers";
import { requireContext } from "@/lib/auth";
import { ALL_TEAMS, TEAM_COOKIE, currentTeam, subjectOf } from "@/lib/org/current";
import { TEAM_VIEW_COOKIE } from "@/lib/view-as";

export async function setTeamAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireContext();
  const team = await currentTeam(subjectOf(ctx));
  const allowed = id === ALL_TEAMS ? team.options.length > 1 : team.options.some((o) => o.id === id);
  if (!allowed) return { ok: false, error: "Эта команда вам не видна" };
  const jar = await cookies();
  // В просмотре «Смотреть как» (этап 63) и во входе владельца в чужой профиль (этап 71) выбор пишется в отдельную cookie
  // на это время: команда владельца не меняется
  const until = ctx.viewAs?.until ?? ctx.ownerAs?.until ?? null;
  jar.set(until !== null ? TEAM_VIEW_COOKIE : TEAM_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: until !== null ? Math.max(60, Math.ceil((until - Date.now()) / 1000)) : 365 * 24 * 3600,
  });
  return { ok: true };
}
