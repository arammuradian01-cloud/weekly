import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { MeetingMode } from "@/components/weekly/meeting-mode";
import { audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { currentActor } from "@/lib/action-runner";
import { meetingQuestions } from "@/lib/discuss/service";
import { stuckForMeeting } from "@/lib/requests/service";

export const metadata: Metadata = { title: "Режим встречи" };

export default async function MeetingPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireContext();
  const { week } = await searchParams;
  const team = await currentTeam(subjectOf(ctx));
  const audience = audienceOf(team);
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audience);
  // Повестка из вопросов «Обсудить на встрече» к записям ленты и задачам показанных команд (этап 20)
  const actor = await currentActor();
  const [questions, stuck] = await Promise.all([
    meetingQuestions(actor, view.week.key, { current: view.entries.map((e) => e.id) }, audience.teamIds ?? []),
    // Зависшие просьбы и предложения команд встречи (этап 21)
    stuckForMeeting(actor, audience.teamIds ?? []),
  ]);
  return <MeetingMode key={view.week.key} view={view} questions={questions} stuck={stuck} />;
}
