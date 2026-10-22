import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { OWNER_ROLES } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { PageTabs, StatusLine, type StatusItem } from "@/components/ui/data";
import { SyncStatus, type SyncView } from "@/components/admin/sync-status";
import { SYNC_TABS, type SyncTab } from "@/components/admin/sync-tabs";
import { LAG_WARNING_MS, syncStatus, type SyncRun } from "@/lib/sheet/runner";
import { PROD_SHEET_ID } from "@/lib/sheet/client";
import { bordStatus } from "@/lib/bord/service";
import { RESOURCE_FIRST_NUMBER } from "@/lib/bord/pull";
import type { BordView } from "@/components/admin/bord-pull";
import type { NumbersView } from "@/components/admin/numbers-setup";
import { METRICS_MAX, numbersStatus } from "@/lib/numbers/service";

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


export default async function SyncPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // Этап 48: три связи вкладками, адрес ?tab= пересылаемый. Этап 50: вкладка переживает ввод пароля режима управления
  const tab: SyncTab = SYNC_TABS.find((t) => t === sp.tab) ?? "bord";
  await requireManagement(OWNER_ROLES, tab === "bord" ? "/sync" : `/sync?tab=${tab}`);
  const now = new Date();
  const [status, bord, numbers, tasks, comments, entries] = await Promise.all([
    syncStatus(now),
    bordStatus(now),
    numbersStatus(now),
    prisma.task.count({ where: { archivedAt: null } }),
    prisma.taskComment.count({ where: { task: { archivedAt: null } } }),
    prisma.weeklyEntry.count(),
  ]);
  const s = bord.state;
  const failed = s.ok === false && s.lastAttemptAt;
  const bordView: BordView = {
    sourceId: bord.sourceId,
    connected: bord.connected,
    auto: bord.auto,
    hasKey: bord.hasKey,
    serviceEmail: bord.serviceEmail,
    working: bord.sourceId === PROD_SHEET_ID,
    lastOk: s.lastOkAt ? { ago: ago(s.lastOkAt, now), at: moscow(s.lastOkAt) } : null,
    next: bord.nextAt ? (new Date(bord.nextAt).getTime() - now.getTime() < 60_000 ? "в ближайшую минуту" : moscow(bord.nextAt)) : null,
    error: failed ? { at: moscow(s.lastAttemptAt!), message: s.error ?? "Ошибка" } : null,
    report: s.report,
    history: s.history.slice(0, 15).map((h) => ({
      at: moscow(h.at),
      how: h.how === "manual" ? "кнопкой" : "по расписанию",
      ok: h.ok,
      text: !h.ok ? (h.error ?? "Ошибка") : h.created || h.updated ? `новых ${h.created}, изменено ${h.updated}` : "изменений не было",
    })),
    firstNumber: RESOURCE_FIRST_NUMBER,
  };
  const ns = numbers.state;
  const numbersView: NumbersView = {
    sourceId: numbers.sourceId,
    tab: numbers.tab,
    connected: numbers.connected,
    hasKey: numbers.hasKey,
    serviceEmail: numbers.serviceEmail,
    lastOk: ns.lastOkAt ? { ago: ago(ns.lastOkAt, now), at: moscow(ns.lastOkAt) } : null,
    next: numbers.nextAt ? (new Date(numbers.nextAt).getTime() - now.getTime() < 60_000 ? "в ближайшую минуту" : moscow(numbers.nextAt)) : null,
    error: ns.ok === false && ns.lastAttemptAt ? { at: moscow(ns.lastAttemptAt), message: ns.error ?? "Ошибка" } : null,
    rows: ns.rows,
    weeks: ns.weeks,
    latestWeek: ns.latestWeek,
    metrics: numbers.metrics,
    metricsMax: METRICS_MAX,
  };
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
    bord: bordView,
    numbers: numbersView,
  };
  // Этап 48: состояние трёх связей одной строкой вместо плиток, каждое ведёт на свою вкладку
  const bordState: StatusItem = !bordView.connected
    ? { label: "Задачи из Bord", value: "не подключён", tone: "muted", href: "/sync?tab=bord", testId: "sync-status-bord" }
    : !bordView.auto
      ? { label: "Задачи из Bord", value: "забор выключен", hint: "главное приложение", tone: "muted", href: "/sync?tab=bord", testId: "sync-status-bord" }
      : bordView.error
        ? { label: "Задачи из Bord", value: "забор не прошёл", hint: bordView.error.at, tone: "danger", href: "/sync?tab=bord", testId: "sync-status-bord" }
        : bordView.lastOk
          ? { label: "Задачи из Bord", value: `забор ${bordView.lastOk.ago}`, tone: "ok", href: "/sync?tab=bord", testId: "sync-status-bord" }
          : { label: "Задачи из Bord", value: "первый забор в течение минуты", tone: "warning", href: "/sync?tab=bord", testId: "sync-status-bord" };
  const numbersState: StatusItem = !numbersView.connected
    ? { label: "Цифры недели", value: "не подключены", tone: "muted", href: "/sync?tab=numbers", testId: "sync-status-numbers" }
    : numbersView.error
      ? { label: "Цифры недели", value: "чтение не прошло", hint: numbersView.error.at, tone: "danger", href: "/sync?tab=numbers", testId: "sync-status-numbers" }
      : numbersView.lastOk
        ? { label: "Цифры недели", value: `чтение ${numbersView.lastOk.ago}`, hint: `выбрано ${numbersView.metrics.length} из ${METRICS_MAX}`, tone: "ok", href: "/sync?tab=numbers", testId: "sync-status-numbers" }
        : { label: "Цифры недели", value: "первое чтение скоро", tone: "warning", href: "/sync?tab=numbers", testId: "sync-status-numbers" };
  const mirrorState: StatusItem = !view.connected
    ? { label: "Таблица для просмотра", value: "не подключена", tone: "muted", href: "/sync?tab=mirror", testId: "sync-status-mirror" }
    : view.error
      ? { label: "Таблица для просмотра", value: `${view.error.kind.toLowerCase()} не прошла`, hint: view.error.at, tone: "danger", href: "/sync?tab=mirror", testId: "sync-status-mirror" }
      : view.lagging
        ? { label: "Таблица для просмотра", value: `в очереди ${view.queue.size}, ждёт ${view.queue.waitingMin} мин`, tone: "warning", href: "/sync?tab=mirror", testId: "sync-status-mirror" }
        : view.lastPush
          ? { label: "Таблица для просмотра", value: `выгрузка ${view.lastPush.ago}`, hint: view.queue.size ? `в очереди ${view.queue.size}` : undefined, tone: "ok", href: "/sync?tab=mirror", testId: "sync-status-mirror" }
          : { label: "Таблица для просмотра", value: "первая выгрузка в течение 30 секунд", tone: "warning", href: "/sync?tab=mirror", testId: "sync-status-mirror" };
  return (
    <>
      <PageHeader
        title="Синхронизация"
        description="Цифры недели в ресурс, задачи в таблицу для просмотра. В Bord и отчёт ресурс не пишет"
        figures={<StatusLine label="Состояние связей" items={[bordState, numbersState, mirrorState]} />}
        tabs={
          <PageTabs
            label="Связи"
            tabs={[
              { href: "/sync?tab=bord", label: "Bord", active: tab === "bord", testId: "sync-tab-bord" },
              { href: "/sync?tab=numbers", label: "Цифры недели", active: tab === "numbers", testId: "sync-tab-numbers" },
              { href: "/sync?tab=mirror", label: "Таблица для просмотра", active: tab === "mirror", testId: "sync-tab-mirror" },
            ]}
          />
        }
      />
      <SyncStatus view={view} tab={tab} />
    </>
  );
}
