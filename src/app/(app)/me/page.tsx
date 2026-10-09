import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { listInbox } from "@/lib/inbox/service";
import { myRequests } from "@/lib/requests/service";
import { currentActor } from "@/lib/action-runner";
import { subjectOf } from "@/lib/org/current";
import { PageHeader } from "@/components/page-header";
import { InboxList } from "@/components/inbox/inbox-list";
import { NoRequests, RequestList } from "@/components/requests/request-list";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { MeFigures } from "@/components/inbox/me-figures";

export const metadata: Metadata = { title: "Мне" };

/** «Мне» (этап 11): чего ждут от человека. Цель раздела: пустой список. Сверху просьбы коллег (этап 21) */
export default async function MePage() {
  const ctx = await requireContext();
  const [inbox, requests] = await Promise.all([listInbox(ctx.person.id, new Date(), subjectOf(ctx)), myRequests(await currentActor())]);
  return (
    <>
      <PageHeader
        title="Мне"
        description="Что ждёт вашего внимания: просьбы коллег, новые задачи, комментарии, упоминания, реакции, переносы сроков. Разберите, и список опустеет."
        figures={<MeFigures requests={requests.incoming.length} overdueRequests={requests.incoming.filter((r) => r.overdue).length} events={inbox.items.length} />}
      />
      <div className="flex flex-col gap-10">
        <RequestList
          id="me-requests"
          title="Просьбы ко мне"
          mode="incoming"
          items={requests.incoming}
          action={<AskColleagueButton size="sm" />}
          empty={<NoRequests title="Просьб нет">Когда коллега попросит вас о чём-то, просьба появится здесь. Примите её со сроком, отклоните с причиной или сделайте своей задачей.</NoRequests>}
        />
        <InboxList items={inbox.items} snoozed={inbox.snoozed} />
      </div>
    </>
  );
}
