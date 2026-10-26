"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutList, Lock, LockOpen, MonitorPlay, PenLine, SlidersHorizontal, TrendingUp, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { formatLong, plural } from "@/domain/dates";
import { PEOPLE, authorName, personOf } from "@/domain/people";
import { BLOCKS, DIRECTIONS, ENTRY_TYPES, blockLabel, type BlockCode, type DirectionCode, type EntryTypeCode } from "@/domain/dictionaries";
import type { PersonSlug, PersonWeekly, WeekInfo, WeekView, WeeklyEntry } from "@/domain/types";
import { assignEntryAuthorAction, setTeamWeekClosedAction, setWeekClosedAction } from "@/app/(app)/weekly/actions";
import { setTeamAction } from "@/app/actions/team";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Chip, Counter, Segmented, SelectField } from "@/components/ui/primitives";
import { WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Figures } from "@/components/ui/data";
import { EntryItem } from "./entry-item";
import { SubmissionStrip } from "./submission-strip";
import { AbsentBadge, substituteText } from "./absence";
import { useRunWeekly } from "./use-weekly";
import { PromoteControl, PromotedNote } from "./promote";
import { WeekSwitcher } from "./week-switcher";

type View = "people" | "blocks";

/** Чей weekly открыли по ссылке из дерева подчинённых (этап 39) и есть ли он в ленте выбранной команды */
export type AuthorFocus = {
  slug: PersonSlug;
  name: string;
  /** Человек в ленте выбранной команды: отбор по автору включается сразу */
  here: boolean;
  /** Иначе самая узкая видимая команда, в ленте которой он есть, или null */
  team: { id: string; name: string } | null;
  /** Название выбранной команды */
  current: string;
};

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
    <Button variant="secondary" onClick={toggle} disabled={busy} className="col-span-2 px-3 sm:col-span-1 sm:px-5">
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
    <Button variant="secondary" onClick={toggle} disabled={busy} className="col-span-2 px-3 sm:col-span-1 sm:px-5" aria-label={week.closed ? "Открыть неделю команды" : "Закрыть неделю команды"}>
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
  focus = null,
}: {
  view: WeekView;
  myReport: PersonWeekly;
  promoteFrom?: PersonSlug[];
  teamWeek?: TeamWeek;
  /** Мой weekly за эту неделю закрыт: поднимать записи наверх уже нельзя */
  promoteClosed?: boolean;
  /** Weekly человека по ссылке из дерева подчинённых (этап 39) */
  focus?: AuthorFocus | null;
}) {
  const { manage, teamPeople } = usePrototype();
  const week = data.week;
  const [view, setView] = useState<View>("people");
  const [direction, setDirection] = useState<DirectionCode | "">("");
  const [block, setBlock] = useState<BlockCode | "">("");
  const [type, setType] = useState<EntryTypeCode | "">("");
  const [author, setAuthorState] = useState<PersonSlug | "">(focus?.here ? focus.slug : "");
  const [helpOnly, setHelpOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(!!focus?.here);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const filtersId = `weekly-filters-${week.key}`;
  // Человек из ссылки появился в ленте (перешли в его команду кнопкой подсказки или переключателем в шапке): отбор по
  // нему включается сам; ушли в команду, где его нет: отбор снимается и снова видна подсказка. Только переходы того же
  // человека: выбор автора руками и запоздалый ответ обновления отбор не трогают. Состояние меняется во время отрисовки,
  // как советует React, без эффекта и лишнего прохода
  const focusKey = focus ? `${focus.slug}:${focus.here ? "here" : "away"}` : "";
  const [seenFocus, setSeenFocus] = useState(focusKey);
  if (seenFocus !== focusKey) {
    const [prevSlug, prevState] = seenFocus.split(":");
    setSeenFocus(focusKey);
    if (focus && prevSlug === focus.slug) {
      if (focus.here && prevState === "away") {
        setAuthorState(focus.slug);
        setShowFilters(true);
      }
      if (!focus.here && prevState === "here" && author === focus.slug) setAuthorState("");
    }
  }
  // Отбор по автору живёт и в адресе: ссылкой можно поделиться, а смена недели его сохраняет. Состояние истории
  // null: Next перенесёт свои поля и запомнит новый адрес, иначе живое обновление вернёт старый
  const setAuthor = (slug: PersonSlug | "") => {
    setAuthorState(slug);
    try {
      const url = new URL(window.location.href);
      if (slug) url.searchParams.set("author", slug);
      else url.searchParams.delete("author");
      window.history.replaceState(null, "", url);
    } catch {
      // Адрес не обновился: отбор на экране всё равно работает
    }
  };
  // Человека из ссылки или выбранного автора может не быть среди людей выбранной команды (руководитель команды ниже,
  // смена команды в шапке): список «Автор» всё равно показывает, по кому отбор, и «Все» его снимает
  const authorOptions = [...teamPeople.map((p) => ({ value: p.slug, label: p.fullName }))];
  if (focus?.here && !authorOptions.some((o) => o.value === focus.slug)) authorOptions.push({ value: focus.slug, label: focus.name });
  if (author && !authorOptions.some((o) => o.value === author)) authorOptions.push({ value: author, label: focus?.slug === author ? focus.name : personOf(author).fullName });

  const all = data.entries;
  // Weekly руководителя в ленте команды выше: его записи и то, что он поднял из своей команды, как в его карточке
  const ofAuthor = (e: WeeklyEntry) => e.author === author || ((data.authors?.includes(author as PersonSlug) ?? true) && !!e.promoted?.some((p) => p.by === author));
  const entries = all.filter(
    (e) =>
      (!direction || e.direction === direction) &&
      (!block || e.block === block) &&
      (!type || e.type === type) &&
      (!author || ofAuthor(e)) &&
      (!helpOnly || !!e.help),
  );
  // Подсказка про человека из ссылки, пока отбор не перевели на другого
  const showElsewhere = !!focus && !focus.here && (!author || author === focus.slug);
  // Что сохранить при смене недели: отбор или человека из ссылки, которого ещё нет в ленте
  const keepQuery = author ? `&author=${encodeURIComponent(author)}` : showElsewhere ? `&author=${encodeURIComponent(focus!.slug)}` : "";
  const helpEntries = entries.filter((e) => e.help);
  const helpEntriesAll = all.filter((e) => e.help).length;
  const filtersOn = !!(direction || block || type || author || helpOnly);
  // Что включено в раскрывающихся фильтрах: число на кнопке и чипы, когда списки свёрнуты
  const active = [
    direction ? { label: "Направление", value: DIRECTIONS.find((d) => d.code === direction)?.label ?? direction, clear: () => setDirection("") } : null,
    block ? { label: "Блок", value: blockLabel(block), clear: () => setBlock("") } : null,
    type ? { label: "Тип", value: ENTRY_TYPES.find((t) => t.code === type)?.label ?? type, clear: () => setType("") } : null,
    author ? { label: "Автор", value: authorLabel(author, authorOptions), clear: () => setAuthor("") } : null,
  ].filter((f): f is NonNullable<typeof f> => !!f);
  const selected = active.length;
  const myState = myReport.state;

  return (
    <div>
      {/* Этап 37: шапка как у остальных разделов, под ней ключевые цифры недели строкой (этап 43). Этап 68: в шапке только
          записи за неделю и «в отчёт CEO»; помощь, риски и результаты колонками «Что решить» над лидерами */}
      <PageHeader
        title="Weekly"
        description="Итоги недели команды по людям и по блокам"
        figures={
          all.length ? (
            <Figures
              label="Неделя в цифрах"
              inline
              max={3}
              items={[
                { label: `${plural(all.length, "запись", "записи", "записей")} за неделю`, value: all.length, testId: "weekly-fig-entries", keepZero: true },
                // Этап 68: помощь, риски и результаты теперь колонками «Что решить» под шапкой, здесь не повторяются
                { label: "в отчёт CEO", value: all.filter((e) => e.ceo).length, testId: "weekly-fig-ceo" },
              ]}
            />
          ) : null
        }
      >
        {/* В строке действий шапки: на телефоне сетка во всю ширину, длинные подписи на всю строку, дальше кнопки переносятся */}
        <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center [&>*]:min-w-0">
          <div className="col-span-2 sm:col-span-1">
            <WeekSwitcher view={data} query={keepQuery} />
          </div>
          <Link href={`/forecast?week=${week.key}`} className={buttonClass("secondary", "md", "px-3 sm:px-5")}>
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            Прогноз
          </Link>
          <Link href={`/weekly/meeting?week=${data.fallback ? data.reportingKey : week.key}`} className={buttonClass("secondary", "md", "px-3 sm:px-5")}>
            <MonitorPlay className="h-4 w-4" aria-hidden="true" />
            <span className="sm:hidden">Встреча</span>
            <span className="hidden sm:inline">Режим встречи</span>
          </Link>
          <Link href="/weekly/submit" className={buttonClass("primary", "md", "col-span-2 px-3 sm:col-span-1 sm:px-5")}>
            <PenLine className="h-4 w-4" aria-hidden="true" />
            {myState === "submitted" || myState === "late" ? "Мой weekly" : myState === "draft" ? "Продолжить weekly" : "Сдать weekly"}
          </Link>
          {teamWeek && !data.departmentClosed ? <TeamWeekLock week={week} team={teamWeek} /> : null}
          {/* Этап 66: отчёт команды по смысловым блокам и шаблон блоков у руководителя команды */}
          {teamWeek ? (
            <Link href={`/weekly/team-report?team=${encodeURIComponent(teamWeek.id)}&week=${week.key}`} className={buttonClass("secondary", "md", "px-3 sm:px-5")}>
              <LayoutList className="h-4 w-4" aria-hidden="true" />
              <span className="sm:hidden">По блокам</span>
              <span className="hidden sm:inline">Отчёт по блокам</span>
            </Link>
          ) : null}
          {manage ? <WeekLock week={{ ...week, closed: data.departmentClosed ?? week.closed }} /> : null}
        </div>
      </PageHeader>

      {data.fallback ? (
        <p className="mb-4 sv-card sv-card--soft px-5 py-3 text-body text-ink">
          За неделю {data.reportingNumber} записей пока нет. Показана неделя {week.number}, её разбирали на встрече {formatLong(week.meetingDate)}.{" "}
          <Link href={`/weekly?week=${data.reportingKey}${keepQuery}`} className="font-medium text-blue-700 hover:underline">
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

      {showElsewhere ? <FocusElsewhere focus={focus!} /> : null}

      <SubmissionStrip reports={data.reports} />

      {/* Этап 43: вид ленты, «Нужна помощь» и кнопка «Фильтры» в одной строке; четыре списка фильтров раскрываются
          по кнопке и на ноутбуке тоже, включённые фильтры видны чипами, чип снимает фильтр */}
      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented
          label="Вид ленты"
          value={view}
          onChange={setView}
          options={[
            { value: "people", label: "По людям" },
            { value: "blocks", label: "По блокам" },
          ]}
        />
        {/* Ноль на чипе не показывается: правило строки цифр */}
        <Chip active={helpOnly} onClick={() => setHelpOnly((v) => !v)} count={helpEntriesAll || undefined} disabled={!helpEntriesAll && !helpOnly}>
          Нужна помощь
        </Chip>
        <button
          ref={filtersButton}
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls={filtersId}
          aria-label={selected > 0 ? `Фильтры, включено: ${selected}` : "Фильтры"}
          className={cn("inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-body font-medium text-blue-700 hover:bg-field", showFilters && "bg-accent-soft")}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Фильтры
          <Counter value={selected} />
        </button>
        {!showFilters && active.length ? (
          <ul className="flex min-w-0 max-w-full flex-wrap items-center gap-2" aria-label="Включённые фильтры">
            {active.map((f) => (
              <li key={f.label} className="min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={() => {
                    f.clear();
                    // Чип исчезает вместе с фокусом: возвращаем его на кнопку «Фильтры», а не в начало страницы
                    filtersButton.current?.focus();
                  }}
                  className="sv-pill is-active max-w-full"
                  aria-label={`${f.label}: ${f.value}, снять фильтр`}
                >
                  <span className="font-normal">{f.label}:</span> <span className="truncate">{f.value}</span>
                  <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div id={filtersId} className={cn("mt-3 grid-cols-2 gap-3 sm:flex-wrap sm:items-end", showFilters ? "grid sm:flex" : "hidden")}>
        <SelectField label="Направление" id="f-dir" value={direction} onChange={(e) => setDirection(e.target.value as DirectionCode | "")} className="sm:w-44" options={[{ value: "", label: "Все" }, ...DIRECTIONS.map((d) => ({ value: d.code, label: d.label }))]} />
        <SelectField label="Блок" id="f-block" value={block} onChange={(e) => setBlock(e.target.value as BlockCode | "")} className="sm:w-48" options={[{ value: "", label: "Все" }, ...BLOCKS.map((b) => ({ value: b.code, label: b.label }))]} />
        <SelectField label="Тип" id="f-type" value={type} onChange={(e) => setType(e.target.value as EntryTypeCode | "")} className="sm:w-36" options={[{ value: "", label: "Все" }, ...ENTRY_TYPES.map((t) => ({ value: t.code, label: t.label }))]} />
        <SelectField label="Автор" id="f-author" value={author} onChange={(e) => setAuthor(e.target.value as PersonSlug | "")} className="sm:w-44" options={[{ value: "", label: "Все" }, ...authorOptions]} />
      </div>

      {all.length === 0 ? (
        <EmptyState
          title={`За неделю ${week.number} записей нет`}
          className="mt-6"
          action={
            week.reporting ? (
              <Link href="/weekly/submit" className={buttonClass("secondary", "sm")}>
                Написать свой weekly
              </Link>
            ) : undefined
          }
        >
          {week.reporting ? "Записи появятся, как только лидеры начнут писать weekly." : "Архив хранится без ограничения срока: листайте недели назад."}
        </EmptyState>
      ) : entries.length === 0 ? (
        <EmptyState
          title={author && !direction && !block && !type && !helpOnly ? `${authorLabel(author, authorOptions)}: за неделю ${week.number} записей нет` : "Под эти фильтры записей нет"}
          className="mt-6"
          action={
            filtersOn ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setDirection("");
                  setBlock("");
                  setType("");
                  setAuthor("");
                  setHelpOnly(false);
                }}
              >
                Показать все записи
              </Button>
            ) : undefined
          }
        >
          {author && !direction && !block && !type && !helpOnly ? "Листайте недели назад или покажите всю команду." : filtersOn ? "Снимите часть фильтров." : null}
        </EmptyState>
      ) : view === "people" ? (
        <div className="mt-6 flex flex-col gap-6">
          {!helpOnly && !type ? (
            <CeoDigest
              help={helpEntries}
              risks={entries.filter((e) => e.type === "risk")}
              results={entries.filter((e) => e.type === "result")}
              onHelp={() => setHelpOnly(true)}
              onType={(t) => setType(t)}
            />
          ) : null}
          <PeopleView reports={data.reports} entries={entries} reporting={week.reporting} feedAuthors={data.authors} promoteFrom={promoteFrom} closed={promoteClosed} only={author || undefined} filtered={filtersOn} />
        </div>
      ) : (
        <BlocksView entries={entries} promoteFrom={promoteFrom} closed={promoteClosed} />
      )}
    </div>
  );
}

function authorLabel(slug: PersonSlug, options: { value: string; label: string }[]): string {
  return options.find((o) => o.value === slug)?.label ?? personOf(slug).fullName;
}

/** Человека из ссылки нет в ленте выбранной команды: где его weekly и как туда перейти (этап 39) */
function FocusElsewhere({ focus }: { focus: AuthorFocus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (!focus.team || busy) return;
    setBusy(true);
    setError(null);
    const res = await setTeamAction(focus.team.id).catch(() => ({ ok: false as const, error: "Не получилось переключить команду: проверьте связь" }));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    // Как у переключателя в шапке: после смены команды страница перечитывается, отбор включится сам
    router.refresh();
  };
  return (
    <div className="mb-4 sv-card sv-card--soft flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="weekly-focus-elsewhere">
      <p className="text-body text-ink">
        {focus.team
          ? `${focus.name}: weekly в ленте команды «${focus.team.name}», а выбрана команда «${focus.current}».`
          : `${focus.name}: человека нет ни в одной из видимых вам команд, weekly показывать негде.`}
        {error ? <span className="mt-1 block text-small text-danger-ink" role="alert">{error}</span> : null}
      </p>
      {focus.team ? (
        <Button size="sm" variant="secondary" onClick={open} disabled={busy} className="shrink-0">
          Перейти в эту команду
        </Button>
      ) : null}
    </div>
  );
}

/** Сколько записей в колонке «Что решить» видно сразу: остальное кнопкой «Ещё», она включает фильтр ленты */
const DIGEST_LIMIT = 3;

/**
 * «Что решить» (этап 68): помощь, риски и результаты тремя колонками над лидерами. С них начинается встреча и
 * чтение CEO. В строке автор, что произошло и одна вторая строка: просьба о помощи, цифра или «дальше».
 * Пустая колонка не показывается, без всех трёх блока нет
 */
function CeoDigest({
  help,
  risks,
  results,
  onHelp,
  onType,
}: {
  help: WeeklyEntry[];
  risks: WeeklyEntry[];
  results: WeeklyEntry[];
  onHelp: () => void;
  onType: (type: EntryTypeCode) => void;
}) {
  const cols = [
    { id: "help", title: "Нужна помощь", dot: "bg-warning", list: help, second: (e: WeeklyEntry) => e.help, secondTone: "text-warning-ink", more: onHelp },
    { id: "risk", title: "Риски", dot: "bg-danger", list: risks, second: (e: WeeklyEntry) => e.fact || e.next, secondTone: "text-text-secondary", more: () => onType("risk") },
    { id: "result", title: "Результаты", dot: "bg-green", list: results, second: (e: WeeklyEntry) => e.fact || e.impact, secondTone: "text-green-ink", more: () => onType("result") },
  ].filter((c) => c.list.length);
  if (!cols.length) return null;
  return (
    <div className={cn("grid gap-4", cols.length === 3 ? "lg:grid-cols-3" : cols.length === 2 ? "lg:grid-cols-2" : "")} data-testid="weekly-digest">
      {cols.map((c) => (
        <section key={c.id} aria-labelledby={`dg-${c.id}`} className="sv-card flex flex-col overflow-hidden">
          <h2 id={`dg-${c.id}`} className="m-0 flex items-center gap-2 border-b border-line px-4 py-3 text-body font-semibold text-ink">
            <span className={cn("h-2.5 w-2.5 rounded-full", c.dot)} aria-hidden="true" />
            {c.title}
            <span className="font-normal text-muted">{c.list.length}</span>
          </h2>
          <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
            {c.list.slice(0, DIGEST_LIMIT).map((e) => {
              const second = c.second(e);
              return (
                <li key={e.id} className="px-4 py-3">
                  <p className="m-0 text-caption font-semibold text-text-secondary">{authorName(e.author, "short", "Общее")}</p>
                  <p className="m-0 line-clamp-2 text-body font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{e.what}</p>
                  {second ? <p className={cn("m-0 mt-0.5 line-clamp-2 text-small", c.secondTone)}>{second}</p> : null}
                </li>
              );
            })}
          </ul>
          {c.list.length > DIGEST_LIMIT ? (
            // Рамка фокуса внутрь кнопки: у карточки overflow hidden, наружная рамка обрезалась бы
            <button type="button" onClick={c.more} className="mt-auto min-h-11 border-t border-line px-4 py-2.5 text-left text-small font-semibold text-link hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
              Ещё {c.list.length - DIGEST_LIMIT}: показать в ленте
            </button>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function PeopleView({
  reports,
  entries,
  reporting,
  feedAuthors,
  promoteFrom,
  closed,
  only,
  filtered = false,
}: {
  reports: PersonWeekly[];
  entries: WeeklyEntry[];
  reporting: boolean;
  feedAuthors?: PersonSlug[];
  promoteFrom: PersonSlug[];
  closed: boolean;
  /** Отбор по автору: в ленте только его карточка, без пустых карточек остальных */
  only?: PersonSlug;
  /** Включён любой отбор (тип, «Нужна помощь», направление, блок, автор): карточки не сворачиваются, иначе отобранное спрятано */
  filtered?: boolean;
}) {
  const { manage, teamPeople, me } = usePrototype();
  const run = useRunWeekly();
  const rank = { submitted: 0, late: 0, draft: 1, "not-started": 2 } as const;
  const reportOf = (slug: PersonSlug) => reports.find((w) => w.author === slug);
  const stateOf = (slug: PersonSlug) => reportOf(slug)?.state ?? "not-started";
  // Сначала сдавшие, потом черновики, в конце те, у кого weekly не начат
  // Записи тех, кого уже выключили, остаются в ленте прошлых недель
  // Свои записи ленты: авторы из команды. Записи, которые пришли наверх, видны у того, кто их поднял (этап 15)
  const ownFeed = (e: WeeklyEntry) => !feedAuthors || (!!e.author && feedAuthors.includes(e.author));
  const promotedBy = (slug: PersonSlug) => entries.filter((e) => e.author !== slug && e.promoted?.some((p) => p.by === slug));
  // Кто сдаёт по желанию (этап 15), появляется в ленте, только если что-то написал или сдал
  const listed = (w: PersonWeekly) => !w.optional || w.state !== "not-started";
  const inFeed = (slug: PersonSlug) =>
    entries.some((e) => e.author === slug && ownFeed(e)) || reports.some((w) => w.author === slug && listed(w)) || (!!feedAuthors?.includes(slug) && promotedBy(slug).length > 0);
  const gone = [...new Set(entries.map((e) => e.author).filter((s): s is PersonSlug => !!s && !PEOPLE.some((p) => p.slug === s)))].map(personOf);
  const authors = [...PEOPLE, ...gone].filter((p) => (!only || p.slug === only) && inFeed(p.slug)).sort((a, b) => rank[stateOf(a.slug)] - rank[stateOf(b.slug)]);
  const assignAuthor = (id: string, slug: PersonSlug) =>
    void run(() => assignEntryAuthorAction(id, slug), `Запись передана: ${personOf(slug).fullName}`);
  const common = entries.filter((e) => !e.author);
  // Этап 68: лидеры строками, записи под раскрытием. Свёрнуто, когда лидеров больше двух и никакой отбор не включён.
  // Своя карточка раскрыта сразу: свои записи человек ищет первыми. «Развернуть всех» раскрывает каждую карточку, а не
  // включает общий режим: так любую карточку потом можно свернуть отдельно
  const [opened, setOpened] = useState<Set<PersonSlug>>(() => new Set([me.slug]));
  const collapsible = !only && !filtered && authors.length > 2;
  const isOpen = (slug: PersonSlug) => !collapsible || opened.has(slug);
  const allOpen = authors.every((p) => opened.has(p.slug));
  const toggle = (slug: PersonSlug) =>
    setOpened((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  return (
    <div className="flex flex-col gap-4">
      {collapsible ? (
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-title-sm font-semibold text-ink">
            Лидеры <span className="font-normal text-muted">{authors.length}</span>
          </h2>
          <button type="button" onClick={() => setOpened(allOpen ? new Set() : new Set(authors.map((p) => p.slug)))} className="inline-flex min-h-8 items-center text-small font-semibold text-link hover:underline">
            {allOpen ? "Свернуть всех" : "Развернуть всех"}
          </button>
        </div>
      ) : null}
      {common.length ? (
        <section aria-labelledby="wk-common" className="flex flex-col sv-card sv-card--soft">
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
                <EntryItem entry={e} compact />
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
        const open = isOpen(p.slug);
        const counts = [
          { n: own.filter((e) => e.type === "result").length, label: (n: number) => `${n} ${plural(n, "результат", "результата", "результатов")}`, cls: "bg-green-soft text-green-ink" },
          { n: own.filter((e) => e.type === "risk").length, label: (n: number) => `${n} ${plural(n, "риск", "риска", "рисков")}`, cls: "bg-danger-soft text-danger-ink" },
          { n: own.filter((e) => !!e.help).length, label: () => "нужна помощь", cls: "bg-warning-soft text-warning-ink" },
        ].filter((c) => c.n > 0);
        return (
          <section key={p.slug} aria-labelledby={`wk-${p.slug}`} className="flex flex-col sv-card sv-card--soft" data-testid={`weekly-leader-${p.slug}`}>
            <header className={cn("px-5 py-4", open && "border-b border-line")}>
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
                <p className="mt-2 text-body text-muted">{state === "not-started" ? "Weekly ещё не начат" : "Главная фраза пока не написана"}</p>
              ) : null}
              {/* Благодарность видна и у свёрнутой карточки: короткая строка, как главная фраза */}
              {weekly?.thanks ? (
                <p className="mt-1.5 text-body text-ink">{weekly.thanks}</p>
              ) : null}
              {collapsible ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {counts.map((c) => (
                    <span key={c.cls} className={cn("inline-flex h-6 items-center rounded-full px-2 text-caption font-semibold", c.cls)}>
                      {c.label(c.n)}
                    </span>
                  ))}
                  {own.length || fromTeam.length ? (
                    <button
                      type="button"
                      onClick={() => toggle(p.slug)}
                      aria-expanded={open}
                      aria-label={open ? `Свернуть записи: ${p.fullName}` : `Записи: ${own.length + fromTeam.length}, ${p.fullName}`}
                      className="ml-auto inline-flex min-h-8 items-center text-small font-semibold text-link hover:underline"
                    >
                      {open ? "Свернуть" : `Записи: ${own.length + fromTeam.length}`}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </header>
            {!open ? null : own.length ? (
              <ul className="flex flex-col divide-y divide-line">
                {own.map((e) => (
                  <li key={e.id} className="flex flex-col gap-2 px-5 py-4">
                    <EntryItem entry={e} compact />
                    <PromotedNote entry={e} />
                    <PromoteControl entry={e} promoteFrom={promoteFrom} closed={closed} />
                  </li>
                ))}
              </ul>
            ) : fromTeam.length ? null : (
              <p className={cn("px-5 py-4 text-body text-muted")}>Записей нет</p>
            )}
            {open && fromTeam.length ? (
              <div className="border-t border-line bg-field/60">
                <h3 className="px-5 pt-3 text-small font-semibold text-ink">
                  Из команды <span className="font-normal text-muted">{fromTeam.length}</span>
                </h3>
                <ul className="flex flex-col divide-y divide-line">
                  {fromTeam.map((e) => {
                    const note = e.promoted?.find((x) => x.by === p.slug)?.note;
                    return (
                      <li key={e.id} className="flex flex-col gap-2 px-5 py-4">
                        <EntryItem entry={e} showAuthor compact />
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
          <section key={code} aria-labelledby={`blk-${code}`} className="sv-card sv-card--soft">
            <h2 id={`blk-${code}`} className="border-b border-line px-5 py-3 text-title-sm font-semibold text-ink">
              {blockLabel(code)} <span className="font-normal text-muted">{list.length}</span>
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {list.map((e) => (
                <li key={e.id} className="flex flex-col gap-2 px-5 py-4">
                  <EntryItem entry={e} showAuthor compact />
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
