"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Lock, LockOpen, MonitorPlay, PenLine } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { formatLong } from "@/domain/dates";
import { PEOPLE, authorName, personOf } from "@/domain/people";
import { BLOCKS, DIRECTIONS, ENTRY_TYPES, blockLabel, type BlockCode, type DirectionCode, type EntryTypeCode } from "@/domain/dictionaries";
import type { PersonSlug, PersonWeekly, WeekInfo, WeekView, WeeklyEntry } from "@/domain/types";
import { assignEntryAuthorAction, setTeamWeekClosedAction, setWeekClosedAction } from "@/app/(app)/weekly/actions";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Chip, Segmented, SelectField } from "@/components/ui/primitives";
import { WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { EntryItem } from "./entry-item";
import { SubmissionStrip } from "./submission-strip";
import { AbsentBadge, substituteText } from "./absence";
import { useRunWeekly } from "./use-weekly";
import { PromoteControl, PromotedNote } from "./promote";

type View = "people" | "blocks";

/** Переключатель недель: прошлые недели листаются без ограничения, дальше отчётной нельзя */
export function WeekSwitcher({ view, basePath = "/weekly" }: { view: Pick<WeekView, "week" | "prev" | "next" | "reportingKey">; basePath?: string }) {
  const router = useRouter();
  const go = (key: string) => router.push(`${basePath}?week=${key}`, { scroll: false });
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-surface p-1" role="group" aria-label="Выбор недели">
      <button type="button" onClick={() => go(view.prev)} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-white" aria-label="Предыдущая неделя">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="min-w-36 px-2 text-center text-small font-semibold text-ink" aria-live="polite">
        Неделя {view.week.number}
        {view.week.reporting ? <span className="font-normal text-muted"> отчётная</span> : null}
      </span>
      <button
        type="button"
        onClick={() => view.next && go(view.next)}
        disabled={!view.next}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-white disabled:text-line disabled:hover:bg-transparent"
        aria-label="Следующая неделя"
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Закрыть неделю после встречи: дальше записи правят только владелец и администраторы */
function WeekLock({ week }: { week: WeekInfo }) {
  const run = useRunWeekly();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    await run(() => setWeekClosedAction(week.key, !week.closed), week.closed ? `Неделя ${week.number} снова открыта` : `Неделя ${week.number} закрыта`);
    setBusy(false);
  };
  return (
    <Button variant="secondary" onClick={toggle} disabled={busy} className="px-3 sm:px-5">
      {week.closed ? <LockOpen className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
      {week.closed ? "Открыть неделю" : "Закрыть неделю"}
    </Button>
  );
}

/** Неделя команды (этап 15): руководитель закрывает её после встречи команды, дальше люди команды свой weekly не правят */
function TeamWeekLock({ week, team }: { week: WeekInfo; team: { id: string; name: string } }) {
  const run = useRunWeekly();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    await run(() => setTeamWeekClosedAction(team.id, week.key, !week.closed), week.closed ? `Неделя ${week.number} команды снова открыта` : `Неделя ${week.number} команды закрыта`);
    setBusy(false);
  };
  return (
    <Button variant="secondary" onClick={toggle} disabled={busy} className="px-3 sm:px-5" aria-label={week.closed ? "Открыть неделю команды" : "Закрыть неделю команды"}>
      {week.closed ? <LockOpen className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
      <span className="sm:hidden">{week.closed ? "Открыть неделю" : "Закрыть неделю"}</span>
      <span className="hidden sm:inline">{week.closed ? "Открыть неделю команды" : "Закрыть неделю команды"}</span>
    </Button>
  );
}

type TeamWeek = { id: string; name: string } | null;

export function WeeklyFeed({
  view: data,
  myReport,
  promoteFrom = [],
  teamWeek = null,
  promoteClosed = false,
}: {
  view: WeekView;
  myReport: PersonWeekly;
  promoteFrom?: PersonSlug[];
  teamWeek?: TeamWeek;
  /** Мой weekly за эту неделю закрыт: поднимать записи наверх уже нельзя */
  promoteClosed?: boolean;
}) {
  const { manage, teamPeople } = usePrototype();
  const week = data.week;
  const [view, setView] = useState<View>("people");
  const [direction, setDirection] = useState<DirectionCode | "">("");
  const [block, setBlock] = useState<BlockCode | "">("");
  const [type, setType] = useState<EntryTypeCode | "">("");
  const [author, setAuthor] = useState<PersonSlug | "">("");
  const [helpOnly, setHelpOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const all = data.entries;
  const entries = all.filter(
    (e) =>
      (!direction || e.direction === direction) &&
      (!block || e.block === block) &&
      (!type || e.type === type) &&
      (!author || e.author === author) &&
      (!helpOnly || !!e.help),
  );
  const helpEntries = entries.filter((e) => e.help);
  const filtersOn = !!(direction || block || type || author || helpOnly);
  const myState = myReport.state;

  return (
    <div>
      <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-page font-semibold leading-tight text-ink sm:text-page-lg">Weekly</h1>
          <p className="mt-1.5 text-body text-muted">Итоги недели команды по людям и по блокам</p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <div className="col-span-2 sm:col-span-1">
            <WeekSwitcher view={data} />
          </div>
          <Link href={`/weekly/meeting?week=${week.key}`} className={buttonClass("secondary", "md", "px-3 sm:px-5")}>
            <MonitorPlay className="h-4 w-4" aria-hidden="true" />
            <span className="sm:hidden">Встреча</span>
            <span className="hidden sm:inline">Режим встречи</span>
          </Link>
          <Link href="/weekly/submit" className={buttonClass("primary", "md", "px-3 sm:px-5")}>
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {myState === "submitted" || myState === "late" ? "Мой weekly" : myState === "draft" ? "Продолжить weekly" : "Сдать weekly"}
          </Link>
          {teamWeek && !data.departmentClosed ? <TeamWeekLock week={week} team={teamWeek} /> : null}
          {manage ? <WeekLock week={{ ...week, closed: data.departmentClosed ?? week.closed }} /> : null}
        </div>
      </header>

      {data.fallback ? (
        <p className="mb-4 rounded-xl border border-line px-5 py-3 text-body text-ink">
          За неделю {data.reportingNumber} записей пока нет. Показана неделя {week.number}, её разбирали на встрече {formatLong(week.meetingDate)}.{" "}
          <Link href={`/weekly?week=${data.reportingKey}`} className="font-medium text-blue-700 hover:underline">
            Открыть неделю {data.reportingNumber}
          </Link>
        </p>
      ) : null}

      {week.closed ? (
        <p className="mb-4 inline-flex items-center gap-2 text-small text-muted">
          <Lock className="h-4 w-4" aria-hidden="true" />
          {teamWeek && !data.departmentClosed ? "Неделя команды закрыта: люди команды свой weekly больше не правят" : "Неделя закрыта: записи правят только владелец и администраторы"}
        </p>
      ) : null}

      <SubmissionStrip reports={data.reports} />

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
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-body font-medium text-blue-700 hover:bg-surface lg:hidden"
          >
            Фильтры{filtersOn ? " включены" : ""}
          </button>
        </div>
        <div className={cn("grid-cols-2 gap-3 sm:flex-wrap sm:items-end lg:flex", showFilters ? "grid sm:flex" : "hidden")}>
          <SelectField label="Направление" id="f-dir" value={direction} onChange={(e) => setDirection(e.target.value as DirectionCode | "")} className="sm:w-44" options={[{ value: "", label: "Все" }, ...DIRECTIONS.map((d) => ({ value: d.code, label: d.label }))]} />
          <SelectField label="Блок" id="f-block" value={block} onChange={(e) => setBlock(e.target.value as BlockCode | "")} className="sm:w-48" options={[{ value: "", label: "Все" }, ...BLOCKS.map((b) => ({ value: b.code, label: b.label }))]} />
          <SelectField label="Тип" id="f-type" value={type} onChange={(e) => setType(e.target.value as EntryTypeCode | "")} className="sm:w-36" options={[{ value: "", label: "Все" }, ...ENTRY_TYPES.map((t) => ({ value: t.code, label: t.label }))]} />
          <SelectField label="Автор" id="f-author" value={author} onChange={(e) => setAuthor(e.target.value as PersonSlug | "")} className="sm:w-44" options={[{ value: "", label: "Все" }, ...teamPeople.map((p) => ({ value: p.slug, label: p.fullName }))]} />
          <div className="col-span-2 sm:col-span-1">
            <Chip active={helpOnly} onClick={() => setHelpOnly((v) => !v)} count={all.filter((e) => e.help).length}>
              Нужна помощь
            </Chip>
          </div>
        </div>
      </div>

      {all.length === 0 ? (
        <EmptyState title={`За неделю ${week.number} записей нет`} className="mt-6">
          {week.reporting ? "Записи появятся, как только лидеры начнут писать weekly." : "Архив хранится без ограничения срока: листайте недели назад."}
        </EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState title="Под эти фильтры записей нет" className="mt-6">
          {filtersOn ? "Снимите часть фильтров." : null}
        </EmptyState>
      ) : view === "people" ? (
        <div className="mt-6 flex flex-col gap-6">
          {helpEntries.length && !helpOnly ? <HelpBlock entries={helpEntries} /> : null}
          <PeopleView reports={data.reports} entries={entries} reporting={week.reporting} feedAuthors={data.authors} promoteFrom={promoteFrom} closed={promoteClosed} />
        </div>
      ) : (
        <BlocksView entries={entries} promoteFrom={promoteFrom} closed={promoteClosed} />
      )}
    </div>
  );
}

/** Запросы помощи поднимаются наверх ленты: с них удобно начинать встречу */
function HelpBlock({ entries }: { entries: WeeklyEntry[] }) {
  return (
    <section aria-labelledby="help-title" className="rounded-xl border border-warning-line bg-warning-soft/50 px-5 py-4">
      <h2 id="help-title" className="text-title-sm font-semibold text-ink">
        Нужна помощь <span className="font-normal text-muted">{entries.length}</span>
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {entries.map((e) => (
          <li key={e.id} className="text-body">
            <span className="font-semibold text-ink">{authorName(e.author, "short", "Общее")}:</span> {e.what}.{" "}
            <span className="font-medium text-warning-ink">{e.help}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PeopleView({
  reports,
  entries,
  reporting,
  feedAuthors,
  promoteFrom,
  closed,
}: {
  reports: PersonWeekly[];
  entries: WeeklyEntry[];
  reporting: boolean;
  feedAuthors?: PersonSlug[];
  promoteFrom: PersonSlug[];
  closed: boolean;
}) {
  const { manage, teamPeople } = usePrototype();
  const run = useRunWeekly();
  const rank = { submitted: 0, late: 0, draft: 1, "not-started": 2 } as const;
  const reportOf = (slug: PersonSlug) => reports.find((w) => w.author === slug);
  const stateOf = (slug: PersonSlug) => reportOf(slug)?.state ?? "not-started";
  // Сначала сдавшие, потом черновики, в конце те, кто не начинал
  // Записи тех, кого уже выключили, остаются в ленте прошлых недель
  // Свои записи ленты: авторы из команды. Записи, которые пришли наверх, видны у того, кто их поднял (этап 15)
  const ownFeed = (e: WeeklyEntry) => !feedAuthors || (!!e.author && feedAuthors.includes(e.author));
  const promotedBy = (slug: PersonSlug) => entries.filter((e) => e.author !== slug && e.promoted?.some((p) => p.by === slug));
  // Кто сдаёт по желанию (этап 15), появляется в ленте, только если что-то написал или сдал
  const listed = (w: PersonWeekly) => !w.optional || w.state !== "not-started";
  const inFeed = (slug: PersonSlug) =>
    entries.some((e) => e.author === slug && ownFeed(e)) || reports.some((w) => w.author === slug && listed(w)) || (!!feedAuthors?.includes(slug) && promotedBy(slug).length > 0);
  const gone = [...new Set(entries.map((e) => e.author).filter((s): s is PersonSlug => !!s && !PEOPLE.some((p) => p.slug === s)))].map(personOf);
  const authors = [...PEOPLE, ...gone].filter((p) => inFeed(p.slug)).sort((a, b) => rank[stateOf(a.slug)] - rank[stateOf(b.slug)]);
  const assignAuthor = (id: string, slug: PersonSlug) =>
    void run(() => assignEntryAuthorAction(id, slug), `Запись передана: ${personOf(slug).fullName}`);
  const common = entries.filter((e) => !e.author);
  return (
    <div className="grid items-start gap-5 xl:grid-cols-2">
      {common.length ? (
        <section aria-labelledby="wk-common" className="flex flex-col rounded-xl ring-1 ring-line xl:col-span-2">
          <header className="border-b border-line px-5 py-4">
            <h2 id="wk-common" className="text-title-sm font-semibold text-ink">
              Общее, без автора <span className="font-normal text-muted">{common.length}</span>
            </h2>
            <p className="mt-1 text-body text-muted">
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
                    options={[{ value: "", label: "Выберите, кто берёт" }, ...teamPeople.map((p) => ({ value: p.slug, label: p.fullName }))]}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {authors.map((p) => {
        const weekly = reportOf(p.slug);
        const own = entries.filter((e) => e.author === p.slug && ownFeed(e));
        const fromTeam = feedAuthors?.includes(p.slug) ?? true ? promotedBy(p.slug) : [];
        const state = weekly?.state ?? "not-started";
        return (
          <section key={p.slug} aria-labelledby={`wk-${p.slug}`} className="flex flex-col rounded-xl ring-1 ring-line">
            <header className="border-b border-line px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`wk-${p.slug}`} className="text-title-sm font-semibold text-ink">
                  {p.fullName}
                </h2>
                <div className="flex items-center gap-2">
                  {weekly?.deadline && state !== "submitted" && state !== "late" ? <span className="text-caption text-muted">{deadlineText(weekly.deadline)}</span> : null}
                  {weekly?.submittedAt ? <span className="text-caption text-muted">{submittedText(weekly.submittedAt)}</span> : null}
                  {weekly?.absent && state !== "submitted" && state !== "late" ? <AbsentBadge /> : <WeeklyBadge state={state} />}
                </div>
              </div>
              {weekly?.headline ? (
                <p className="mt-2 text-lead leading-snug text-ink">{weekly.headline}</p>
              ) : weekly?.absent ? (
                <p className="mt-2 text-body text-muted">Нет на этой неделе, {substituteText(weekly.absent.substitute)}</p>
              ) : reporting ? (
                <p className="mt-2 text-body text-muted">{state === "not-started" ? "Ещё не начинал" : "Главная фраза пока не написана"}</p>
              ) : null}
              {weekly?.thanks ? (
                <p className="mt-1.5 text-body text-ink">
                  <span className="text-muted">Спасибо: </span>
                  {weekly.thanks}
                </p>
              ) : null}
            </header>
            {own.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {own.map((e) => (
                  <li key={e.id} className="flex flex-col gap-2 px-5 py-4">
                    <EntryItem entry={e} />
                    <PromotedNote entry={e} />
                    <PromoteControl entry={e} promoteFrom={promoteFrom} closed={closed} />
                  </li>
                ))}
              </ul>
            ) : fromTeam.length ? null : (
              <p className={cn("px-5 py-4 text-body text-muted")}>Записей нет</p>
            )}
            {fromTeam.length ? (
              <div className="border-t border-line bg-surface/60">
                <h3 className="px-5 pt-3 text-small font-semibold text-ink">
                  Из команды <span className="font-normal text-muted">{fromTeam.length}</span>
                </h3>
                <ul className="flex flex-col divide-y divide-line">
                  {fromTeam.map((e) => {
                    const note = e.promoted?.find((x) => x.by === p.slug)?.note;
                    return (
                      <li key={e.id} className="flex flex-col gap-2 px-5 py-4">
                        <EntryItem entry={e} showAuthor />
                        {note ? (
                          <p className="text-body text-ink">
                            <span className="text-muted">От себя: </span>
                            {note}
                          </p>
                        ) : null}
                        <PromoteControl entry={e} promoteFrom={promoteFrom} closed={closed} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function BlocksView({ entries, promoteFrom, closed }: { entries: WeeklyEntry[]; promoteFrom: PersonSlug[]; closed: boolean }) {
  // Риски первыми: с них начинается разбор. Дальше порядок справочника, в конце блоки, которые уже скрыли
  const known = BLOCKS.map((b) => b.code);
  const order: BlockCode[] = [...new Set(["risks", ...known, ...entries.map((e) => e.block)])];
  return (
    <div className="mt-6 flex flex-col gap-6">
      {order.map((code) => {
        const list = entries.filter((e) => e.block === code);
        if (!list.length) return null;
        return (
          <section key={code} aria-labelledby={`blk-${code}`} className="rounded-xl ring-1 ring-line">
            <h2 id={`blk-${code}`} className="border-b border-line px-5 py-3 text-title-sm font-semibold text-ink">
              {blockLabel(code)} <span className="font-normal text-muted">{list.length}</span>
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {list.map((e) => (
                <li key={e.id} className="flex flex-col gap-2 px-5 py-4">
                  <EntryItem entry={e} showAuthor />
                  <PromotedNote entry={e} />
                  <PromoteControl entry={e} promoteFrom={promoteFrom} closed={closed} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}


/** «срок пт, 16:00»: свой срок человека, если команда сдаёт раньше департамента */
export function deadlineText(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "short" }).format(at);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(at);
  return `срок ${day}, ${time}`;
}

/** «пн 17:42»: когда сдан weekly */
export function submittedText(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "short" }).format(at);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(at);
  return `сдан ${day}, ${time}`;
}
