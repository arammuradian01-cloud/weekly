// Список новостей (этап 60): серверный компонент. Карточка: продукты, заголовок ссылкой на источник, источник и дата,
// короткое описание. Группы по дню публикации по Москве: сегодня, вчера, дата.
// Описание подписано честно: без Claude это начало анонса источника дословно, с Claude его короткий пересказ.
// Этап 59: описание серым в две строки, подпись начала анонса только для диктора, на телефоне два продукта и «+N»

import { ExternalLink, Newspaper } from "lucide-react";
import type { NewsItemView } from "@/lib/news/service";
import { moscowDate, type CalendarDate } from "@/lib/week";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/cn";

/** Подпись описания: чьё оно */
export const SUMMARY_LABELS: Record<NewsItemView["summaryBy"], string> = { source: "Начало анонса источника", claude: "Пересказ Claude" };

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const sameDay = (a: CalendarDate, b: CalendarDate) => a.year === b.year && a.month === b.month && a.day === b.day;
const shift = (d: CalendarDate, days: number): CalendarDate => moscowDate(new Date(Date.UTC(d.year, d.month - 1, d.day, 12) + days * 86_400_000));

/** Подпись дня: «Сегодня», «Вчера», «19 октября», с годом, если год другой */
export function dayLabel(iso: string, now = new Date()): string {
  const today = moscowDate(now);
  const d = moscowDate(new Date(iso));
  if (sameDay(d, today)) return "Сегодня";
  if (sameDay(d, shift(today, -1))) return "Вчера";
  return `${d.day} ${MONTHS[d.month - 1]}${d.year !== today.year ? ` ${d.year}` : ""}`;
}

/** Короткая дата для карточки: 21.10 или 21.10.2025 */
export function shortDate(iso: string, now = new Date()): string {
  const d = moscowDate(new Date(iso));
  const y = moscowDate(now).year;
  return `${String(d.day).padStart(2, "0")}.${String(d.month).padStart(2, "0")}${d.year !== y ? `.${d.year}` : ""}`;
}

/** Продуктов в строке карточки на телефоне: остальные одной меткой «+N», чтобы метки не занимали три строки */
const PHONE_TAGS = 2;

export function NewsCard({ item, labels, compact = false, now }: { item: NewsItemView; labels: Map<string, string>; compact?: boolean; now?: Date }) {
  const names = item.directions.map((code) => labels.get(code) ?? code);
  const rest = names.slice(PHONE_TAGS);
  return (
    <article className={cn("flex min-w-0 flex-col gap-1.5", compact ? "py-3" : "sv-card p-4")} data-testid="news-item" data-news-id={item.id}>
      <div className="flex flex-wrap items-center gap-1.5" data-testid="news-tags">
        {names.map((name, i) => (
          <Badge key={item.directions[i]} tone="blue" className={i >= PHONE_TAGS ? "max-sm:hidden" : undefined}>
            {name}
          </Badge>
        ))}
        {rest.length ? (
          <Badge tone="gray" className="sm:hidden">
            <span aria-hidden="true" data-testid="news-more">
              +{rest.length}
            </span>
            <span className="sr-only">ещё {rest.join(", ")}</span>
          </Badge>
        ) : null}
        <span className="text-caption text-muted">
          {item.source}, {shortDate(item.publishedAt, now)}
        </span>
      </div>
      <h3 className={cn("font-semibold text-ink [overflow-wrap:anywhere]", compact ? "text-body" : "text-title-sm")}>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 underline-offset-2 hover:text-link hover:underline">
          <span>{item.title}</span>
          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
          <span className="sr-only">, откроется на сайте источника</span>
        </a>
      </h3>
      {/* Описание серым и не длиннее двух строк (этап 59): статья целиком на сайте источника. Начало анонса источника
          подписано для диктора, глазу подпись перед каждой новостью мешает; пересказ Claude подписан видимо */}
      {item.summary && !compact ? (
        <p className="line-clamp-2 text-body text-muted [overflow-wrap:anywhere]" data-testid="news-summary">
          <span className={item.summaryBy === "source" ? "sr-only" : "text-caption"}>{SUMMARY_LABELS[item.summaryBy]}: </span>
          {item.summary}
        </p>
      ) : null}
    </article>
  );
}

/** Лента по дням */
export function NewsList({ items, labels, now = new Date(), empty }: { items: NewsItemView[]; labels: Map<string, string>; now?: Date; empty: { title: string; text: string } }) {
  if (!items.length) {
    return (
      <EmptyState title={empty.title} icon={Newspaper}>
        {empty.text}
      </EmptyState>
    );
  }
  const groups: { label: string; items: NewsItemView[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.publishedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return (
    <div className="flex flex-col gap-6" data-testid="news-list">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="flex flex-col gap-3">
          <h2 className="text-caption font-semibold text-muted">{g.label}</h2>
          {g.items.map((item) => (
            <NewsCard key={item.id} item={item} labels={labels} now={now} />
          ))}
        </section>
      ))}
    </div>
  );
}
