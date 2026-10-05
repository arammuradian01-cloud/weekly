import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { CeoReport } from "@/components/ceo/ceo-report";

export const metadata: Metadata = { title: "Отчёт CEO" };

export default async function CeoReportPage() {
  await requireManagement(["OWNER", "ADMIN"], "/ceo-report");
  return (
    <>
      <PageHeader title="Отчёт CEO" description="Черновик из отмеченных записей weekly: цифры недели, главное, риски, что дальше" />
      <CeoReport />
    </>
  );
}
