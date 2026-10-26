import { redirect } from "next/navigation";
import { isWeekKey } from "@/lib/weekly/weeks";

/**
 * Старый адрес вкладки «Отчёт по моей команде» (этап 73а). Решение Арама 26.10: полученные отчёты живут в отдельном
 * пункте меню «Отчёт руководителю», вкладка «Полученные». Неделя и команда сохраняются
 */
export default async function ReceivedWeeklyRedirect({ searchParams }: { searchParams: Promise<{ week?: string | string[]; team?: string | string[] }> }) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const week = one(params.week);
  const team = one(params.team);
  const query = new URLSearchParams({ tab: "received" });
  if (isWeekKey(week)) query.set("week", week);
  if (team && /^[\w-]{1,64}$/.test(team)) query.set("people", team);
  redirect(`/leader-report?${query.toString()}`);
}
