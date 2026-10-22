// Кто видит раздел «Рынок» (этап 62). Решение Арама 22.10: рынок КАСКО и ОСАГО открыт только отдельным людям.
// Видят: владельцы всегда и люди из списка, который ведёт владелец в «Настройках»; только при личном входе, по
// общему логину раздела нет. Тех, кому раздел закрыт, не пускают ни страница, ни обработчик данных.
// Там же владелец выбирает команды, у которых на первой встрече месяца первым пунктом встаёт разбор рынка: по
// умолчанию топ-команда.

import type { Prisma } from "@/generated/prisma/client";
import type { LoginMethod, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { TOP_TEAM } from "@/domain/teams";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { auditVia } from "@/lib/audit";

type Db = Prisma.TransactionClient | typeof prisma;

export const MARKET_ACCESS_KEY = "market.access";
export const MARKET_MEETING_KEY = "market.meeting";

export const MARKET_CLOSED_TEXT = "Раздел открыт отдельным людям, доступ даёт владелец.";
export const MARKET_TEAM_LOGIN_TEXT = "По общему логину раздела нет: он открывается только при личном входе.";

export type MarketAccess = { people: string[] };
export type MarketMeeting = { teamIds: string[] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))].slice(0, 500) : []);

export function marketAccessOf(value: unknown): MarketAccess {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { people: strings(raw.people) };
}

/** Команды встречи: пока владелец не сохранил настройку, это топ-команда */
export function marketMeetingOf(value: unknown): MarketMeeting {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return { teamIds: raw && Array.isArray(raw.teamIds) ? strings(raw.teamIds) : [TOP_TEAM] };
}

export async function loadMarketAccess(db: Db = prisma): Promise<MarketAccess> {
  return marketAccessOf((await db.setting.findUnique({ where: { key: MARKET_ACCESS_KEY } }))?.value);
}

export async function loadMarketMeeting(db: Db = prisma): Promise<MarketMeeting> {
  return marketMeetingOf((await db.setting.findUnique({ where: { key: MARKET_MEETING_KEY } }))?.value);
}

export type MarketViewer = { slug: string; role: Role; active?: boolean; via?: LoginMethod | null };

/** Открыт ли раздел: личный вход, включённый профиль, владелец или человек из списка */
export function canSeeMarketWith(viewer: MarketViewer, access: MarketAccess): boolean {
  if (!viewer.via || viewer.via === "TEAM") return false;
  if (viewer.active === false) return false;
  return viewer.role === "OWNER" || access.people.includes(viewer.slug);
}

/** То же по базе: профиль перечитывается, выключенный человек раздел не видит */
export async function canSeeMarket(viewer: { personId: string; via?: LoginMethod | null }, db: Db = prisma): Promise<boolean> {
  if (!viewer.via || viewer.via === "TEAM") return false;
  const [person, access] = await Promise.all([db.person.findUnique({ where: { id: viewer.personId }, select: { slug: true, role: true, active: true } }), loadMarketAccess(db)]);
  if (!person) return false;
  return canSeeMarketWith({ ...person, via: viewer.via }, access);
}

/** Загружает пакет рынка владелец при личном входе: режим управления не нужен, общий логин не годится */
export function canUploadMarket(actor: Pick<Actor, "role" | "via">): boolean {
  return actor.role === "OWNER" && !!actor.via && actor.via !== "TEAM";
}

// ---------- Настройка (владелец в режиме управления) ----------

export type MarketSettingsView = {
  people: string[];
  teamIds: string[];
  /** Все включённые люди для выбора */
  options: { slug: string; name: string; hint: string | null }[];
  teams: { id: string; name: string }[];
  /** Сколько человек видят раздел при личном входе: владельцы и люди из списка */
  count: number;
  owners: number;
  /** Люди и команды из настройки, которых больше нет или они выключены: доступ и пункт у них молча не работают */
  stale: { people: number; teams: number };
};

export async function marketSettingsView(db: Db = prisma): Promise<MarketSettingsView> {
  const [access, meeting, people, teams] = await Promise.all([
    loadMarketAccess(db),
    loadMarketMeeting(db),
    db.person.findMany({ where: { active: true }, select: { slug: true, fullName: true, position: true, role: true }, orderBy: { fullName: "asc" } }),
    db.team.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
  ]);
  const known = new Set(people.map((p) => p.slug));
  const knownTeams = new Set(teams.map((t) => t.id));
  const owners = people.filter((p) => p.role === "OWNER").length;
  const listed = access.people.filter((s) => known.has(s));
  return {
    // В форме только то, что есть сейчас: при сохранении устаревшие ссылки уходят
    people: listed,
    teamIds: meeting.teamIds.filter((id) => knownTeams.has(id)),
    options: people.map((p) => ({ slug: p.slug, name: p.fullName, hint: p.position })),
    teams,
    count: owners + people.filter((p) => p.role !== "OWNER" && listed.includes(p.slug)).length,
    owners,
    stale: { people: access.people.length - listed.length, teams: meeting.teamIds.filter((id) => !knownTeams.has(id)).length },
  };
}

export async function saveMarketSettings(actor: Actor, input: { people: string[]; teamIds: string[] }): Promise<MarketSettingsView> {
  if (actor.management !== "OWNER" || actor.role === "OBSERVER") throw new TaskRuleError("Доступ к рынку настраивает владелец в режиме управления");
  const people = new Map((await prisma.person.findMany({ where: { active: true }, select: { slug: true, fullName: true } })).map((p) => [p.slug, p.fullName]));
  const teams = new Map((await prisma.team.findMany({ where: { active: true }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
  const next: MarketAccess = { people: strings(input?.people).filter((s) => people.has(s)) };
  const nextMeeting: MarketMeeting = { teamIds: strings(input?.teamIds).filter((id) => teams.has(id)) };
  await prisma.$transaction(async (tx) => {
    const before = await loadMarketAccess(tx);
    const beforeMeeting = await loadMarketMeeting(tx);
    await tx.setting.upsert({ where: { key: MARKET_ACCESS_KEY }, update: { value: next }, create: { key: MARKET_ACCESS_KEY, value: next } });
    await tx.setting.upsert({ where: { key: MARKET_MEETING_KEY }, update: { value: nextMeeting }, create: { key: MARKET_MEETING_KEY, value: nextMeeting } });
    const names = (ids: string[], map: Map<string, string>, empty: string) => ids.map((id) => map.get(id) ?? id).join(", ") || empty;
    const lines: [string, string, string, string][] = [
      ["settings.marketAccess", "Рынок: люди с доступом", names(before.people, people, "только владельцы"), names(next.people, people, "только владельцы")],
      ["settings.marketMeeting", "Рынок: разбор на первой встрече месяца", names(beforeMeeting.teamIds, teams, "ни у кого"), names(nextMeeting.teamIds, teams, "ни у кого")],
    ];
    for (const [action, field, from, to] of lines) {
      if (from === to) continue;
      await tx.auditLog.create({
        data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "settings", entityId: action === "settings.marketAccess" ? MARKET_ACCESS_KEY : MARKET_MEETING_KEY, field, before: from.slice(0, 1000), after: to.slice(0, 1000), ip: actor.ip ?? null, ...auditVia(actor) },
      });
    }
  });
  return marketSettingsView();
}
