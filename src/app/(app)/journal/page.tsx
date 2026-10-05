import type { Metadata } from "next";
import { requireManagement } from "@/lib/auth";
import { JOURNAL_ROLES } from "@/lib/roles";
import { journalEvents, journalPeople, type JournalFilter, type JournalKind, type JournalQuery } from "@/lib/journal";
import { PageHeader } from "@/components/page-header";
import { JournalView } from "@/components/admin/journal-view";

export const metadata: Metadata = { title: "Журнал" };

const KINDS: JournalKind[] = ["task", "comment", "weekly", "login", "settings", "sync", "system"];
const SOURCES = ["app", "sheet", "system"] as const;
const PERIODS = ["7", "30", "all"] as const;

/** Фильтры журнала живут в адресе страницы: ссылку на выборку можно переслать */
function parse(sp: Record<string, string | undefined>): JournalQuery {
  const period = PERIODS.find((p) => p === sp.period) ?? "30";
  const kind = KINDS.find((k) => k === sp.kind) ?? "";
  const source = SOURCES.find((s) => s === sp.source) ?? "";
  const n = Math.min(Math.max(Number(sp.n) || 100, 100), 5000);
  return { who: (sp.who ?? "").slice(0, 40), period, kind, source, n };
}

export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireManagement(JOURNAL_ROLES, "/journal");
  const query = parse(await searchParams);
  const filter: JournalFilter = {
    who: query.who || undefined,
    days: query.period === "all" ? undefined : Number(query.period),
    kind: query.kind || undefined,
    source: query.source || undefined,
    limit: query.n,
  };
  const [page, people] = await Promise.all([journalEvents(filter), journalPeople()]);

  return (
    <>
      <PageHeader title="Журнал" description="Кто, когда и что изменил: было и стало по каждому полю" />
      <JournalView page={page} people={people} query={query} />
    </>
  );
}
