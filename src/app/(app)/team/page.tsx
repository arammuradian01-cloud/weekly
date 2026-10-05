import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TeamSummary } from "@/components/team/team-summary";

export const metadata: Metadata = { title: "Команда" };

export default function TeamPage() {
  return (
    <>
      <PageHeader title="Команда" description="Задачи и weekly каждого за отчётную неделю" />
      <TeamSummary />
    </>
  );
}
