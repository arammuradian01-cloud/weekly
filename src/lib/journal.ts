// Журнал для страницы «Журнал»: события из базы в виде, понятном экрану (раздел 6 ТЗ).
// Фильтры и подгрузка идут на сервере: журнал хранится без срока, за год это десятки тысяч строк.

import { prisma } from "./db";
import { AUDIT_ACTION_LABELS } from "./audit";
import { moscowIso, moscowTime } from "./tasks/dates";
import { weekNumberOf } from "./weekly/weeks";
import { DICT_TITLES } from "./admin/labels";
import type { EditableDictKind } from "@/domain/dictionaries";
import type { JournalEvent, PersonSlug } from "@/domain/types";
import type { ChangeSource, Prisma } from "@/generated/prisma/client";

export type JournalKind = JournalEvent["kind"];
export type JournalFilter = {
  /** Короткое имя человека или «system» */
  who?: string;
  /** Дней назад от сегодня; пусто: всё время */
  days?: number;
  kind?: JournalKind;
  source?: JournalEvent["source"];
  /** Сколько событий показать, новые сверху */
  limit?: number;
};

const LOGIN_PREFIXES = ["login", "management", "profile.choose", "logout", "auth."];
const SETTINGS_PREFIXES = ["password", "setup", "settings", "export"];
const KNOWN_PREFIXES = ["task.", "weekly.", "ceo.", "sync", ...LOGIN_PREFIXES, ...SETTINGS_PREFIXES];

function kindOf(action: string): JournalKind {
  if (action === "task.comment") return "comment";
  if (action.startsWith("task.")) return "task";
  if (action.startsWith("weekly.") || action.startsWith("ceo.")) return "weekly";
  if (LOGIN_PREFIXES.some((p) => action.startsWith(p))) return "login";
  if (SETTINGS_PREFIXES.some((p) => action.startsWith(p))) return "settings";
  if (action.startsWith("sync")) return "sync";
  return "system";
}

const starts = (prefixes: string[]): Prisma.AuditLogWhereInput[] => prefixes.map((p) => ({ action: { startsWith: p } }));

/** Условие базы для типа события: то же деление, что в kindOf */
function kindWhere(kind: JournalKind): Prisma.AuditLogWhereInput {
  switch (kind) {
    case "comment":
      return { action: "task.comment" };
    case "task":
      return { AND: [{ action: { startsWith: "task." } }, { action: { not: "task.comment" } }] };
    case "weekly":
      return { OR: starts(["weekly.", "ceo."]) };
    case "login":
      return { OR: starts(LOGIN_PREFIXES) };
    case "settings":
      return { OR: starts(SETTINGS_PREFIXES) };
    case "sync":
      return { action: { startsWith: "sync" } };
    case "system":
      return { NOT: { OR: starts(KNOWN_PREFIXES) } };
  }
}

const SOURCE_DB: Record<JournalEvent["source"], ChangeSource> = { app: "APP", sheet: "SHEET", system: "SYSTEM" };

const text = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v));
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export type JournalPage = { events: JournalEvent[]; total: number; limit: number };

/** Фильтры экрана журнала, как они записаны в адресе страницы */
export type JournalQuery = { who: string; period: "7" | "30" | "all"; kind: JournalKind | ""; source: JournalEvent["source"] | ""; n: number };

/** События журнала по фильтрам, новые сверху, с общим числом подходящих */
export async function journalEvents(filter: JournalFilter = {}, now = new Date()): Promise<JournalPage> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 5000);
  const people = await prisma.person.findMany({ select: { id: true, slug: true, fullName: true } });
  const and: Prisma.AuditLogWhereInput[] = [];
  if (filter.who === "system") and.push({ actorId: null });
  else if (filter.who) and.push({ actorId: people.find((p) => p.slug === filter.who)?.id ?? "-" });
  if (filter.days) and.push({ at: { gte: new Date(now.getTime() - filter.days * 86_400_000) } });
  if (filter.kind) and.push(kindWhere(filter.kind));
  if (filter.source) and.push({ source: SOURCE_DB[filter.source] });
  const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], take: limit }),
    prisma.auditLog.count({ where }),
  ]);

  // Подписи объектов: что за запись weekly, какое значение справочника, какой человек
  const entryIds = [...new Set(rows.filter((r) => r.entity === "weekly-entry" && r.entityId).map((r) => r.entityId!))];
  const entries = entryIds.length ? await prisma.weeklyEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, what: true } }) : [];
  const dictKeys = rows.filter((r) => r.entity === "dict" && r.entityId).map((r) => r.entityId!.split("/"));
  const dicts = dictKeys.length
    ? await prisma.dictionaryItem.findMany({ where: { OR: dictKeys.map(([kind, code]) => ({ kind: kind as EditableDictKind, code })) } })
    : [];

  const slugOf = new Map(people.map((p) => [p.id, p.slug as PersonSlug]));
  const nameOf = (slug: string) => people.find((p) => p.slug === slug)?.fullName ?? slug;
  const whatOf = new Map(entries.map((e) => [e.id, e.what]));

  function objectOf(entity: string | null, id: string | null, action: string, before: unknown): string {
    if (entity === "task" && id) return `Задача ${id}`;
    if (entity === "weekly" && id) {
      const [week, slug] = id.split("/");
      return `Weekly за неделю ${week ? weekNumberOf(week) : ""}${slug ? `, ${nameOf(slug)}` : ""}`;
    }
    if (entity === "week" && id) return `Неделя ${weekNumberOf(id)}`;
    if (entity === "weekly-entry") {
      const what = (id && whatOf.get(id)) ?? (typeof before === "string" ? before : null);
      return what ? `Запись weekly «${short(what)}»` : "Запись weekly";
    }
    if (entity === "ceo-report" && id) return `Отчёт CEO, неделя ${weekNumberOf(id)}`;
    if (entity === "dict" && id) {
      const [kind, code] = id.split("/");
      const item = dicts.find((d) => d.kind === kind && d.code === code);
      return `Справочник «${DICT_TITLES[kind as EditableDictKind] ?? kind}»${item ? `: ${item.label}` : ""}`;
    }
    // Входы и ссылки: что случилось и с кем, «Человек: ...» здесь ничего не говорит
    if (entity === "person" && id && action.startsWith("auth.")) return `${AUDIT_ACTION_LABELS[action] ?? action}: ${nameOf(id)}`;
    if (entity === "person" && id) return `Человек: ${nameOf(id)}`;
    if (entity === "settings") {
      if (id === "stand.banner") return "Плашка над страницами";
      if (id === "auth.teamLogin") return "Вход: общий логин team";
      return "Ритм недели";
    }
    if (entity === "data") return "Задачи и weekly";
    if (entity === "export") return "Выгрузка в Excel";
    if (entity === "sheet") {
      if (action === "sync.settings") return "Google-таблица: подключение";
      if (action === "sync.bord") return "Bord: забор задач";
      if (action === "sync.rebuild") return "Google-таблица: все вкладки";
      const [tab, key] = (id ?? "").split("/");
      if (!tab) return "Google-таблица";
      if (key === "шапка") return `Google-таблица, вкладка «${tab}»: шапка`;
      if (key && tab === "Задачи") return `Google-таблица, вкладка «${tab}»: задача ${key}`;
      return `Google-таблица, вкладка «${tab}»`;
    }
    return AUDIT_ACTION_LABELS[action] ?? action;
  }

  const events = rows.map((r) => ({
    id: `a${r.id}`,
    at: moscowIso(r.at),
    time: moscowTime(r.at),
    by: (r.actorId && slugOf.get(r.actorId)) || "system",
    source: r.source === "SHEET" ? "sheet" : r.source === "SYSTEM" ? "system" : "app",
    kind: kindOf(r.action),
    object: objectOf(r.entity, r.entityId, r.action, r.before),
    field: r.entity ? (r.field ?? undefined) : undefined,
    before: text(r.before),
    after: text(r.after),
    ip: r.ip ?? undefined,
    via: r.via ? (r.via === "TEAM" ? "team" : "personal") : undefined,
  })) satisfies JournalEvent[];
  return { events, total, limit };
}

/** Люди для фильтра «Кто»: все, кто есть в базе, включая выключенных: их правки остаются в журнале */
export async function journalPeople(): Promise<{ slug: string; fullName: string; active: boolean }[]> {
  return prisma.person.findMany({ select: { slug: true, fullName: true, active: true }, orderBy: [{ active: "desc" }, { sortOrder: "asc" }] });
}
