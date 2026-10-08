import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { getPair } from "@/lib/one-on-one/service";
import { personalLogin } from "@/lib/one-on-one/rules";
import { TaskRuleError } from "@/lib/tasks/service";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { OneOnOneScreen } from "@/components/one-on-one/one-on-one-screen";

export const metadata: Metadata = { title: "Один на один" };

/** Встреча один на один с человеком (этап 28): только для двоих участников и только при личном входе */
export default async function OneOnOnePairPage({ params }: { params: Promise<{ slug: string }> }) {
  const ctx = await requireContext();
  const { slug } = await params;
  const back = (
    <Link href="/one-on-one" className="inline-flex h-10 items-center text-body font-medium text-blue-700 hover:underline">
      Все встречи один на один
    </Link>
  );
  if (!personalLogin(ctx.via)) {
    return (
      <>
        <PageHeader title="Один на один">{back}</PageHeader>
        <EmptyState title="Встречи один на один открываются только при личном входе">По общему логину их не видно.</EmptyState>
      </>
    );
  }
  let view;
  try {
    view = await getPair(await currentActor(), decodeURIComponent(slug));
  } catch (error) {
    if (!(error instanceof TaskRuleError)) throw error;
    return (
      <>
        <PageHeader title="Один на один">{back}</PageHeader>
        <EmptyState title="Такой встречи нет">{error.message}</EmptyState>
      </>
    );
  }
  const other = view.role === "manager" ? view.report : view.manager;
  return (
    <>
      <PageHeader title={`Один на один: ${other.fullName}`} description={`Руководитель: ${view.manager.fullName}. Встречу видите только вы двое`}>
        {back}
      </PageHeader>
      <OneOnOneScreen key={view.pairId ?? other.slug} view={view} />
    </>
  );
}
