import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { MeetingMode } from "@/components/weekly/meeting-mode";
import { audienceOf, currentTeam } from "@/lib/org/current";

export const metadata: Metadata = { title: "Режим встречи" };

export default async function MeetingPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { person } = await requireContext();
  const { week } = await searchParams;
  const team = await currentTeam({ id: person.id, role: person.role });
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audienceOf(team));
  return <MeetingMode key={view.week.key} view={view} />;
}
