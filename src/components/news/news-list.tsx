// Список новостей (этап 60): серверный компонент. Карточка: продукты, заголовок ссылкой на источник, источник и дата,
// короткое описание. Группы по дню публикации по Москве: сегодня, вчера, дата.
// Описание подписано честно: без Claude это начало анонса источника дословно, с Claude его короткий пересказ.
// Этап 59: описание серым в две строки, подпись начала анонса только для диктора, на телефоне два продукта и «+N».
// Этап 68: лента строками по дням, главная новость сверху, одна тема из разных источников под одной строкой, колонка
// «Официально» на широком экране. NewsCard остался для блока на «Моей неделе»

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

/** Время публикации по Москве: «14:20» */
function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * Слово целиком (этап 68): \b в JavaScript не видит границ кириллических слов, поэтому границы по буквам Юникода.
 * Так «РСА» не находится внутри «РСАТ» или «ПРСА», а в «Пресс-служба РСА» находится: дефис и пробел не буквы
 */
const word = (body: string) => new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, "iu");
const CBR = word("банк россии|цб рф");
const RSA = word("рса");
const VSS = word("всероссийский союз страховщиков|союз страховщиков");

/** Значок источника: две первые буквы названия, «Банк России» как «ЦБ» */
function monogram(source: string): string {
  if (CBR.test(source)) return "ЦБ";
  if (RSA.test(source)) return "РСА";
  if (VSS.test(source)) return "ВСС";
  return source.replace(/[^A-Za-zА-Яа-яЁё ]/g, "").trim().slice(0, 2).toUpperCase();
}

/** Официальные источники: регулятор и союзы страховщиков, словами целиком. Их свежая новость становится главной */
const OFFICIAL = word("банк россии|цб рф|рса|союз страховщиков|союз автостраховщиков|всероссийский союз страховщиков");

/**
 * Главная новость (этап 68): среди новостей за сегодня первая официальная (регулятор или союзы), иначе первая
 * сегодняшняя; за сегодня новостей нет: главной нет. NewsList показывает её только с lead, страница ленты передаёт lead
 * на первой странице
 */
export function pickLead(items: NewsItemView[], now = new Date()): NewsItemView | null {
  if (!items.length) return null;
  const today = items.filter((i) => dayLabel(i.publishedAt, now) === "Сегодня");
  return today.find((i) => OFFICIAL.test(i.source)) ?? today[0] ?? null;
}

/**
 * Продукты новости в строке ленты: те же метки, что у карточки (этап 59): на телефоне две и «+N», остальные названы
 * для диктора. data-testid те же, что ждёт news.spec.ts
 */
function Directions({ item, labels }: { item: NewsItemView; labels: Map<string, string> }) {
  const names = item.directions.map((code) => labels.get(code) ?? code);
  const rest = names.slice(PHONE_TAGS);
  if (!names.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-testid="news-tags">
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
    </span>
  );
}

function LeadCard({ item, labels }: { item: NewsItemView; labels: Map<string, string> }) {
  return (
    <article className="sv-card relative flex min-w-0 flex-col gap-3 overflow-hidden px-6 py-5" data-testid="news-item" data-lead="true" data-news-id={item.id}>
      <span className="absolute inset-y-0 left-0 w-1.5 bg-green" aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption font-semibold uppercase tracking-wide text-green-ink">Главное сегодня</span>
        <Directions item={item} labels={labels} />
      </div>
      <h2 className="m-0 text-title font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-link hover:underline">
          {item.title}
          <span className="sr-only">, откроется на сайте источника</span>
        </a>
      </h2>
      {item.summary ? (
        <p className="m-0 line-clamp-3 text-body text-ink [overflow-wrap:anywhere]" title={SUMMARY_LABELS[item.summaryBy]}>
          <span className={item.summaryBy === "source" ? "sr-only" : "text-caption text-muted"}>{SUMMARY_LABELS[item.summaryBy]}: </span>
          {item.summary}
        </p>
      ) : null}
      <p className="m-0 flex items-center gap-2 text-caption text-muted">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-navy px-1 text-micro font-bold text-sidebar-text" aria-hidden="true">
          {monogram(item.source)}
        </span>
        <span className="font-semibold text-ink">{item.source}</span>
        <span>{timeOf(item.publishedAt)}</span>
      </p>
    </article>
  );
}

// ---------- Одна тема из разных источников (этап 68) ----------

const STOP = new Set(["и", "в", "во", "на", "по", "с", "со", "к", "о", "об", "от", "до", "за", "из", "для", "не", "что", "как", "а", "но", "при", "это"]);

/** Слова заголовка без предлогов и окончаний: «страховщики», «страховщиков» дают одну основу */
function stems(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/ё/g, "е")
      .split(/[^a-zа-я0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.length > 6 ? w.slice(0, 6) : w)),
  );
}

/** Похожие заголовки: общих основ не меньше половины от меньшего заголовка и хотя бы три */
export function sameTopic(a: string, b: string): boolean {
  const x = stems(a);
  const y = stems(b);
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common >= 3 && common / Math.min(x.size, y.size) >= 0.5;
}

/** Склейка в пределах дня: первая новость темы главная, остальные из других источников идут под ней ссылками */
export function groupTopics(items: NewsItemView[]): { head: NewsItemView; more: NewsItemView[] }[] {
  const out: { head: NewsItemView; more: NewsItemView[] }[] = [];
  for (const item of items) {
    const topic = out.find((t) => t.head.source !== item.source && !t.more.some((m) => m.source === item.source) && sameTopic(t.head.title, item.title));
    if (topic) topic.more.push(item);
    else out.push({ head: item, more: [] });
  }
  return out;
}

function NewsRow({ item, labels, more = [] }: { item: NewsItemView; labels: Map<string, string>; more?: NewsItemView[] }) {
  return (
    <li className="grid grid-cols-[44px_32px_minmax(0,1fr)] gap-3 px-4 py-3 sm:px-5" data-testid="news-item" data-news-id={item.id}>
      <span className="pt-0.5 text-small font-semibold tabular-nums text-muted">{timeOf(item.publishedAt)}</span>
      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-field px-0.5 text-micro font-bold text-ink" title={item.source} aria-hidden="true">
        {monogram(item.source)}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="m-0 text-body font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1.5 underline-offset-2 hover:text-link hover:underline">
            <span>{item.title}</span>
            <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
            <span className="sr-only">, откроется на сайте источника</span>
          </a>
        </h3>
        {item.summary ? (
          <p className="m-0 line-clamp-2 text-small text-muted [overflow-wrap:anywhere]" data-testid="news-summary" title={SUMMARY_LABELS[item.summaryBy]}>
            {/* Начало анонса подписано для диктора, пересказ Claude видимо (этап 59) */}
            <span className={item.summaryBy === "source" ? "sr-only" : "text-caption"}>{SUMMARY_LABELS[item.summaryBy]}: </span>
            {item.summary}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 text-caption text-muted">
          <span className="font-semibold text-text-secondary">{item.source}</span>
          <Directions item={item} labels={labels} />
        </div>
        {more.length ? (
          <details className="text-caption">
            <summary className="cursor-pointer font-semibold text-link">
              Ещё {more.length === 1 ? "в 1 источнике" : `в ${more.length} источниках`}
            </summary>
            {/* Каждая склеенная новость остаётся отдельной строкой списка: её видно поиском по странице и счётом в тестах */}
            <ul className="mt-1.5 flex list-none flex-col gap-1 p-0">
              {more.map((m) => (
                <li key={m.id} data-testid="news-item" data-news-id={m.id} className="flex flex-wrap items-baseline gap-x-2">
                  <a href={m.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink hover:text-link hover:underline">
                    {m.source}
                    <span className="sr-only">: {m.title}, откроется на сайте источника</span>
                  </a>
                  <span className="text-muted">{timeOf(m.publishedAt)}</span>
                  <span className="min-w-0 truncate text-muted" aria-hidden="true">{m.title}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Колонка «Официально» на широком экране: регулятор и союзы этой страницы, до шести, без повторов главной. Когда на
 * странице только официальные новости (например, отбор по одному продукту), колонка лишь повторила бы ленту: её нет
 */
function Official({ items, skip }: { items: NewsItemView[]; skip?: string }) {
  const list = items.filter((i) => i.id !== skip && OFFICIAL.test(i.source)).slice(0, 6);
  if (!list.length || items.every((i) => OFFICIAL.test(i.source))) return null;
  return (
    <aside aria-labelledby="news-official" className="sv-card hidden self-start overflow-hidden xl:block" data-testid="news-official">
      <h2 id="news-official" className="m-0 border-b border-line bg-canvas px-4 py-2.5 text-body font-semibold text-ink">
        Официально
      </h2>
      <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
        {list.map((i) => (
          <li key={i.id} className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-caption font-semibold text-text-secondary">
              {i.source}, {timeOf(i.publishedAt)}
            </span>
            <a href={i.url} target="_blank" rel="noopener noreferrer" className="line-clamp-3 text-small font-semibold text-ink hover:text-link hover:underline">
              {i.title}
              <span className="sr-only">, откроется на сайте источника</span>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Лента по дням (этап 68): день одной карточкой, внутри строки «время, значок источника, заголовок, описание в две
 * строки, продукты», как в лентах информагентств. lead: сверху главная новость, в ленте она не повторяется
 */
export function NewsList({ items, labels, now = new Date(), empty, lead = false }: { items: NewsItemView[]; labels: Map<string, string>; now?: Date; empty: { title: string; text: string }; lead?: boolean }) {
  if (!items.length) {
    return (
      <EmptyState title={empty.title} icon={Newspaper}>
        {empty.text}
      </EmptyState>
    );
  }
  const top = lead ? pickLead(items, now) : null;
  const rest = top ? items.filter((i) => i.id !== top.id) : items;
  const groups: { label: string; items: NewsItemView[] }[] = [];
  for (const item of rest) {
    const label = dayLabel(item.publishedAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return (
    <div className={cn("grid items-start gap-6", lead && "xl:grid-cols-[minmax(0,1fr)_300px]")}>
    <div className="flex min-w-0 flex-col gap-6" data-testid="news-list">
      {top ? <LeadCard item={top} labels={labels} /> : null}
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="sv-card overflow-hidden">
          <h2 className="m-0 flex items-baseline gap-2 border-b border-line bg-canvas px-4 py-2.5 text-body font-semibold text-ink sm:px-5">
            {g.label}
            <span className="text-caption font-normal text-muted">
              {g.items.length} {g.items.length % 10 === 1 && g.items.length % 100 !== 11 ? "новость" : [2, 3, 4].includes(g.items.length % 10) && ![12, 13, 14].includes(g.items.length % 100) ? "новости" : "новостей"}
            </span>
          </h2>
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {groupTopics(g.items).map((t) => (
              <NewsRow key={t.head.id} item={t.head} more={t.more} labels={labels} />
            ))}
          </ul>
        </section>
      ))}
    </div>
    {lead ? <Official items={items} skip={top?.id} /> : null}
    </div>
  );
}
