import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { MeetingMode } from "@/components/weekly/meeting-mode";
import { MeetingLive } from "@/components/meeting/meeting-live";
import { BuildAgendaBanner } from "@/components/meeting/build-agenda-banner";
import { ALL_TEAMS, audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { currentActor } from "@/lib/action-runner";
import { meetingQuestions } from "@/lib/discuss/service";
import { stuckForMeeting } from "@/lib/requests/service";
import { canLeadTeam, getMeeting } from "@/lib/meeting/service";

export const metadata: Metadata = { title: "Встреча" };

export default async function MeetingPage({ searchParams }: { searchParams: Promise<{ week?: string; screen?: string }> }) {
  const ctx = await requireContext();
  const { week } = await searchParams;
  const team = await currentTeam(subjectOf(ctx));
  const audience = audienceOf(team);
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audience);
  const actor = await currentActor();
  // Встреча 2.0 (этап 23): у одной команды свой объект встречи с повесткой и решениями. «Все команды» показывают
  // ленту недели по-старому: встреча идёт в каждой команде отдельно
  const single = team.id && team.id !== ALL_TEAMS ? { id: team.id, name: team.name } : null;
  const [meeting, canLead] = single ? await Promise.all([getMeeting(actor, single.id, view.week.key), canLeadTeam(actor, single.id)]) : [null, false];
  if (single && meeting) return <MeetingLive key={`${view.week.key}-${single.id}`} view={view} meeting={meeting} canLead={canLead} team={single} />;
  // Повестки ещё нет: встреча идёт по ленте недели, как раньше. Руководитель может собрать повестку
  const [questions, stuck] = await Promise.all([
    meetingQuestions(actor, view.week.key, { current: view.entries.map((e) => e.id) }, audience.teamIds ?? []),
    stuckForMeeting(actor, audience.teamIds ?? []),
  ]);
  return (
    <>
      {single ? <BuildAgendaBanner team={single} week={view.week.key} canLead={canLead} /> : null}
      <MeetingMode key={view.week.key} view={view} questions={questions} stuck={stuck} />
    </>
  );
}
