"use client";

// Переключатель недель ленты weekly, встречи и отчёта CEO (этап 73б: отдельный лёгкий файл, без ленты weekly)

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { WeekView } from "@/domain/types";

/** Переключатель недель: прошлые недели листаются без ограничения, дальше отчётной нельзя */
export function WeekSwitcher({ view, basePath = "/weekly", query = "" }: { view: Pick<WeekView, "week" | "prev" | "next" | "reportingKey">; basePath?: string; query?: string }) {
  const router = useRouter();
  // query: что ещё сохранить при смене недели, например отбор по автору в ленте weekly
  const go = (key: string) => router.push(`${basePath}?week=${key}${query}`, { scroll: false });
  // Вид по дизайн-системе (navigation/WeekSwitcher.jsx, sv-week): стрелки, номер, «отчётная», «Текущая»
  return (
    <div className="sv-week" role="group" aria-label="Выбор недели">
      <button type="button" onClick={() => go(view.prev)} className="sv-icon-btn sv-icon-btn--sm" aria-label="Предыдущая неделя">
        <ChevronLeft className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <span className="sv-week__label cursor-default hover:bg-transparent" aria-live="polite">
        <span>Неделя {view.week.number}</span>
        {view.week.reporting ? <span className="sv-week__dates">отчётная</span> : null}
      </span>
      {!view.week.reporting ? (
        <button type="button" className="sv-week__now" onClick={() => go(view.reportingKey)}>
          Текущая
        </button>
      ) : null}
      <button type="button" onClick={() => view.next && go(view.next)} disabled={!view.next} className="sv-icon-btn sv-icon-btn--sm" aria-label="Следующая неделя">
        <ChevronRight className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
