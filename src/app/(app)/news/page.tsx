import type { Metadata } from "next";
import Link from "next/link";
import { Settings } from "lucide-react";
import { requireContext } from "@/lib/auth";
import { digestView, lastFetchAt, listNews, newsDirections, personDirections } from "@/lib/news/service";
import { formatDateTime } from "@/lib/week";
import { PageHeader } from "@/components/page-header";
import { NewsList } from "@/components/news/news-list";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { plural } from "@/domain/dates";

export const metadata: Metadata = { title: "Новости" };

/** Фильтр в адресе: ?d=osago,kasko. Нет параметра: все продукты, «мои»: продукты человека */
function parseFilter(raw: string | undefined, known: Set<string>): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => known.has(s)))];
}

const href = (codes: string[], page = 1) => {
  const params = new URLSearchParams();
  if (codes.length) params.set("d", codes.join(","));
  if (page > 1) params.set("page", String(page));
  const q = params.toString();
  return `/news${q ? `?${q}` : ""}`;
};

/**
 * Раздел «Новости» (этап 60): публичные новости по продуктам из лент источников. Фильтр по продуктам живёт в адресе,
 * ссылкой можно поделиться. ?digest=<id> открывает свой дайджест: те же новости, что ушли в «Мне» и письмом
 */
export default async function NewsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const directions = await newsDirections();
  const labels = new Map(directions.map((d) => [d.code, d.label]));
  const active = directions.filter((d) => d.active);
  const known = new Set(active.map((d) => d.code));
  const now = new Date();
  const owner = ctx.management?.role === "OWNER";

  if (sp.digest) {
    const digest = await digestView(sp.digest, ctx.person.id);
    return (
      <>
        <PageHeader
          title={digest ? digest.title : "Дайджест не найден"}
          description={
            digest
              ? `${digest.items.length} ${plural(digest.items.length, "новость", "новости", "новостей")} по продуктам: ${digest.directions.map((c) => labels.get(c) ?? c).join(", ") || "без продуктов"}. Так дайджест ушёл вам ${formatDateTime(new Date(digest.sentAt))}`
              : "Дайджест открывается только тому, кому он отправлен"
          }
        >
          <Link href="/news" className={buttonClass("secondary", "sm")}>
            Все новости
          </Link>
        </PageHeader>
        {digest ? (
          <NewsList items={digest.items} labels={labels} now={now} empty={{ title: "В дайджесте нет новостей", text: "За период по вашим продуктам ничего не нашлось." }} />
        ) : null}
      </>
    );
  }

  const mine = sp.d === "my" ? (await personDirections(ctx.person.id)).filter((c) => known.has(c)) : null;
  const selected = mine ?? parseFilter(sp.d, known);
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, fetched] = await Promise.all([listNews({ directions: selected, page }), lastFetchAt()]);
  const pill = (codes: string[], label: string, isActive: boolean, testId: string) => (
    <Link key={label} href={href(codes)} className={cn("sv-pill", isActive && "is-active")} aria-current={isActive ? "page" : undefined} data-testid={testId}>
      {label}
    </Link>
  );

  return (
    <>
      <PageHeader
        title="Новости"
        description={
          <>
            Публичные новости рынка по продуктам: регулятор, союзы страховщиков, деловые СМИ. Ресурс хранит заголовок, дату, источник, ссылку и короткое описание; статья целиком открывается на
            сайте источника.{fetched ? ` Ленты обновлены ${formatDateTime(fetched)}.` : " Ленты ещё не забирались."}
          </>
        }
      >
        <Link href="/profile?tab=mail" className={buttonClass("secondary", "sm")}>
          Настроить дайджест
        </Link>
        {owner ? (
          <Link href="/settings#news" className={buttonClass("ghost", "sm")}>
            <Settings className="h-4 w-4" aria-hidden="true" />
            Источники
          </Link>
        ) : null}
      </PageHeader>

      <nav aria-label="Продукты" className="mb-5 flex flex-wrap gap-2" data-testid="news-filter">
        {pill([], "Все", !selected.length && sp.d !== "my", "news-filter-all")}
        <Link href="/news?d=my" className={cn("sv-pill", sp.d === "my" && "is-active")} aria-current={sp.d === "my" ? "page" : undefined} data-testid="news-filter-my">
          Мои продукты
        </Link>
        {active.map((d) => pill([d.code], d.label, sp.d !== "my" && selected.length === 1 && selected[0] === d.code, `news-filter-${d.code}`))}
      </nav>

      <NewsList
        items={list.items}
        labels={labels}
        now={now}
        empty={{
          title: selected.length ? "По выбранным продуктам новостей пока нет" : "Новостей пока нет",
          text: owner ? "Проверьте источники и ключевые слова в «Настройках»: забор идёт раз в час." : "Ленты забираются раз в час. Если новости не появляются, владелец проверит источники в настройках.",
        }}
      />

      {list.pages > 1 ? (
        <nav aria-label="Страницы" className="mt-6 flex items-center gap-3 text-small text-muted">
          {list.page > 1 ? (
            <Link href={href(selected, list.page - 1)} className={buttonClass("secondary", "sm")}>
              Новее
            </Link>
          ) : null}
          <span>
            Страница {list.page} из {list.pages}, всего {list.total}
          </span>
          {list.page < list.pages ? (
            <Link href={href(selected, list.page + 1)} className={buttonClass("secondary", "sm")} data-testid="news-older">
              Старее
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
