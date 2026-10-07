import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { ceoReportHistory, getCeoReport, getWeekView } from "@/lib/weekly/service";
import { promiseSummaries } from "@/lib/weekly/promise-service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { PageHeader } from "@/components/page-header";
import { CeoReport } from "@/components/ceo/ceo-report";
import { topAudience } from "@/lib/org/current";

export const metadata: Metadata = { title: "Отчёт CEO" };

export default async function CeoReportPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireManagement(["OWNER", "ADMIN"], "/ceo-report");
  const { week } = await searchParams;
  // Отчёт CEO собирается из weekly топ-команды, какая бы команда ни была выбрана
  const audience = await topAudience();
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audience);
  const [saved, history, promises] = await Promise.all([getCeoReport(view.week.key), ceoReportHistory(), promiseSummaries(view.week.key, audience.personIds)]);
  return (
    <>
      <PageHeader title="Отчёт CEO" description="Черновик из отмеченных записей weekly: цифры недели, обещания, главное, риски, что дальше" />
      <CeoReport key={`${view.week.key}-${saved.updatedAt ?? ""}`} view={view} saved={saved} history={history} promises={promises} />
    </>
  );
}
