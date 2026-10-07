import type { Metadata } from "next";
import Link from "next/link";
import { currentActor } from "@/lib/action-runner";
import { entryForPage } from "@/lib/discuss/service";
import { weekNumberOf } from "@/lib/weekly/weeks";
import { formatLong } from "@/domain/dates";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { EntryItem } from "@/components/weekly/entry-item";
import { SeenMark } from "@/components/inbox/seen-mark";

export const metadata: Metadata = { title: "Запись weekly" };

/** Запись weekly с обсуждением (этап 20): сюда ведут «Мне» и письма */
export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await currentActor();
  const entry = await entryForPage(actor, id);
  if (!entry) {
    return (
      <>
        <PageHeader title="Запись weekly" />
        <EmptyState title="Записи нет">Её удалили, или она в ленте команды, которую вы не видите.</EmptyState>
      </>
    );
  }
  return (
    <div className="max-w-3xl">
      <PageHeader title="Запись weekly" description={`Неделя ${weekNumberOf(entry.week)}, с ${formatLong(entry.week)}`}>
        <Link href={`/weekly?week=${entry.week}`} className="inline-flex min-h-10 items-center text-body font-medium text-blue-700 hover:underline">
          Вся лента недели
        </Link>
      </PageHeader>
      <SeenMark subject={`entry:${entry.id}`} />
      <div className="rounded-xl px-4 py-4 ring-1 ring-line sm:px-6">
        <EntryItem entry={entry} showAuthor discussion="open" />
      </div>
    </div>
  );
}
