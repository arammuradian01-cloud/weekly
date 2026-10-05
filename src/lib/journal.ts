// Журнал для страницы «Журнал»: события из базы в виде, понятном экрану (раздел 6 ТЗ).

import { prisma } from "./db";
import { AUDIT_ACTION_LABELS } from "./audit";
import { moscowIso, moscowTime } from "./tasks/dates";
import type { JournalEvent, PersonSlug } from "@/prototype/types";

function kindOf(action: string): JournalEvent["kind"] {
  if (action === "task.comment") return "comment";
  if (action.startsWith("task.")) return "task";
  if (action.startsWith("login") || action.startsWith("management") || action === "profile.choose" || action === "logout") return "login";
  if (action.startsWith("password") || action.startsWith("setup") || action.startsWith("settings")) return "settings";
  if (action.startsWith("sync")) return "sync";
  return "system";
}

const text = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v));

/** Последние события журнала, новые сверху */
export async function journalEvents(limit = 1000): Promise<JournalEvent[]> {
  const [rows, people] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: [{ at: "desc" }, { id: "desc" }], take: limit }),
    prisma.person.findMany({ select: { id: true, slug: true } }),
  ]);
  const slugOf = new Map(people.map((p) => [p.id, p.slug as PersonSlug]));
  return rows.map((r) => ({
    id: `a${r.id}`,
    at: moscowIso(r.at),
    time: r.source === "APP" ? moscowTime(r.at) : moscowTime(r.at),
    by: (r.actorId && slugOf.get(r.actorId)) || "system",
    source: r.source === "SHEET" ? "sheet" : r.source === "SYSTEM" ? "system" : "app",
    kind: kindOf(r.action),
    object: r.entity === "task" && r.entityId ? `Задача ${r.entityId}` : (AUDIT_ACTION_LABELS[r.action] ?? r.action),
    field: r.entity === "task" ? (r.field ?? undefined) : undefined,
    before: text(r.before),
    after: text(r.after),
    ip: r.ip ?? undefined,
  }));
}
