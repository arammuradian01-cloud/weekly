import type { Metadata } from "next";
import { currentActor } from "@/lib/action-runner";
import { getRequest, requestHistory } from "@/lib/requests/service";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SeenMark } from "@/components/inbox/seen-mark";
import { RequestCard } from "@/components/requests/request-card";

export const metadata: Metadata = { title: "Просьба" };

/** Просьба коллеге (этап 21): сюда ведут «Мне», «Жду от коллег», карточка задачи и письма */
export default async function RequestPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const n = Number(number);
  const actor = await currentActor();
  const request = Number.isInteger(n) ? await getRequest(actor, n) : null;
  if (!request) {
    return (
      <>
        <PageHeader title="Просьба" />
        <EmptyState title="Просьбы нет">Проверьте номер. Просьбу видят автор, адресат и их руководители.</EmptyState>
      </>
    );
  }
  const history = await requestHistory(request.number);
  return (
    <div className="max-w-3xl">
      <PageHeader title={`Просьба ${request.number}`} />
      <SeenMark subject={`request:${request.number}`} />
      <RequestCard request={request} history={history} />
    </div>
  );
}
