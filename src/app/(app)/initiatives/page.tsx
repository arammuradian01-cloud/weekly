import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { listInitiatives } from "@/lib/initiatives/service";
import { PageHeader } from "@/components/page-header";
import { InitiativesScreen } from "@/components/initiatives/initiatives-screen";

export const metadata: Metadata = { title: "Инициативы" };

/** Шкала готовности крупных инициатив (этап 30): ищем ещё, как сделать, или уже делаем */
export default async function InitiativesPage() {
  const ctx = await requireContext();
  const data = await listInitiatives(await currentActor());
  // Владелец и администратор без режима управления: в пустом состоянии ссылка на его включение (этап 59)
  const canEnterManage = !data.canManage && !ctx.management && !ctx.viewAs && ctx.managementRole !== null && ctx.person.role !== "OBSERVER";
  return (
    <>
      <PageHeader title="Крупные инициативы" description="Большие дела департамента. Ответственный отмечает, ищем ли ещё, как сделать, или уже делаем, и одной фразой, что сейчас происходит" />
      <InitiativesScreen data={data} canEnterManage={canEnterManage} />
    </>
  );
}
