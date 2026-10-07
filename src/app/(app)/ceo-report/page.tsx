import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { ceoReportHistory, getCeoReport, getWeekView } from "@/lib/weekly/service";
import { promiseHistory, weekPromises } from "@/lib/weekly/promise-service";
import { shiftWeek } from "@/lib/weekly/weeks";
import { isWeekKey } from "@/lib/weekly/weeks";
import { PageHeader } from "@/components/page-header";
import { CeoReport } from "@/components/ceo/ceo-report";
import { topAudience } from "@/lib/org/current";
import { weekNumbers } from "@/lib/numbers/service";
import { forecastSummary } from "@/lib/forecast/service";

export const metadata: Metadata = { title: "Отчёт CEO" };

export default async function CeoReportPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireManagement(["OWNER", "ADMIN"], "/ceo-report");
  const { week } = await searchParams;
  // Отчёт CEO собирается из weekly топ-команды, какая бы команда ни была выбрана
  const audience = await topAudience();
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audience);
  // Личную статистику «обещал и сделал» видит только директор (этап 22): это диагностика, а не рейтинг
  const owner = ctx.management?.role === "OWNER";
  const [saved, history, promises, stats, numbers, forecast] = await Promise.all([
    getCeoReport(view.week.key),
    ceoReportHistory(),
    weekPromises(view.week.key, audience.personIds),
    // То же окно, что у человека на «Моей неделе»: только законченные недели
    owner ? promiseHistory(audience.personIds, view.week.key < view.reportingKey ? view.week.key : shiftWeek(view.reportingKey, -1)) : Promise.resolve(undefined),
    // Цифры недели и прогноз (этап 24)
    weekNumbers(view.week.key),
    forecastSummary(view.week.key, audience),
  ]);
  return (
    <>
      <PageHeader title="Отчёт CEO" description="Черновик из отмеченных записей weekly: цифры недели, обещания, главное, риски, что дальше" />
      <CeoReport key={`${view.week.key}-${saved.updatedAt ?? ""}`} view={view} saved={saved} history={history} promises={promises} stats={stats} numbers={numbers} forecast={forecast} owner={owner} />
    </>
  );
}
