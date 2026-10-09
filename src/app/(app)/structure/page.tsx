import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { structureView } from "@/lib/org/view";
import { peopleTree } from "@/lib/org/people-tree";
import { memberCandidates } from "@/lib/org/service";
import { currentActor } from "@/lib/action-runner";
import { PageHeader } from "@/components/page-header";
import { StructureScreen } from "@/components/structure/structure-screen";
import { TOP_TEAM } from "@/domain/teams";
import { loadScope } from "@/lib/org/scope";
import { subjectOf } from "@/lib/org/current";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Структура" };

/** Структура департамента и команды (этап 14), дерево подчинённых (этап 34). Видят все, правит владелец, состав своей команды правит её руководитель */
export default async function StructurePage() {
  const ctx = await requireContext();
  const owner = ctx.management?.role === "OWNER";
  const [view, tree] = await Promise.all([structureView({ id: ctx.person.id, role: ctx.person.role }, { includeInactive: owner }), peopleTree({ id: ctx.person.id, role: ctx.person.role })]);
  const leadsTeam = view.teams.some((t) => t.id !== TOP_TEAM && t.leader?.slug === ctx.person.slug);
  const candidates = owner || leadsTeam ? await memberCandidates(await currentActor()) : [];
  // Ритм weekly задают руководители своих команд и команд ниже (этап 15)
  const scope = await loadScope(prisma, subjectOf(ctx));
  return (
    <>
      <PageHeader title="Структура" description="Дерево подчинённых, подразделения департамента и команды руководителей: кто с кем работает каждую неделю" />
      <StructureScreen view={view} tree={tree} owner={owner} me={ctx.person.slug} candidates={candidates} leads={scope.leads} />
    </>
  );
}
