import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { OWNER_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { SyncStatus, type SyncView } from "@/components/admin/sync-status";
import { LAG_WARNING_MS, syncStatus, type SyncRun } from "@/lib/sheet/runner";

export const metadata: Metadata = { title: "Синхронизация" };
export const dynamic = "force-dynamic";

const KIND: Record<SyncRun["kind"], string> = { push: "Выгрузка", reconcile: "Сверка", rebuild: "Пересборка" };

function moscow(iso: string, withDate = true): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    ...(withDate ? { day: "numeric", month: "long" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(" в ", ", ");
}

function ago(iso: string, now: Date): string {
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  return moscow(iso);
}

function resultOf(r: SyncRun): { text: string; tone: SyncView["runs"][number]["tone"] } {
  if (!r.finished) return { text: "идёт", tone: "pending" };
  if (!r.ok) return { text: r.error ?? "Ошибка", tone: "error" };
  if (r.kind === "reconcile") return r.fixed ? { text: `исправлено расхождений: ${r.fixed}`, tone: "warn" } : { text: "расхождений нет", tone: "ok" };
  return { text: r.items ? `строк записано: ${r.items}` : "изменений не было", tone: "ok" };
}

export default async function SyncPage() {
  await requireManagement(OWNER_ROLES, "/sync");
  const now = new Date();
  const [status, tasks, comments, entries] = await Promise.all([
    syncStatus(now),
    prisma.task.count({ where: { archivedAt: null } }),
    prisma.taskComment.count({ where: { task: { archivedAt: null } } }),
    prisma.weeklyEntry.count(),
  ]);
  const waitingMs = status.queue.oldestAt ? now.getTime() - new Date(status.queue.oldestAt).getTime() : null;
  const view: SyncView = {
    connected: status.mode !== null,
    imitation: status.imitation,
    spreadsheetId: status.spreadsheetId,
    serviceEmail: status.serviceEmail,
    hasKey: status.hasKey,
    queue: { size: status.queue.size, waitingMin: waitingMs === null ? null : Math.floor(waitingMs / 60_000) },
    lagging: waitingMs !== null && waitingMs >= LAG_WARNING_MS,
    lastPush: status.lastOkPushAt ? { ago: ago(status.lastOkPushAt, now), at: moscow(status.lastOkPushAt) } : null,
    reconcile: status.lastReconcile ? { at: moscow(status.lastReconcile.startedAt), ...resultOf(status.lastReconcile) } : null,
    nextReconcile: new Date(status.nextReconcileAt) <= now ? "в ближайшую минуту" : moscow(status.nextReconcileAt),
    error: status.lastError ? { at: moscow(status.lastError.startedAt), kind: KIND[status.lastError.kind], message: status.lastError.error ?? "Ошибка" } : null,
    runs: status.runs.map((r) => ({ id: r.id, at: moscow(r.startedAt), kind: KIND[r.kind], ...resultOf(r) })),
    counts: { tasks, comments, entries },
  };
  return (
    <>
      <PageHeader title="Синхронизация" description="Зеркало задач и weekly в копию Google-таблицы Insurance&Invest Bord, в одну сторону: таблицу пишет только ресурс" />
      <SyncStatus view={view} />
    </>
  );
}
