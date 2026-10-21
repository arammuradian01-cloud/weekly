import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { TaskRuleError } from "@/lib/tasks/service";
import { getParse, type ParseView } from "@/lib/meeting/parse-service";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { NotionParseScreen, type ParseTab } from "@/components/meeting/notion-parse";

export const metadata: Metadata = { title: "Разбор встречи" };
export const dynamic = "force-dynamic";

const TABS: ParseTab[] = ["summary", "ceo", "tasks"];

/** Разбор встречи из Notion (этап 61): итоги, weekly для CEO, задачи. Видят те, кто видит встречу команды */
export default async function NotionParsePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requireContext();
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const actor = await currentActor();
  let view: ParseView;
  try {
    view = await getParse(actor, id);
  } catch (error) {
    if (!(error instanceof TaskRuleError)) throw error;
    return (
      <>
        <PageHeader title="Разбор встречи" />
        <EmptyState title="Разбора нет или он вам не виден" action={<Link href="/weekly/meeting" className="font-medium text-blue-700 underline-offset-2 hover:underline">К встрече</Link>}>
          {error.message}
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader title={`Разбор встречи ${view.team.name}`} description="Итоги встречи из Notion, черновик weekly для CEO и задачи на проверку. Ничего не уходит без проверки ведущего" />
      {/* Ключ по версии разбора: свежий разбор с сервера заменяет черновики на экране, правки до сохранения живут до него */}
      <NotionParseScreen key={`${view.id}:${view.status}:${view.updatedAt}`} view={view} initialTab={TABS.find((t) => t === tab) ?? "summary"} />
    </>
  );
}
