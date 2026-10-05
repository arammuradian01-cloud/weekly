import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getMyWeekly, getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { WeeklyFeed } from "@/components/weekly/weekly-feed";

export const metadata: Metadata = { title: "Weekly" };

export default async function WeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { person } = await requireContext();
  const { week } = await searchParams;
  const view = await getWeekView(isWeekKey(week) ? week : null);
  const mine = await getMyWeekly(person.id, view.reportingKey);
  return <WeeklyFeed key={view.week.key} view={view} myReport={mine.report} />;
}
