import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { goalsView } from "@/lib/goals/service";
import { BORD_GOAL_TABS } from "@/lib/goals/bord";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import { GoalsScreen } from "@/components/goals/goals-screen";

export const metadata: Metadata = { title: "Цели" };

/** Сквозные цели (этап 17): дерево целей квартала от департамента до команд и людей, прогресс и риски */
export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ q?: string; find?: string }> }) {
  const ctx = await requireContext();
  const { q, find } = await searchParams;
  const subject = subjectOf(ctx);
  const team = await currentTeam(subject);
  const view = await goalsView(
    { personId: ctx.person.id, role: ctx.person.role, management: ctx.management?.role ?? null, limited: subject.limited },
    { quarter: q ?? null, team: team.id && team.id !== ALL_TEAMS ? team.id : null },
  );
  const bordOn = ctx.management?.role === "OWNER" && !!(await getSetting<string | null>("bord.sourceId", null));
  return (
    <>
      <PageHeader
        title="Цели"
        description={team.id && team.id !== ALL_TEAMS ? `Цели команды «${team.name}» и команд ниже, и цели выше, на которые они работают` : "Цели департамента, команд и людей"}
      />
      <GoalsScreen view={view} defaultTeam={team.id && team.id !== ALL_TEAMS ? team.id : (view.creatable[0]?.id ?? null)} bordTabs={bordOn ? BORD_GOAL_TABS : null}
        leaderBoard={!!ctx.management && ctx.person.role !== "OBSERVER"}
        initialQuery={find?.slice(0, 80) ?? ""}
      />
    </>
  );
}
