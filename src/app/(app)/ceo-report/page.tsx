import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Отчёт CEO" };

export default async function CeoReportPage() {
  await requireManagement(["OWNER", "ADMIN"], "/ceo-report");
  return (
    <>
      <PageHeader title="Отчёт CEO" description="Видят только владелец и администраторы. В Google-таблицу отчёт не выгружается." />
      <EmptyState title="Черновика пока нет" stage="Этап 4">
        Черновик соберётся из записей weekly с отметкой «В отчёт CEO» по разделам: цифры недели, главное, риски, что дальше. Текст правится от первого лица и копируется одной кнопкой.
      </EmptyState>
    </>
  );
}
