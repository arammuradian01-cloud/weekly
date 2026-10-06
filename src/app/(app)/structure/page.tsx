import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { structureView } from "@/lib/org/view";
import { memberCandidates } from "@/lib/org/service";
import { currentActor } from "@/lib/action-runner";
import { PageHeader } from "@/components/page-header";
import { StructureScreen } from "@/components/structure/structure-screen";
import { TOP_TEAM } from "@/domain/teams";

export const metadata: Metadata = { title: "Структура" };

/** Структура департамента и команды (этап 14). Видят все, правит владелец, состав своей команды правит её руководитель */
export default async function StructurePage() {
  const ctx = await requireContext();
  const owner = ctx.management?.role === "OWNER";
  const view = await structureView({ id: ctx.person.id, role: ctx.person.role }, { includeInactive: owner });
  const leadsTeam = view.teams.some((t) => t.id !== TOP_TEAM && t.leader?.slug === ctx.person.slug);
  const candidates = owner || leadsTeam ? await memberCandidates(await currentActor()) : [];
  return (
    <>
      <PageHeader title="Структура" description="Подразделения департамента и команды руководителей: кто с кем работает каждую неделю" />
      <StructureScreen view={view} owner={owner} me={ctx.person.slug} candidates={candidates} />
    </>
  );
}
