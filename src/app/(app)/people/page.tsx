import { ownerLabels } from "@/lib/login/primary";
import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentReportingKey, weeklyStates } from "@/lib/weekly/service";
import { weekNumberOf } from "@/lib/weekly/weeks";
import { Section } from "@/components/page-header";
import { TeamSummary } from "@/components/team/team-summary";
import { audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { slotText } from "@/lib/org/rhythm";
import { TOP_TEAM } from "@/domain/teams";

export const metadata: Metadata = { title: "Люди: команда" };

export default async function TeamPage() {
  const ctx = await requireContext();
  const key = await currentReportingKey();
  const team = await currentTeam(subjectOf(ctx));
  const reports = await weeklyStates(key, audienceOf(team));
  // Ритм weekly выбранной команды (этап 15)
  const node = team.nodes.find((n) => n.id === team.id);
  // Этап 68: подсказка короче. Свой срок сдачи пишется, только если он отличается от департамента; «сдают все» (weekly
  // сдают и участники, а не только руководители) пишется у любой команды ниже, и со сроком департамента тоже
  const rhythm =
    node && node.id !== TOP_TEAM ? `${node.rhythm.deadline ? `, сдача ${slotText(node.rhythm.deadline)}` : ""}${node.rhythm.specialists ? ", сдают все" : ""}` : "";
  return (
    <Section title={team.id ? team.name : "Команда"} hint={`Задачи и weekly за отчётную неделю${rhythm}`}>
      <TeamSummary reports={reports} weekNumber={weekNumberOf(key)} owners={await ownerLabels()} />
    </Section>
  );
}
