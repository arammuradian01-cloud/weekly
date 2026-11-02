import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { OWNER_ROLES } from "@/lib/roles";
import { PageHeader } from "@/components/page-header";
import { StatusPanel, type StatusView } from "@/components/admin/status-view";
import { databaseAlive, healthMarks } from "@/lib/health";
import { buildVersion } from "@/lib/build-version";
import { alertsConfigured } from "@/lib/alerts";
import { cspMode, hstsValue } from "@/lib/security";
import { reloadAllowed } from "@/lib/admin/reload";
import { errorTotals, recentErrors } from "@/lib/errors";
import { loadDepartmentGate } from "@/lib/sheet/department";

export const metadata: Metadata = { title: "Состояние" };
export const dynamic = "force-dynamic";

/** Страница «Состояние» (этап 86): владельцу видно, жива ли база, когда была проверка, что собрано и что сбоило */

/** Проверки не приходили дольше этого — говорим об этом прямо: наблюдения нет */
const STALE_CHECK_MS = 30 * 60_000;

function moscow(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(" в ", ", ");
}

function ago(iso: string, now: Date): string {
  const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  return moscow(iso);
}

export default async function StatusPage() {
  await requireManagement(OWNER_ROLES, "/status");
  const now = new Date();
  // Страница только спрашивает базу и ничего не отмечает: иначе она затирала бы отметку, которую сама показывает,
  // и «последняя удачная проверка» всегда была бы моментом открытия страницы. Отметку ставит только /api/health
  const [db, marks, totals, errors, gate] = await Promise.all([databaseAlive(), healthMarks(), errorTotals(now), recentErrors(30), loadDepartmentGate()]);
  const view: StatusView = {
    db,
    lastOk: marks.lastOkAt
      ? { ago: ago(marks.lastOkAt, now), at: moscow(marks.lastOkAt), stale: now.getTime() - new Date(marks.lastOkAt).getTime() > STALE_CHECK_MS }
      : null,
    lastFail: marks.lastFailAt ? moscow(marks.lastFailAt) : null,
    version: buildVersion(),
    alerts: alertsConfigured(),
    csp: cspMode(),
    hsts: hstsValue(),
    reload: reloadAllowed(),
    mirror: { on: gate.on, name: gate.name },
    totals,
    errors: errors.map((e) => ({
      id: e.id,
      sourceLabel: e.sourceLabel,
      message: e.message,
      place: e.place,
      stack: e.stack,
      times: e.times,
      at: moscow(e.lastAt),
      firstAt: moscow(e.firstAt),
    })),
  };
  return (
    <>
      <PageHeader title="Состояние" description="Жива ли база, когда была последняя удачная проверка, какая версия собрана и какие сбои случились" />
      <StatusPanel view={view} />
    </>
  );
}
