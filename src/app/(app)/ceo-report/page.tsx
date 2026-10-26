import { redirect } from "next/navigation";
import { isWeekKey } from "@/lib/weekly/weeks";

/**
 * Отчёт CEO стал отчётом руководителю (этап 73, решение Арама 23.10): старые ссылки (письма, события, закладки) ведут в
 * раздел «Отчёт руководителю», команда страхования и инвестиций, с той же неделей. Вкладку раздел выбирает сам:
 * тому, кто ведёт отчёт, «Текущая неделя», получателю «Полученные»
 */
export default async function CeoReportRedirect({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const params = await searchParams;
  const week = Array.isArray(params.week) ? params.week[0] : params.week;
  redirect(`/leader-report?team=top${isWeekKey(week) ? `&week=${week}` : ""}`);
}
