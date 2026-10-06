import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { currentReportingKey, weeklyStates } from "@/lib/weekly/service";
import { weekNumberOf } from "@/lib/weekly/weeks";
import { PageHeader } from "@/components/page-header";
import { TeamSummary } from "@/components/team/team-summary";
import { audienceOf, currentTeam } from "@/lib/org/current";

export const metadata: Metadata = { title: "Команда" };

export default async function TeamPage() {
  const { person } = await requireContext();
  const key = await currentReportingKey();
  const team = await currentTeam({ id: person.id, role: person.role });
  const reports = await weeklyStates(key, audienceOf(team));
  return (
    <>
      <PageHeader title={team.id ? `Команда: ${team.name}` : "Команда"} description="Задачи и weekly каждого за отчётную неделю">
        <Link href="/structure" className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
          Структура и команды
        </Link>
      </PageHeader>
      <TeamSummary reports={reports} weekNumber={weekNumberOf(key)} />
    </>
  );
}
