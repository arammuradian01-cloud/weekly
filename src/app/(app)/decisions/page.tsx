import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { listDecisions } from "@/lib/meeting/service";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { PageHeader } from "@/components/page-header";
import { DecisionsJournal } from "@/components/meeting/decisions-journal";

export const metadata: Metadata = { title: "Решения" };

/** Журнал решений встреч (этап 23): в силе и отменённые, поиск по словам */
export default async function DecisionsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const { q = "" } = await searchParams;
  const team = await currentTeam(subjectOf(ctx));
  const actor = await currentActor();
  // Пришли из общего поиска с запросом (этап 25): ищем по всем видимым командам, иначе решение другой команды не нашлось бы
  const query = String(q).trim().slice(0, 200);
  const teamIds = !query && team.id && team.id !== ALL_TEAMS ? [team.id] : undefined;
  const decisions = await listDecisions(actor, { teamIds, status: "all", query: query || undefined });
  return (
    <>
      <PageHeader title="Решения" description={`Журнал решений встреч${teamIds ? `: ${team.name}` : ""}. Решение в силе, пока его не отменили с причиной`} />
      <DecisionsJournal initial={decisions} teamIds={teamIds} initialQuery={query} />
    </>
  );
}
