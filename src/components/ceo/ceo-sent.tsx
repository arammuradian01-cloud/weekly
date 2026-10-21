// Отчёт CEO глазами CEO (этап 61): weekly, которые отправили из приложения по итогам встречи. Только чтение: правят
// отчёт владелец и администраторы в режиме управления, CEO видит отправленную версию и прошлые недели.

import Link from "next/link";
import type { CeoInboxView } from "@/lib/meeting/parse-service";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/cn";

const moment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");

const SECTIONS = [
  { key: "main", label: "Главное" },
  { key: "risks", label: "Риски" },
  { key: "next", label: "Что дальше" },
] as const;

export function CeoSentReport({ view }: { view: CeoInboxView }) {
  const c = view.current;
  if (!c) return <EmptyState title="Отчётов пока не отправляли">Когда руководитель отправит weekly по итогам встречи, он появится здесь, а в «Мне» придёт событие.</EmptyState>;
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8">
      <article className="flex min-w-0 flex-col gap-5" data-testid="ceo-sent-report">
        <div>
          <h2 className="text-title font-semibold text-ink">Неделя {c.number}</h2>
          <p className="mt-1 text-body text-muted">
            Отправлен {moment(c.sentAt)}
            {c.sentBy ? `, отправил ${c.sentBy}` : ""}
            {c.editedAfter ? ". После отправки отчёт поправили: здесь последняя версия" : ""}
          </p>
        </div>
        {SECTIONS.map((s) => (
          <section key={s.key} aria-labelledby={`ceo-sent-${s.key}`}>
            <h3 id={`ceo-sent-${s.key}`} className="text-title-sm font-semibold text-ink">
              {s.label}
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-body text-ink">{c.sections[s.key].trim() || <span className="text-muted">Раздел пустой</span>}</p>
          </section>
        ))}
      </article>
      <nav aria-label="Отправленные недели" className="flex flex-col gap-1">
        <p className="mb-1 text-caption font-semibold text-muted">Отправленные недели</p>
        {view.weeks.map((w) => (
          <Link
            key={w.key}
            href={`/ceo-report?week=${w.key}`}
            aria-current={w.key === c.key ? "page" : undefined}
            className={cn("rounded-lg px-3 py-2 text-small", w.key === c.key ? "bg-accent-soft font-semibold text-link" : "text-ink hover:bg-field")}
          >
            Неделя {w.number}
            <span className="block text-caption font-normal text-muted">{moment(w.sentAt)}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
