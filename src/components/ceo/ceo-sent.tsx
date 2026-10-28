// Отчёт CEO глазами CEO (этап 61): weekly, которые отправили из приложения по итогам встречи, собранными так же, как
// страница «Отчёт CEO» собирает их для владельца: цифры недели, итог прогноза месяца, разделы, решения, благодарности,
// «Мои встречи недели». Только чтение: правят отчёт владелец и администраторы в режиме управления. Этап 66: отчёт по
// смысловым блокам, старые отчёты как раньше.

import Link from "next/link";
import type { CeoInboxView } from "@/lib/ceo/report";
import { EmptyState } from "@/components/empty-state";
import { CeoAssembled } from "@/components/ceo/ceo-assembled";
import { cn } from "@/lib/cn";

const moment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");

export function CeoSentReport({ view }: { view: CeoInboxView }) {
  const c = view.current;
  if (!c) return <EmptyState title="Отчётов пока не отправляли">Когда руководитель отправит weekly по итогам встречи, он появится здесь, а на «Моей неделе» появится событие.</EmptyState>;
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_260px] lg:gap-8">
      <article className="flex min-w-0 flex-col gap-5" data-testid="ceo-sent-report">
        <div>
          <h2 className="text-title font-semibold text-ink">Отчёт за неделю {c.number}</h2>
          <p className="mt-1 text-body text-muted">
            Отправлен {moment(c.sentAt)}
            {c.sentBy ? `, отправил ${c.sentBy}` : ""}
            {c.editedAfter ? ". После отправки отчёт поправили в приложении: здесь отправленная версия" : ""}
          </p>
        </div>
        <CeoAssembled ctx={c.ctx} sections={c.sections} blocks={c.blocks} labels={c.labels} order={c.order} meetings={c.meetings} idPrefix="ceo-sent" />
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
