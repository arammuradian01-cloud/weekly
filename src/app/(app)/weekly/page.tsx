import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { formatWeekRange, reportingWeek, type DeadlineSetting } from "@/lib/week";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "Weekly" };

export default async function WeeklyPage() {
  await requireContext();
  const deadline = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const week = reportingWeek(new Date(), deadline);
  return (
    <>
      <PageHeader title="Weekly" description={`Лента недели ${week.week}, ${formatWeekRange(week)}`} />
      <EmptyState title="Лента пока пустая" stage="Этап 4">
        Здесь будут итоги недели от каждого: по людям и по блокам, сверху запросы помощи и риски. Отсюда же включается режим встречи для показа на экране.
      </EmptyState>
    </>
  );
}
