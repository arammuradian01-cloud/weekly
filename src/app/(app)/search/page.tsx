import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { subjectOf } from "@/lib/org/current";
import { search } from "@/lib/search/service";
import { SEARCH_MIN, hitHref, hitId, type SearchHit } from "@/lib/search/common";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Highlight, HitTitle } from "@/components/shell/command-palette";
import { SearchForm } from "@/components/search/search-form";

export const metadata: Metadata = { title: "Поиск" };

const TITLES: Record<SearchHit["kind"], string> = { task: "Задачи", entry: "Записи weekly", decision: "Решения", comment: "Комментарии", person: "Люди" };
const ORDER: SearchHit["kind"][] = ["task", "entry", "decision", "comment", "person"];

/** Страница поиска (этап 25): те же результаты, что в командной строке, но больше и со ссылкой, которой можно делиться */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireContext();
  const { q = "" } = await searchParams;
  const result = await search(subjectOf(ctx), q, "page");
  const groups = ORDER.map((kind) => ({ kind, title: TITLES[kind], hits: result.hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length);
  return (
    <>
      <PageHeader title="Поиск" description="По задачам, записям weekly, решениям, комментариям и людям. Слова ищутся с учётом словоформ, номер задачи открывает её" />
      <SearchForm initial={result.query} />
      {result.query.length < SEARCH_MIN ? (
        <p className="mt-6 text-body text-muted">Введите хотя бы два знака.</p>
      ) : !result.hits.length ? (
        <EmptyState title={`По запросу «${result.query}» ничего не нашлось`} className="mt-6">
          Попробуйте другое слово, часть слова или номер задачи. Ищется только то, что вам видно.
        </EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.kind} aria-labelledby={`search-${g.kind}`}>
              <h2 id={`search-${g.kind}`} className="mb-2 text-title font-semibold text-ink">
                {g.title} <span className="font-normal text-muted">{g.hits.length}</span>
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line">
                {g.hits.map((h) => (
                  <li key={hitId(h)} className="bg-white">
                    <Link href={hitHref(h)} className="block px-4 py-3 hover:bg-surface/60">
                      <HitTitle hit={h} />
                      {h.kind !== "person" ? <Highlight text={h.snippet} className="mt-0.5 block text-small text-muted" /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {result.truncated ? <p className="text-small text-muted">Показаны первые результаты. Уточните запрос, чтобы увидеть остальное.</p> : null}
        </div>
      )}
    </>
  );
}
