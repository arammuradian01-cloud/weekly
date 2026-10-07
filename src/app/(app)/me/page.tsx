import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { listInbox } from "@/lib/inbox/service";
import { subjectOf } from "@/lib/org/current";
import { PageHeader } from "@/components/page-header";
import { InboxList } from "@/components/inbox/inbox-list";

export const metadata: Metadata = { title: "Мне" };

/** «Мне» (этап 11): чего ждут от человека. Цель раздела: пустой список */
export default async function MePage() {
  const ctx = await requireContext();
  const inbox = await listInbox(ctx.person.id, new Date(), subjectOf(ctx));
  return (
    <>
      <PageHeader title="Мне" description="Что ждёт вашего внимания: новые задачи, комментарии, упоминания, реакции, переносы сроков. Разберите, и список опустеет." />
      <InboxList items={inbox.items} snoozed={inbox.snoozed} />
    </>
  );
}
