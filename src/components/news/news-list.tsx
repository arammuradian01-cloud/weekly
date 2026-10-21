// Список новостей (этап 60): серверный компонент. Карточка: продукты, заголовок ссылкой на источник, источник и дата,
// короткое описание. Группы по дню публикации по Москве: сегодня, вчера, дата

import { ExternalLink, Newspaper } from "lucide-react";
import type { NewsItemView } from "@/lib/news/service";
import { moscowDate, type CalendarDate } from "@/lib/week";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/cn";

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

export function NewsCard({ item, labels, compact = false, now }: { item: NewsItemView; labels: Map<string, string>; compact?: boolean; now?: Date }) {
  return (
    <article className={cn("flex min-w-0 flex-col gap-1.5", compact ? "py-3" : "sv-card p-4")} data-testid="news-item" data-news-id={item.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.directions.map((code) => (
          <Badge key={code} tone="blue">
            {labels.get(code) ?? code}
          </Badge>
        ))}
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
      {item.summary && !compact ? <p className="text-body text-ink [overflow-wrap:anywhere]">{item.summary}</p> : null}
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
