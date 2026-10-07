import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { listDecisions } from "@/lib/meeting/service";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { PageHeader } from "@/components/page-header";
import { DecisionsJournal } from "@/components/meeting/decisions-journal";

export const metadata: Metadata = { title: "Решения" };

/** Журнал решений встреч (этап 23): в силе и отменённые, поиск по словам */
export default async function DecisionsPage() {
  const ctx = await requireContext();
  const team = await currentTeam(subjectOf(ctx));
  const actor = await currentActor();
  const teamIds = team.id && team.id !== ALL_TEAMS ? [team.id] : undefined;
  const decisions = await listDecisions(actor, { teamIds, status: "all" });
  return (
    <>
      <PageHeader title="Решения" description={`Журнал решений встреч${team.id && team.id !== ALL_TEAMS ? `: ${team.name}` : ""}. Решение в силе, пока его не отменили с причиной`} />
      <DecisionsJournal initial={decisions} teamIds={teamIds} />
    </>
  );
}
