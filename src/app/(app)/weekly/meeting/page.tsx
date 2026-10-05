import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { MeetingMode } from "@/components/weekly/meeting-mode";

export const metadata: Metadata = { title: "Режим встречи" };

export default async function MeetingPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireContext();
  const { week } = await searchParams;
  const view = await getWeekView(isWeekKey(week) ? week : null);
  return <MeetingMode key={view.week.key} view={view} />;
}
