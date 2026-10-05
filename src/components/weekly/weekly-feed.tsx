"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, MonitorPlay, PenLine } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { feedWeek, meetingDateOf } from "@/prototype/data";
import { formatLong } from "@/prototype/dates";
import { PEOPLE, authorName } from "@/prototype/people";
import { BLOCKS, DIRECTIONS, ENTRY_TYPES, type BlockCode, type DirectionCode, type EntryTypeCode } from "@/prototype/dictionaries";
import type { PersonSlug, WeeklyEntry } from "@/prototype/types";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";
import { Chip, Segmented, SelectField } from "@/components/ui/primitives";
import { WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { EntryItem } from "./entry-item";
import { SubmissionStrip } from "./submission-strip";

type View = "people" | "blocks";

export function useWeekParam() {
  const { data } = usePrototype();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Пока за отчётную неделю никто не сдал, по умолчанию открывается последняя разобранная
  const fallback = feedWeek(data);
  const week = Number(params.get("week")) || fallback;
  const setWeek = (w: number) => router.replace(w === fallback ? pathname : `${pathname}?week=${w}`, { scroll: false });
  return { week, setWeek, isFallback: !params.get("week") && fallback !== data.reportingWeek };
}

export function WeekSwitcher({ week, setWeek }: { week: number; setWeek: (w: number) => void }) {
  const { data } = usePrototype();
  const current = week === data.reportingWeek;
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-surface p-1" role="group" aria-label="Выбор недели">
      <button type="button" onClick={() => setWeek(week - 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-white" aria-label="Предыдущая неделя">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="min-w-36 px-2 text-center text-[14px] font-semibold text-ink" aria-live="polite">
        Неделя {week}
        {current ? <span className="font-normal text-muted"> отчётная</span> : null}
      </span>
      <button
        type="button"
        onClick={() => setWeek(week + 1)}
        disabled={current}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-white disabled:text-line disabled:hover:bg-transparent"
        aria-label="Следующая неделя"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function WeeklyFeed() {
  const { data, me } = usePrototype();
  const { week, setWeek, isFallback } = useWeekParam();
  const [view, setView] = useState<View>("people");
  const [direction, setDirection] = useState<DirectionCode | "">("");
  const [block, setBlock] = useState<BlockCode | "">("");
  const [type, setType] = useState<EntryTypeCode | "">("");
  const [author, setAuthor] = useState<PersonSlug | "">("");
  const [helpOnly, setHelpOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const all = data.entries.filter((e) => e.week === week);
  const entries = all.filter(
    (e) =>
      (!direction || e.direction === direction) &&
      (!block || e.block === block) &&
      (!type || e.type === type) &&
      (!author || e.author === author) &&
      (!helpOnly || !!e.help),
  );
  const helpEntries = entries.filter((e) => e.help);
  const myWeekly = data.weeklies.find((w) => w.week === data.reportingWeek && w.author === me.slug);
  const filtersOn = !!(direction || block || type || author || helpOnly);

  return (
    <div>
      <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight text-ink sm:text-[30px]">Weekly</h1>
          <p className="mt-1.5 text-[15px] text-muted">Итоги недели команды по людям и по блокам</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="col-span-2 sm:col-span-1">
            <WeekSwitcher week={week} setWeek={setWeek} />
          </div>
          <Link href="/weekly/meeting" className={buttonClass("secondary", "md", "px-3 sm:px-5")}>
            <MonitorPlay className="h-4 w-4" aria-hidden="true" />
            <span className="sm:hidden">Встреча</span>
            <span className="hidden sm:inline">Режим встречи</span>
          </Link>
          <Link href="/weekly/submit" className={buttonClass("primary", "md", "px-3 sm:px-5")}>
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {myWeekly?.state === "submitted" || myWeekly?.state === "late" ? "Мой weekly" : myWeekly?.state === "draft" ? "Продолжить weekly" : "Сдать weekly"}
          </Link>
        </div>
      </header>

      {isFallback ? (
        <p className="mb-4 rounded-xl border border-line px-5 py-3 text-[15px] text-ink">
          За неделю {data.reportingWeek} записей пока нет. Показана неделя {week}
          {meetingDateOf(week) ? `, её разбирали на встрече ${formatLong(meetingDateOf(week)!)}` : ""}.{" "}
          <button type="button" onClick={() => setWeek(data.reportingWeek)} className="font-medium text-blue-700 hover:underline">
            Открыть неделю {data.reportingWeek}
          </button>
        </p>
      ) : null}

      <SubmissionStrip week={week} />

      <div className="mt-6 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-center justify-between gap-3">
        <Segmented
          label="Вид ленты"
          value={view}
          onChange={setView}
          options={[
            { value: "people", label: "По людям" },
            { value: "blocks", label: "По блокам" },
          ]}
        />
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-[15px] font-medium text-blue-700 hover:bg-surface lg:hidden"
          >
            Фильтры{filtersOn ? " включены" : ""}
          </button>
        </div>
        <div className={cn("grid-cols-2 gap-3 sm:flex-wrap sm:items-end lg:flex", showFilters ? "grid sm:flex" : "hidden")}>
          <SelectField label="Направление" id="f-dir" value={direction} onChange={(e) => setDirection(e.target.value as DirectionCode | "")} className="sm:w-44" options={[{ value: "", label: "Все" }, ...DIRECTIONS.map((d) => ({ value: d.code, label: d.label }))]} />
          <SelectField label="Блок" id="f-block" value={block} onChange={(e) => setBlock(e.target.value as BlockCode | "")} className="sm:w-48" options={[{ value: "", label: "Все" }, ...BLOCKS.map((b) => ({ value: b.code, label: b.label }))]} />
          <SelectField label="Тип" id="f-type" value={type} onChange={(e) => setType(e.target.value as EntryTypeCode | "")} className="sm:w-36" options={[{ value: "", label: "Все" }, ...ENTRY_TYPES.map((t) => ({ value: t.code, label: t.label }))]} />
          <SelectField label="Автор" id="f-author" value={author} onChange={(e) => setAuthor(e.target.value as PersonSlug | "")} className="sm:w-44" options={[{ value: "", label: "Все" }, ...PEOPLE.map((p) => ({ value: p.slug, label: p.fullName }))]} />
          <div className="col-span-2 sm:col-span-1">
            <Chip active={helpOnly} onClick={() => setHelpOnly((v) => !v)} count={all.filter((e) => e.help).length}>
              Нужна помощь
            </Chip>
          </div>
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyState title={`За неделю ${week} записей нет`} className="mt-6">
          В прототипе есть недели {[...new Set(data.entries.map((e) => e.week))].sort((a, b) => a - b).join(" и ")} из Insurance&Invest Bord. В рабочей версии архив хранится без ограничения срока.
        </EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState title="Под эти фильтры записей нет" className="mt-6">
          {filtersOn ? "Снимите часть фильтров." : null}
        </EmptyState>
      ) : view === "people" ? (
        <div className="mt-6 flex flex-col gap-6">
          {helpEntries.length && !helpOnly ? <HelpBlock entries={helpEntries} /> : null}
          <PeopleView week={week} entries={entries} />
        </div>
      ) : (
        <BlocksView entries={entries} />
      )}
    </div>
  );
}

/** Запросы помощи поднимаются наверх ленты: с них удобно начинать встречу */
function HelpBlock({ entries }: { entries: WeeklyEntry[] }) {
  return (
    <section aria-labelledby="help-title" className="rounded-xl border border-[#f0dfa6] bg-warning-soft/50 px-5 py-4">
      <h2 id="help-title" className="text-[17px] font-semibold text-ink">
        Нужна помощь <span className="font-normal text-muted">{entries.length}</span>
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {entries.map((e) => (
          <li key={e.id} className="text-[15px]">
            <span className="font-semibold text-ink">{authorName(e.author, "short", "Общее")}:</span> {e.what}.{" "}
            <span className="font-medium text-warning-ink">{e.help}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PeopleView({ week, entries }: { week: number; entries: WeeklyEntry[] }) {
  const { data, manage, assignAuthor } = usePrototype();
  const rank = { submitted: 0, late: 0, draft: 1, "not-started": 2 } as const;
  const stateOf = (slug: PersonSlug) => data.weeklies.find((w) => w.week === week && w.author === slug)?.state ?? "not-started";
  // Сначала сдавшие, потом черновики, в конце те, кто не начинал
  const authors = PEOPLE.filter((p) => entries.some((e) => e.author === p.slug) || data.weeklies.some((w) => w.week === week && w.author === p.slug)).sort(
    (a, b) => rank[stateOf(a.slug)] - rank[stateOf(b.slug)],
  );
  const common = entries.filter((e) => !e.author);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      {common.length ? (
        <section aria-labelledby="wk-common" className="flex flex-col rounded-xl ring-1 ring-line xl:col-span-2">
          <header className="border-b border-line px-5 py-4">
            <h2 id="wk-common" className="text-[17px] font-semibold text-ink">
              Общее, без автора <span className="font-normal text-muted">{common.length}</span>
            </h2>
            <p className="mt-1 text-[15px] text-muted">
              В таблице записаны на «Все лидеры».{manage ? " Назначьте автора, и запись переедет в его weekly" : " Автора назначает владелец или администратор"}
            </p>
          </header>
          <ul className="flex flex-col divide-y divide-line">
            {common.map((e) => (
              <li key={e.id} className="flex flex-col gap-3 px-5 py-4">
                <EntryItem entry={e} />
                {manage ? (
                  <SelectField
                    label="Автор"
                    id={`assign-${e.id}`}
                    value=""
                    onChange={(ev) => ev.target.value && assignAuthor(e.id, ev.target.value as PersonSlug)}
                    className="sm:w-72"
                    options={[{ value: "", label: "Выберите, кто берёт" }, ...PEOPLE.map((p) => ({ value: p.slug, label: p.fullName }))]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {authors.map((p) => {
        const weekly = data.weeklies.find((w) => w.week === week && w.author === p.slug);
        const own = entries.filter((e) => e.author === p.slug);
        const state = weekly?.state ?? "not-started";
        return (
          <section key={p.slug} aria-labelledby={`wk-${p.slug}`} className="flex flex-col rounded-xl ring-1 ring-line">
            <header className="border-b border-line px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`wk-${p.slug}`} className="text-[17px] font-semibold text-ink">
                  {p.fullName}
                </h2>
                <div className="flex items-center gap-2">
                  {weekly?.submittedAt ? <span className="text-[13px] text-muted">{weekly.submittedAt}</span> : null}
                  <WeeklyBadge state={state} />
                </div>
              </div>
              {weekly?.headline ? (
                <p className="mt-2 text-[16px] leading-snug text-ink">{weekly.headline}</p>
              ) : week === data.reportingWeek ? (
                <p className="mt-2 text-[15px] text-muted">{state === "not-started" ? "Ещё не начинал" : "Главная фраза пока не написана"}</p>
              ) : null}
            </header>
            {own.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {own.map((e) => (
                  <li key={e.id} className="px-5 py-4">
                    <EntryItem entry={e} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={cn("px-5 py-4 text-[15px] text-muted")}>Записей нет</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function BlocksView({ entries }: { entries: WeeklyEntry[] }) {
  // Риски первыми: с них начинается разбор
  const order: BlockCode[] = ["risks", "key-changes", "numbers", "traffic", "partners", "product", "team"];
  return (
    <div className="mt-6 flex flex-col gap-6">
      {order.map((code) => {
        const list = entries.filter((e) => e.block === code);
        if (!list.length) return null;
        return (
          <section key={code} aria-labelledby={`blk-${code}`} className="rounded-xl ring-1 ring-line">
            <h2 id={`blk-${code}`} className="border-b border-line px-5 py-3 text-[17px] font-semibold text-ink">
              {BLOCKS.find((b) => b.code === code)!.label} <span className="font-normal text-muted">{list.length}</span>
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {list.map((e) => (
                <li key={e.id} className="px-5 py-4">
                  <EntryItem entry={e} showAuthor />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

