import { redirect } from "next/navigation";
import { isWeekKey } from "@/lib/weekly/weeks";

/**
 * Weekly команды по блокам (этап 66) живёт в разделе «Отчёт руководителю» (этап 73): каждый руководитель делает отчёт
 * своему руководителю там же. Старые ссылки ведут туда с той же командой и неделей; view=current открывает текущую
 * версию, без неё получатель увидит отправленную во вкладке «Полученные»
 */
export default async function TeamReportRedirect({ searchParams }: { searchParams: Promise<{ team?: string | string[]; week?: string | string[]; view?: string | string[] }> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const query = new URLSearchParams();
  const team = one(params.team);
  const week = one(params.week);
  if (team) query.set("team", team);
  if (isWeekKey(week)) query.set("week", week);
  if (one(params.view) === "current") query.set("tab", "current");
  redirect(`/leader-report${query.size ? `?${query.toString()}` : ""}`);
}
