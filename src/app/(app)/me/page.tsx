import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { listInbox } from "@/lib/inbox/service";
import { myRequests } from "@/lib/requests/service";
import { currentActor } from "@/lib/action-runner";
import { subjectOf } from "@/lib/org/current";
import { PageHeader } from "@/components/page-header";
import { MeQueue } from "@/components/inbox/me-queue";
import { withoutRequestEvents } from "@/components/inbox/me-tasks";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { MeFigures } from "@/components/inbox/me-figures";

export const metadata: Metadata = { title: "Мне" };

/**
 * «Мне» (этап 11): чего ждут от человека. Цель раздела: пустой список. Этап 44: одна очередь по срочности вместо трёх
 * разделов, цифры строкой под заголовком ведут к группам
 */
export default async function MePage() {
  const ctx = await requireContext();
  const [inbox, requests] = await Promise.all([listInbox(ctx.person.id, new Date(), subjectOf(ctx)), myRequests(await currentActor())]);
  // Открытая просьба уже в очереди своей строкой с действиями: её событие «Просьба к вам» было бы той же просьбой
  // второй раз с той же кнопкой. Событие остаётся в счётчике меню и у просьб, которых в очереди нет
  const items = withoutRequestEvents(inbox.items, requests.incoming);
  return (
    <div className="sv-page--read">
      <PageHeader title="Мне" description="Что ждёт вашего внимания, по срочности. Разберите, и список опустеет." figures={<MeFigures incoming={requests.incoming} events={items.length} />}>
        <AskColleagueButton size="sm" />
      </PageHeader>
      <MeQueue incoming={requests.incoming} items={items} snoozed={inbox.snoozed} />
    </div>
  );
}
