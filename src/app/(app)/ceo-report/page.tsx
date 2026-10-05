import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { ceoReportHistory, getCeoReport, getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { PageHeader } from "@/components/page-header";
import { CeoReport } from "@/components/ceo/ceo-report";

export const metadata: Metadata = { title: "Отчёт CEO" };

export default async function CeoReportPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireManagement(["OWNER", "ADMIN"], "/ceo-report");
  const { week } = await searchParams;
  const view = await getWeekView(isWeekKey(week) ? week : null);
  const [saved, history] = await Promise.all([getCeoReport(view.week.key), ceoReportHistory()]);
  return (
    <>
      <PageHeader title="Отчёт CEO" description="Черновик из отмеченных записей weekly: цифры недели, главное, риски, что дальше" />
      <CeoReport key={`${view.week.key}-${saved.updatedAt ?? ""}`} view={view} saved={saved} history={history} />
    </>
  );
}
