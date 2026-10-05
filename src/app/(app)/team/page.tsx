import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentReportingKey, weeklyStates } from "@/lib/weekly/service";
import { weekNumberOf } from "@/lib/weekly/weeks";
import { PageHeader } from "@/components/page-header";
import { TeamSummary } from "@/components/team/team-summary";

export const metadata: Metadata = { title: "Команда" };

export default async function TeamPage() {
  await requireContext();
  const key = await currentReportingKey();
  const reports = await weeklyStates(key);
  return (
    <>
      <PageHeader title="Команда" description="Задачи и weekly каждого за отчётную неделю" />
      <TeamSummary reports={reports} weekNumber={weekNumberOf(key)} />
    </>
  );
}
