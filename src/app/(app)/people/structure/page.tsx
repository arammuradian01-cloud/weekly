import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { structureView } from "@/lib/org/view";
import { peopleTree } from "@/lib/org/people-tree";
import { joinRequestsFor, memberCandidates } from "@/lib/org/service";
import { currentActor } from "@/lib/action-runner";
import { StructureScreen } from "@/components/structure/structure-screen";
import { subjectOf } from "@/lib/org/current";

export const metadata: Metadata = { title: "Люди: структура" };

/**
 * Структура компании (этап 14), дерево подчинённых (этап 34). Видят все, людей и подразделения правит владелец.
 * Этап 64: команды здесь только для просмотра, управляют ими на экране «Weekly-команды»
 */
export default async function StructurePage({ searchParams }: { searchParams: Promise<{ person?: string; team?: string }> }) {
  const { person, team } = await searchParams;
  // Прежние ссылки на команду (события «Мне» и письма этапа 53) ведут в карточку команды
  if (team) redirect(`/people/teams?team=${encodeURIComponent(team)}`);
  const ctx = await requireContext();
  const owner = ctx.management?.role === "OWNER";
  const subject = subjectOf(ctx);
  const [view, tree] = await Promise.all([structureView({ id: ctx.person.id, role: ctx.person.role, limited: subject.limited }, { includeInactive: owner }), peopleTree(subject)]);
  // Люди для правки подразделений и руководителей: только владельцу
  const candidates = owner ? await memberCandidates(await currentActor()) : [];
  // Запросы в команды из других веток (этап 53) решают в «Weekly-командах», здесь только сколько их. По общему логину нет
  const toApprove = ctx.via === "TEAM" ? 0 : (await joinRequestsFor(await currentActor())).toApprove.length;
  return <StructureScreen view={view} tree={tree} owner={owner} me={ctx.person.slug} candidates={candidates} focus={person ?? null} toApprove={toApprove} />;
}
