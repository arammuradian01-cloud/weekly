"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { PEOPLE, authorName, personOf } from "@/domain/people";
import { usePrototype } from "@/domain/store";
import { teamOf } from "@/domain/teams";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { WeeklyBadge } from "@/components/ui/task-badges";
import type { PersonSlug, WeekView } from "@/domain/types";
import { EntryItem } from "./entry-item";
import { AbsentBadge, absentLine, substituteText } from "./absence";

/**
 * Режим встречи: крупный шрифт для экрана в переговорной.
 * Сначала риски и запросы помощи, потом лидеры по очереди (раздел 3 ТЗ).
 */
export function MeetingMode({ view }: { view: WeekView }) {
  // Пока за отчётную неделю записей нет, встреча открывается на последней разобранной неделе (сервер выбирает её сам)
  const week = view.week.number;
  const entries = view.entries;
  // Лидеры по очереди, владелец последним. Общие записи без автора отдельным шагом после рисков
  const gone = [...new Set(entries.map((e) => e.author).filter((s): s is string => !!s && !PEOPLE.some((p) => p.slug === s)))].map(personOf);
  // Руководитель выбранной команды (в топ-команде владелец) рассказывает последним
  const { team } = usePrototype();
  const lead = teamOf(team.id)?.leader;
  const last = (p: { slug: string; role: string }) => Number(p.slug === lead || p.role === "OWNER");
  const leaders = [...PEOPLE, ...gone].filter((p) => entries.some((e) => e.author === p.slug)).sort((a, b) => last(a) - last(b));
  const hasCommon = entries.some((e) => !e.author);
  const slides: string[] = ["risks", ...(hasCommon ? ["common"] : []), ...leaders.map((p) => p.slug)];
  const [index, setIndex] = useState(0);
  const slide = slides[index]!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") setIndex((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  const risky = entries.filter((e) => e.type === "risk" || e.help).sort((a, b) => Number(!!b.help) - Number(!!a.help));
  const weekly = slide !== "risks" && slide !== "common" ? view.reports.find((w) => w.author === slide) : undefined;

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Порядок встречи">
          {slides.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? "step" : undefined}
                className={cn(
                  "inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-body",
                  i === index ? "bg-navy font-semibold text-white" : "bg-white text-ink ring-1 ring-line hover:ring-navy-600/40",
                )}
              >
                {s === "risks" ? "Риски и помощь" : s === "common" ? "Общее" : personOf(s as PersonSlug).shortName}
              </button>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
            На весь экран
          </Button>
          <Link href={`/weekly?week=${view.week.key}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-navy hover:bg-surface">
            <X className="h-4 w-4" aria-hidden="true" />
            Выйти
          </Link>
        </div>
      </div>

      <section aria-live="polite" className="flex-1">
        {slide === "risks" ? (
          <>
            <h1 className="text-display-sm font-semibold leading-tight text-ink sm:text-display">Риски и запросы помощи</h1>
            <p className="mt-2 text-title text-muted">Неделя {week}. С этого начинаем</p>
            {absentLine(view.reports) ? <p className="mt-3 text-title-sm text-ink">Нет на этой неделе: {absentLine(view.reports)}.</p> : null}
            {risky.length === 0 ? <p className="mt-8 text-title text-muted">Рисков и запросов помощи на этой неделе нет.</p> : null}
            <ul className="mt-8 flex flex-col gap-8">
              {risky.map((e) => (
                <li key={e.id} className="border-l-4 border-danger pl-5">
                  <h2 className="text-title-sm font-semibold text-muted">{authorName(e.author, "full", "Общее, без автора")}</h2>
                  <EntryItem entry={e} large />
                </li>
              ))}
            </ul>
          </>
        ) : slide === "common" ? (
          <>
            <h1 className="text-display-sm font-semibold leading-tight text-ink sm:text-display">Общее, без автора</h1>
            <p className="mt-2 text-title text-muted">Записи на «Все лидеры»: решаем, кто их берёт</p>
            <h2 className="sr-only">Записи weekly</h2>
            <ul className="mt-8 flex flex-col gap-8">
              {entries
                .filter((e) => !e.author)
                .map((e) => (
                  <li key={e.id} className="max-w-[72ch]">
                    <EntryItem entry={e} large />
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-display-sm font-semibold leading-tight text-ink sm:text-display">{personOf(slide as PersonSlug).fullName}</h1>
              {weekly?.absent && weekly.state !== "submitted" && weekly.state !== "late" ? <AbsentBadge /> : <WeeklyBadge state={weekly?.state ?? "not-started"} />}
            </div>
            {weekly?.headline ? <p className="mt-3 max-w-[60ch] text-headline leading-snug text-ink">{weekly.headline}</p> : null}
            {weekly?.absent && !weekly.headline ? <p className="mt-3 text-title text-muted">Нет на этой неделе, {substituteText(weekly.absent.substitute)}</p> : null}
            <h2 className="sr-only">Записи weekly</h2>
            <ul className="mt-8 flex flex-col gap-8">
              {entries
                .filter((e) => e.author === slide)
                .sort((a, b) => Number(b.type === "risk" || !!b.help) - Number(a.type === "risk" || !!a.help))
                .map((e) => (
                  <li key={e.id} className="max-w-[72ch]">
                    <EntryItem entry={e} large />
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      <div className="sticky bottom-20 mt-10 flex items-center justify-between gap-3 border-t border-line bg-white/95 py-3 lg:bottom-0">
        <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Назад
        </Button>
        <span className="text-body tabular-nums text-muted">
          {index + 1} из {slides.length}
        </span>
        <Button onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))} disabled={index === slides.length - 1}>
          Дальше
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
