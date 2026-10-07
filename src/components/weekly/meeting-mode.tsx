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
import type { PersonSlug, WeekView, WeeklyEntry } from "@/domain/types";
import { EntryItem } from "./entry-item";
import { AbsentBadge, absentLine, substituteText } from "./absence";
import type { MeetingQuestion } from "@/lib/discuss/service";
import { MeetingQuestions, type StuckItems } from "./meeting-questions";

/**
 * Режим встречи: крупный шрифт для экрана в переговорной.
 * Сначала риски и запросы помощи, потом лидеры по очереди (раздел 3 ТЗ).
 */
export function MeetingMode({ view, questions = [], stuck = { requests: [], proposals: [] } }: { view: WeekView; questions?: MeetingQuestion[]; stuck?: StuckItems }) {
  // Пока за отчётную неделю записей нет, встреча открывается на последней разобранной неделе (сервер выбирает её сам)
  const week = view.week.number;
  const entries = view.entries;
  // Лидеры по очереди, владелец последним. Общие записи без автора отдельным шагом после рисков
  const gone = [...new Set(entries.map((e) => e.author).filter((s): s is string => !!s && !PEOPLE.some((p) => p.slug === s)))].map(personOf);
  // Руководитель выбранной команды (в топ-команде владелец) рассказывает последним
  const { team } = usePrototype();
  const lead = teamOf(team.id)?.leader;
  const last = (p: { slug: string; role: string }) => Number(p.slug === lead || p.role === "OWNER");
  // Свои записи ленты и записи, поднятые наверх людьми команды (этап 15): поднятые рассказывает тот, кто их поднял
  const own = (e: WeeklyEntry) => !view.authors || (!!e.author && view.authors.includes(e.author));
  const raisedBy = (slug: string) => (view.authors && !view.authors.includes(slug) ? [] : entries.filter((e) => e.author !== slug && e.promoted?.some((x) => x.by === slug)));
  const leaders = [...PEOPLE, ...gone].filter((p) => entries.some((e) => e.author === p.slug && own(e)) || raisedBy(p.slug).length > 0).sort((a, b) => last(a) - last(b));
  const hasCommon = entries.some((e) => !e.author);
  // Этап 20: вопросы «Обсудить на встрече» первым шагом, если они есть
  // Этап 21: туда же зависшие просьбы и предложения задач без ответа
  const hasStuck = stuck.requests.length + stuck.proposals.length > 0;
  const slides: string[] = [...(questions.length || hasStuck ? ["questions"] : []), "risks", ...(hasCommon ? ["common"] : []), ...leaders.map((p) => p.slug)];
  // Шаг хранится по имени, а не по номеру: вопрос, добавленный во время встречи, не сдвигает экран ведущего,
  // а пропавший шаг (ушёл последний вопрос) открывает соседний
  const [current, setCurrent] = useState<string>(slides[0]!);
  const [lastIndex, setLastIndex] = useState(0);
  const found = slides.indexOf(current);
  const index = found >= 0 ? found : Math.min(lastIndex, slides.length - 1);
  const slide = slides[index]!;
  const setIndex = (next: number | ((i: number) => number)) => {
    const i = Math.max(0, Math.min(slides.length - 1, typeof next === "function" ? next(index) : next));
    setCurrent(slides[i]!);
    setLastIndex(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Стрелки в поле комментария двигают курсор, а не встречу
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true'], [role='menu']")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setIndex((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Обработчик знает текущий шаг: пересоздаётся при смене шага и состава шагов
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, slides.join("|")]);

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
                  i === index ? "bg-navy font-semibold text-white" : "bg-surface text-ink ring-1 ring-line hover:ring-border-strong",
                )}
              >
                {s === "questions" ? `Вопросы: ${questions.filter((q) => !q.discussed).length + stuck.requests.length + stuck.proposals.length}` : s === "risks" ? "Риски и помощь" : s === "common" ? "Общее" : personOf(s as PersonSlug).shortName}
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
          <Link href={`/weekly?week=${view.week.key}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-field">
            <X className="h-4 w-4" aria-hidden="true" />
            Выйти
          </Link>
        </div>
      </div>

      <section aria-live="polite" className="flex-1">
        {slide === "questions" ? (
          <MeetingQuestions week={week} questions={questions} stuck={stuck} />
        ) : slide === "risks" ? (
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
                .filter((e) => e.author === slide && own(e))
                .sort((a, b) => Number(b.type === "risk" || !!b.help) - Number(a.type === "risk" || !!a.help))
                .map((e) => (
                  <li key={e.id} className="max-w-[72ch]">
                    <EntryItem entry={e} large />
                  </li>
                ))}
            </ul>
            {raisedBy(slide).length ? (
              <>
                <h2 className="mt-10 text-title font-semibold text-ink">Из команды</h2>
                <ul className="mt-4 flex flex-col gap-8">
                  {raisedBy(slide).map((e) => {
                    const note = e.promoted?.find((x) => x.by === slide)?.note;
                    return (
                      <li key={e.id} className="max-w-[72ch]">
                        <EntryItem entry={e} large showAuthor />
                        {note ? <p className="mt-2 text-title text-ink">От себя: {note}</p> : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
          </>
        )}
      </section>

      <div className="sticky bottom-20 mt-10 flex items-center justify-between gap-3 border-t border-line bg-surface/95 py-3 lg:bottom-0">
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
