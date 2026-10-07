// «Изменилось за неделю» и история статусов задачи (этап 16). Всё берётся из журнала: он только дописывается,
// поэтому новые, закрытые, перенесённые и сменившие статус задачи видны с автором, временем, было и стало.

import { prisma } from "@/lib/db";
import { CLOSED_STATUSES, STATUSES, type StatusCode } from "@/domain/dictionaries";
import type { PersonSlug } from "@/domain/types";
import { loadScope, TOP_TEAM, visibleTasksWhere } from "@/lib/org/scope";
import type { Prisma } from "@/generated/prisma/client";
import type { TaskReader } from "./service";

export type ChangeKind = "new" | "closed" | "status" | "due" | "owner" | "team";

export type TaskChange = {
  id: string;
  number: number;
  title: string;
  team: string;
  kind: ChangeKind;
  field: string;
  before: string | null;
  after: string | null;
  by: string;
  bySlug: PersonSlug | null;
  at: string;
};

const NEW_ACTIONS = ["task.create", "task.propose", "task.import"];
const FIELDS: Record<string, ChangeKind> = {
  Статус: "status",
  Срок: "due",
  Ответственный: "owner",
  Команда: "team",
  // Отмена правки возвращает прежнее значение: это тоже смена статуса или срока
  "Статус (отмена)": "status",
  "Срок (отмена)": "due",
};
const CLOSED_LABELS = STATUSES.filter((s) => CLOSED_STATUSES.includes(s.code)).map((s) => s.label);

/**
 * Изменения задач за последние дни в выбранных командах (null: во всех видимых). Как и история в карточке, видна
 * участникам задачи, руководителю команды задачи и руководителю ответственного, владельцу и администраторам.
 * Архивные задачи не показываем: их видит только владелец
 */
export async function recentChanges(
  reader: TaskReader & { management?: boolean },
  teamIds: string[] | null,
  opts: { days?: number; now?: Date } = {},
): Promise<{ since: string; changes: TaskChange[] }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.days ?? 7) * 24 * 60 * 60 * 1000);
  const scope = await loadScope(prisma, { id: reader.personId, role: reader.role, limited: reader.limited });
  if (reader.role === "OBSERVER") return { since: since.toISOString(), changes: [] };
  const me = reader.personId;
  const historyOf: Prisma.TaskWhereInput = reader.management
    ? {}
    : {
        OR: [
          { teamId: { in: scope.leads } },
          { ownerId: me },
          { ownerId: null },
          { createdById: me },
          { coExecutors: { some: { personId: me } } },
          ...(scope.leadPeople.length ? [{ ownerId: { in: scope.leadPeople }, teamId: { not: TOP_TEAM } }] : []),
        ],
      };
  const tasks = await prisma.task.findMany({
    where: { AND: [{ archivedAt: null }, visibleTasksWhere(scope, me), historyOf, teamIds ? { teamId: { in: teamIds } } : {}] },
    select: { number: true, title: true, teamId: true, createdAt: true },
  });
  if (!tasks.length) return { since: since.toISOString(), changes: [] };
  const byNumber = new Map(tasks.map((t) => [String(t.number), t]));
  const rows = await prisma.auditLog.findMany({
    where: {
      entity: "task",
      entityId: { in: [...byNumber.keys()] },
      at: { gte: since },
      OR: [{ action: { in: NEW_ACTIONS } }, { action: { in: ["task.update", "task.bord"] }, field: { in: Object.keys(FIELDS) } }],
    },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: 500,
  });
  const actors = await prisma.person.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))] } }, select: { id: true, slug: true } });
  const slugOf = new Map(actors.map((a) => [a.id, a.slug as PersonSlug]));
  // Номер мог принадлежать удалённой задаче (повторный импорт): записи журнала старше самой задачи не её
  const own = rows.filter((r) => r.at.getTime() >= byNumber.get(r.entityId ?? "")!.createdAt.getTime() - 1000);
  return {
    since: since.toISOString(),
    changes: own.map((r) => {
      const task = byNumber.get(r.entityId ?? "")!;
      const after = typeof r.after === "string" ? r.after : r.after == null ? null : JSON.stringify(r.after);
      const before = typeof r.before === "string" ? r.before : r.before == null ? null : JSON.stringify(r.before);
      let kind: ChangeKind = NEW_ACTIONS.includes(r.action) ? "new" : (FIELDS[r.field ?? ""] ?? "status");
      if (kind === "status" && after && CLOSED_LABELS.some((l) => after.startsWith(l))) kind = "closed";
      return {
        id: String(r.id),
        number: task.number,
        title: task.title,
        team: task.teamId,
        kind,
        field: r.field ?? "",
        before,
        after,
        by: r.actorName ?? "Система",
        bySlug: r.actorId ? (slugOf.get(r.actorId) ?? null) : null,
        at: r.at.toISOString(),
      };
    }),
  };
}

export type StatusSpan = { status: StatusCode; label: string; days: number; current: boolean };

/**
 * Сколько дней задача была в каждом статусе: от создания по записям журнала «Статус». Статус задачи из таблицы
 * до запуска ресурса считается с даты создания задачи в ресурсе
 */
export function statusSpans(created: Date, changes: { at: Date; after: string | null }[], current: StatusCode, now = new Date(), initial: StatusCode = "in-progress"): StatusSpan[] {
  const labelOf = (code: StatusCode) => STATUSES.find((s) => s.code === code)!.label;
  const codeOf = (text: string | null): StatusCode | null => {
    if (!text) return null;
    const hit = STATUSES.find((s) => text === s.label || text.startsWith(`${s.label}.`));
    return hit?.code ?? null;
  };
  const sorted = [...changes].sort((a, b) => a.at.getTime() - b.at.getTime());
  const spans = new Map<StatusCode, number>();
  let status = initial;
  let from = created;
  for (const c of sorted) {
    const next = codeOf(c.after);
    if (!next) continue;
    spans.set(status, (spans.get(status) ?? 0) + Math.max(0, c.at.getTime() - from.getTime()));
    status = next;
    from = c.at;
  }
  // Статус после последней записи должен совпасть с нынешним; если нет (правили в таблице), берём нынешний
  if (status !== current) status = current;
  spans.set(status, (spans.get(status) ?? 0) + Math.max(0, now.getTime() - from.getTime()));
  const day = 24 * 60 * 60 * 1000;
  return [...spans.entries()]
    .filter(([code, ms]) => ms > 0 || code === current)
    .map(([code, ms]) => ({ status: code, label: labelOf(code), days: Math.round((ms / day) * 10) / 10, current: code === current }));
}

/** История статусов задачи для карточки */
export async function taskStatusSpans(number: number, now = new Date()): Promise<StatusSpan[]> {
  const task = await prisma.task.findUnique({ where: { number }, select: { createdAt: true, status: true } });
  if (!task) return [];
  const rows = await prisma.auditLog.findMany({
    where: { entity: "task", entityId: String(number), field: { in: ["Статус", "Статус (отмена)"] }, action: { in: ["task.update", "task.bord", "task.undo"] } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { at: true, after: true, action: true, before: true },
  });
  const created = await prisma.auditLog.findFirst({
    where: { entity: "task", entityId: String(number), action: { in: NEW_ACTIONS } },
    orderBy: { at: "desc" },
    select: { at: true, action: true },
  });
  const start = created?.at ?? task.createdAt;
  const current = STATUS_CODE[task.status];
  const initial: StatusCode = created?.action === "task.propose" ? "proposed" : "in-progress";
  return statusSpans(
    start,
    rows.filter((r) => r.at >= start).map((r) => ({ at: r.at, after: typeof r.after === "string" ? r.after : null })),
    current,
    now,
    initial,
  );
}

const STATUS_CODE: Record<string, StatusCode> = { PROPOSED: "proposed", IN_PROGRESS: "in-progress", CLARIFY: "clarify", DONE: "done", PARTIAL: "partial", FAILED: "failed", CANCELLED: "cancelled" };
