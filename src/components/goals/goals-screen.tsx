"use client";

// Страница «Цели» (этап 17, таблица с фактом с этапа 33). Сверху ключевые цифры квартала: целей, в риске, достигнуто,
// без задач, без свежего факта. Ниже цели таблицей (группы по командам или людям, факт и целевое значение в строке)
// или деревом от целей департамента до команд и людей. Внизу задачи без цели по командам

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Upload } from "lucide-react";
import type { GoalNode, GoalsPlan, GoalsView } from "@/lib/goals/service";
import { goalBucket, type GoalBucket } from "@/lib/goals/quarter";
import { goalPeople, goalsHref, hasOwnGoals, hasUnowned, pruneSelection, selectGoals, type GoalGroupBy } from "@/lib/goals/by-person";
import type { LeaderPlan } from "@/lib/goals/leader-board-service";
import type { GoalResult } from "@/generated/prisma/enums";
import { quarterLabel } from "@/lib/goals/parse";
import { plural } from "@/domain/dates";
import Link from "next/link";
import { FACT_STALE_DAYS } from "@/lib/goals/progress";
import { usePrototype } from "@/domain/store";
import { allPeople } from "@/domain/people";
import { teamOf, teamPeople } from "@/domain/teams";
import { Button } from "@/components/ui/button";
import { Drawer, Modal } from "@/components/ui/overlays";
import { Segmented, SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { FileField } from "@/components/ui/file-field";
import { Module } from "@/components/ui/data";
import { EmptyState } from "@/components/empty-state";
import {
  applyBordGoalsAction,
  applyGoalsAction,
  createGoalAction,
  deleteGoalAction,
  previewBordGoalsAction,
  previewGoalsAction,
  updateGoalAction,
} from "@/app/(app)/goals/actions";
import { GoalsTable } from "./goals-table";
import { GoalsTree } from "./goals-tree";
import { GoalsCards, QuarterBar } from "./goals-cards";
import { GoalsPeopleFilter } from "./goals-people-filter";

const RESULTS: { value: GoalResult; label: string }[] = [
  { value: "IN_PROGRESS", label: "Идёт" },
  { value: "ACHIEVED", label: "Достигнута" },
  { value: "PARTIAL", label: "Частично" },
  { value: "MISSED", label: "Не достигнута" },
  { value: "DROPPED", label: "Снята" },
];

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void;
// Этап 68: карточки видом по умолчанию, таблица и дерево рядом
type ViewMode = "cards" | "table" | "tree";
type Filter = "all" | GoalBucket;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "done", label: "Достигнуты" },
  { value: "risk", label: "В риске" },
  { value: "notasks", label: "Без задач" },
  { value: "stale", label: "Без свежего факта" },
  { value: "closed", label: "Закрыты не полностью" },
  { value: "work", label: "В работе" },
];

const inFilter = (g: GoalNode, f: Filter) => f === "all" || goalBucket(g) === f;

/** Цвет отрезка шкалы: токены, серый «в работе» держит 3:1 к дорожке шкалы в обеих темах */
const SLICE_COLOR: Record<GoalBucket, string> = {
  done: "bg-green",
  risk: "bg-danger",
  notasks: "bg-info",
  stale: "bg-warning",
  closed: "bg-link",
  work: "bg-steel",
};

export function GoalsScreen({
  view,
  defaultTeam,
  bordTabs,
  leaderBoard = false,
  initialQuery = "",
  initialPeople = [],
  initialGroup = "person",
}: {
  view: GoalsView;
  defaultTeam: string | null;
  bordTabs: string[] | null;
  leaderBoard?: boolean;
  /** Поиск с первого открытия: ссылка «Цели» из дерева подчинённых */
  initialQuery?: string;
  /** Чьи цели показаны и как сгруппированы: из адреса (?people=slug,slug&group=team), см. goalsHref */
  initialPeople?: string[];
  initialGroup?: GoalGroupBy;
}) {
  const router = useRouter();
  const { notify, me } = usePrototype();
  const [, start] = useTransition();
  const [, startNav] = useTransition();
  const [creating, setCreating] = useState<{ parent?: GoalNode } | null>(null);
  const [editing, setEditing] = useState<GoalNode | null>(null);
  const [marking, setMarking] = useState<GoalNode | null>(null);
  const [importing, setImporting] = useState(false);
  const [mode, setMode] = useState<ViewMode>("cards");
  // Отбор людей и группировка живут в адресе. Экран меняется сразу, адрес догоняет: пока router.replace в пути,
  // действует местная копия. Адрес изменился (ссылка, «Назад», обновление страницы): местная копия сбрасывается
  const urlKey = `${initialPeople.join(",")}|${initialGroup}`;
  const [local, setLocal] = useState<{ people: string[]; group: GoalGroupBy } | null>(null);
  const [seenKey, setSeenKey] = useState(urlKey);
  if (seenKey !== urlKey) {
    setSeenKey(urlKey);
    setLocal(null);
  }
  const groupBy = local?.group ?? initialGroup;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState(initialQuery);
  const byId = useMemo(() => new Map(view.goals.map((g) => [g.id, g])), [view.goals]);
  // Ссылка на цель обрабатывается один раз за открытие страницы
  const hashHandled = useRef(false);
  // Цель из карточки («Факт»): таблица раскроет её при появлении
  const focusGoal = useRef<string | null>(null);
  // Ссылка на цель (#goal-..., метка цели у задачи) открывает таблицу: строка там раскрывается с фактом и историей.
  // На сервере адреса с решёткой не видно, поэтому вид меняется после открытия страницы
  useEffect(() => {
    const toTable = () => {
      if (window.location.hash.startsWith("#goal-")) setMode((m) => (m === "cards" ? "table" : m));
    };
    toTable();
    window.addEventListener("hashchange", toTable);
    return () => window.removeEventListener("hashchange", toTable);
  }, []);
  const run: Run = (fn, ok) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) notify(r.error ?? "Не получилось", "error");
      else {
        notify(ok);
        router.refresh();
      }
    });

  // Выбранные люди только из владельцев целей этого квартала и этой области: после смены квартала или команды
  // тех, кого в новых целях нет, отбрасываем (иначе их нельзя ни увидеть, ни снять)
  const people = useMemo(() => goalPeople(view.goals), [view.goals]);
  const unowned = useMemo(() => hasUnowned(view.goals), [view.goals]);
  const rawPeople = local?.people ?? initialPeople;
  const selected = useMemo(() => pruneSelection(rawPeople, people, unowned), [rawPeople, people, unowned]);
  // В дереве отбор не действует: оно показывает все цели с родителями и детьми
  const scoped = useMemo(() => (mode === "tree" ? view.goals : selectGoals(view.goals, selected)), [mode, view.goals, selected]);
  const count = (f: Filter) => scoped.filter((g) => inFilter(g, f)).length;
  // Адрес догоняет экран: replace без новой записи в истории и без прокрутки, как в списке задач
  const navigate = (next: { people: string[]; group: GoalGroupBy }) => {
    setLocal(next);
    startNav(() => router.replace(goalsHref({ quarter: view.quarter, ...next }), { scroll: false }));
  };
  // Тот же выбор или та же группировка адрес не меняют: каждая смена адреса запрашивает страницу заново
  const setPeople = (next: string[]) => {
    if (next.join(",") !== rawPeople.join(",")) navigate({ people: next, group: groupBy });
  };
  const setGroupBy = (next: GoalGroupBy) => {
    if (next !== groupBy) navigate({ people: selected, group: next });
  };
  // В дереве фильтров нет: уходя в него, отбор сбрасываем, иначе он остался бы невидимым и кнопка шкалы вела бы в урезанные карточки
  const changeMode = (next: ViewMode) => {
    if (next === "tree" && selected.length) setPeople([]);
    setMode(next);
  };
  // Подпись на шкале квартала включает отбор в карточках или в таблице и ведёт к списку целей
  const show = (f: Filter) => {
    setFilter(f);
    // Отбор работает в карточках и в таблице; из дерева переходим в карточки без отбора людей
    if (mode === "tree" && selected.length) setPeople([]);
    setMode((m) => (m === "tree" ? "cards" : m));
    requestAnimationFrame(() => document.getElementById("goals-list")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const q = query.trim().toLowerCase();
  const shown = scoped.filter(
    (g) => inFilter(g, filter) && (!q || [g.code, g.title, g.owner?.fullName, g.team.name, g.metric].some((v) => v && v.toLowerCase().includes(q))),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SelectField
          label="Квартал"
          id="goals-quarter"
          value={view.quarter}
          onChange={(e) => router.push(goalsHref({ quarter: e.target.value, people: selected, group: groupBy }))}
          options={view.quarters.map((x) => ({ value: x, label: quarterLabel(x) }))}
          className="sm:w-44"
        />
        {view.creatable.length ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Загрузить цели
            </Button>
            {/* На пустой странице первую цель заводят из пустого состояния: одно действие на экран (этап 49) */}
            {view.goals.length ? (
              <Button size="sm" onClick={() => setCreating({})}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Новая цель
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {view.goals.length ? (
        <>
          {/* Этап 68: шкала квартала вместо строки цифр. Отрезки и подписи-кнопки по взаимоисключающим отборам (goalBucket),
              ширина отрезка по доле целей, сумма по кнопкам равна числу целей */}
          <QuarterBar
            total={scoped.length}
            allActive={filter === "all"}
            onAll={() => show("all")}
            slices={FILTERS.filter((f) => f.value !== "all").map((f) => {
              const key = f.value as GoalBucket;
              return { key, label: f.label, count: count(key), color: SLICE_COLOR[key], active: filter === key, onClick: () => show(key) };
            })}
          />

          <Module
            id="goals-list"
            title={`Цели на ${quarterLabel(view.quarter)}`}
            description={`Факт вписывают владелец и руководитель команды. Свежий факт: не старше ${FACT_STALE_DAYS} дней`}
            actions={<Segmented label="Вид" value={mode} onChange={changeMode} options={[{ value: "cards", label: "Карточки" }, { value: "table", label: "Таблица" }, { value: "tree", label: "Дерево" }]} />}
            flush
          >
            {mode !== "tree" ? (
            <div className="flex flex-col gap-3 border-t border-border px-5 py-3 max-sm:px-4">
              <GoalsPeopleFilter people={people} unowned={unowned} selected={selected} me={me.slug} mineAvailable={hasOwnGoals(view.goals, me.slug)} onChange={setPeople} />
              <div className="flex flex-wrap items-end gap-3">
                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <TextInput id="goals-search" label="Поиск цели" hideLabel placeholder="Поиск: код, цель, владелец" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
                </div>
                <Segmented label="Группы" value={groupBy} onChange={setGroupBy} options={[{ value: "person", label: "По людям" }, { value: "team", label: "По командам" }]} />
              </div>
              {/* Живая область: число целей после отбора, поиска и шкалы озвучивается при каждом изменении */}
              <p className="m-0 text-small text-muted" aria-live="polite" data-testid="goals-shown">
                Показано целей: {shown.length} из {view.goals.length}
              </p>
              {/* В карточках отбор включает шкала квартала сверху, второй ряд тех же кнопок не нужен */}
              {mode === "table" ? <Segmented label="Показать" value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: f.value === "all" ? undefined : count(f.value) }))} /> : null}
            </div>
            ) : null}
            {mode === "cards" ? (
              shown.length ? (
                <GoalsCards
                  goals={shown}
                  groupBy={groupBy}
                  onEdit={setEditing}
                  onMark={setMarking}
                  onAdd={(parent) => setCreating({ parent })}
                  creatable={view.creatable.length > 0}
                  onFact={(g) => {
                    // Таблица на этой цели: строка раскрывается при появлении, поиск не трогаем. Адрес получает якорь #goal-id,
                    // как у ссылки с метки цели у задачи, но через роутер: нативный history.replaceState перезагружает страницу.
                    // Роутер меняет адрес позже, чем появляется таблица, поэтому цель ей передаётся отдельно
                    focusGoal.current = g.id;
                    setFilter("all");
                    setMode("table");
                    router.replace(`${window.location.pathname}${window.location.search}#goal-${g.id}`, { scroll: false });
                  }}
                />
              ) : (
                <p className="px-5 py-6 text-body text-muted">Под этот отбор целей нет</p>
              )
            ) : mode === "table" ? (
              shown.length ? (
                <GoalsTable
                  goals={shown}
                  all={byId}
                  onReveal={() => {
                    setFilter("all");
                    setQuery("");
                    setPeople([]);
                  }}
                  hashHandled={hashHandled}
                  focusGoal={focusGoal}
                  groupBy={groupBy} onEdit={setEditing} onMark={setMarking} onAdd={(parent) => setCreating({ parent })} creatable={view.creatable.length > 0} onChanged={() => router.refresh()} />
              ) : (
                <p className="px-5 py-6 text-body text-text-secondary">Под условия ничего не подходит: смените фильтр или поиск.</p>
              )
            ) : (
              <GoalsTree roots={view.roots} byId={byId} onEdit={setEditing} onMark={setMarking} onAdd={(parent) => setCreating({ parent })} creatable={view.creatable.length > 0} />
            )}
          </Module>
        </>
      ) : (
        <EmptyState
          title={`Целей на ${quarterLabel(view.quarter)} пока нет`}
          action={
            view.creatable.length ? (
              <Button size="sm" onClick={() => setCreating({})}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Новая цель
              </Button>
            ) : undefined
          }
        >
          {view.creatable.length ? "Заведите первую цель здесь или загрузите вкладку целей из борда кнопкой «Загрузить цели»." : "Цели заводят руководители команд и владелец: они появятся здесь, как только их запишут."}
        </EmptyState>
      )}

      {view.unlinked.length ? (
        // Этап 46: одной фразой со ссылкой вместо таблицы из одной-двух строк
        <p className="sv-card sv-card--soft px-5 py-4 text-body text-ink" id="unlinked" data-testid="goals-unlinked">
          <span className="font-semibold">Задачи без цели:</span>{" "}
          {view.unlinked
            .map((u) => `${u.name}: ${u.withoutGoal} из ${u.open} ${plural(u.open, "открытой", "открытых", "открытых")}${u.highWithoutGoal ? ` (высокий приоритет у ${u.highWithoutGoal})` : ""}`)
            .join("; ")}
          . Задачи с высоким приоритетом должны работать на цель квартала: перетащите их к целям на вкладке{" "}
          <Link href={`/goals?mode=link&q=${view.quarter}`} className="font-semibold text-link hover:underline" data-testid="goals-unlinked-link">
            «Связать задачи с целями»
          </Link>{" "}
          или выберите цель в карточке задачи, список{" "}
          <Link href="/tasks?group=goal" className="font-semibold text-link hover:underline">
            задачи по целям
          </Link>
          .
        </p>
      ) : null}

      {creating ? (
        <GoalModal
          mode="create"
          parent={creating.parent}
          quarter={view.quarter}
          teams={view.creatable}
          // Цель ниже по умолчанию в команде цели выше, если человек её ведёт, иначе в своей команде
          defaultTeam={creating.parent && view.creatable.some((t) => t.id === creating.parent!.team.id) ? creating.parent.team.id : defaultTeam}
          goals={view.goals}
          onClose={() => setCreating(null)}
          run={run}
        />
      ) : null}
      {editing ? <GoalModal mode="edit" goal={editing} quarter={view.quarter} teams={view.creatable} defaultTeam={editing.team.id} goals={view.goals} onClose={() => setEditing(null)} run={run} /> : null}
      {marking ? <MarkModal goal={marking} onClose={() => setMarking(null)} run={run} /> : null}
      {importing ? <ImportDrawer teams={view.creatable} defaultTeam={defaultTeam} quarter={view.quarter} bordTabs={bordTabs} leaderBoard={leaderBoard} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}

function GoalModal({
  mode,
  goal,
  parent,
  quarter,
  teams,
  defaultTeam,
  goals,
  onClose,
  run,
}: {
  mode: "create" | "edit";
  goal?: GoalNode;
  parent?: GoalNode;
  quarter: string;
  teams: { id: string; name: string }[];
  defaultTeam: string | null;
  goals: GoalNode[];
  onClose: () => void;
  run: Run;
}) {
  const [team, setTeam] = useState(goal?.team.id ?? (defaultTeam && teams.some((x) => x.id === defaultTeam) ? defaultTeam : (teams[0]?.id ?? "")));
  const [title, setTitle] = useState(goal?.title ?? "");
  const [code, setCode] = useState(goal?.code ?? "");
  const [metric, setMetric] = useState(goal?.metric ?? "");
  const [base, setBase] = useState(goal?.base ?? "");
  const [target, setTarget] = useState(goal?.target ?? "");
  const [link, setLink] = useState(goal?.link ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [parentId, setParentId] = useState(goal?.parentId ?? parent?.id ?? "");
  const t = teamOf(team);
  const people = t ? allPeople().filter((p) => p.active && teamPeople(t).includes(p.slug)) : allPeople().filter((p) => p.active);
  const [owner, setOwner] = useState(goal?.owner?.slug ?? t?.leader ?? "");
  const parents = goals.filter((g) => g.id !== goal?.id);
  // Цель с задачами, целями ниже или фактом не удаляется: её снимают итогом «Снята»
  const deletable = mode === "edit" && goal && !goal.tasks.length && !goal.childIds.length && !goal.facts.length;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={mode === "create" ? `Новая цель на ${quarterLabel(quarter)}` : "Изменить цель"} description="Цель одной мыслью, метрика, база и целевое значение. Факт вписывается в таблице целей кнопкой «Факт»">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const input = { title, code: code || null, metric: metric || null, base: base || null, target: target || null, link: link || null, description: description || null, owner: owner || null, parent: parentId || null };
          if (mode === "create") run(() => createGoalAction({ ...input, quarter, team }), "Цель заведена");
          else run(() => updateGoalAction(goal!.id, input), "Цель сохранена");
          onClose();
        }}
      >
        {mode === "create" ? <SelectField label="Команда" id="g-team" value={team} onChange={(e) => setTeam(e.target.value)} options={teams.map((x) => ({ value: x.id, label: x.name }))} /> : null}
        <TextInput label="Цель" id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput label="Номер" id="g-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} hint="Как в борде, если есть" />
          <TextInput label="База" id="g-base" value={base} onChange={(e) => setBase(e.target.value)} maxLength={120} />
          <TextInput label="Целевое значение" id="g-target" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} />
        </div>
        <TextInput label="Метрика" id="g-metric" value={metric} onChange={(e) => setMetric(e.target.value)} maxLength={500} hint="Как проверяем" />
        <SelectField label="Владелец" id="g-owner" value={owner} onChange={(e) => setOwner(e.target.value)} options={[{ value: "", label: "Руководитель команды" }, ...people.map((p) => ({ value: p.slug, label: p.fullName }))]} />
        <SelectField
          label="Цель выше"
          id="g-parent"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          options={[{ value: "", label: "Нет: цель верхнего уровня" }, ...parents.map((g) => ({ value: g.id, label: `${g.team.name}: ${g.code ? `${g.code}. ` : ""}${g.title}` }))]}
        />
        <TextInput label="Ссылка на строку в борде" id="g-link" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://docs.google.com/spreadsheets/..." />
        <TextArea label="Описание" id="g-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <div className="flex flex-wrap justify-between gap-2">
          {deletable ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                run(() => deleteGoalAction(goal!.id), "Цель удалена");
                onClose();
              }}
            >
              Удалить цель
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={!title.trim() || !team}>
              {mode === "create" ? "Завести цель" : "Сохранить"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function MarkModal({ goal, onClose, run }: { goal: GoalNode; onClose: () => void; run: Run }) {
  const [atRisk, setAtRisk] = useState(goal.atRisk);
  const [note, setNote] = useState(goal.riskNote ?? "");
  const [result, setResult] = useState<GoalResult>(goal.result);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Риск и итог квартала" description={goal.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateGoalAction(goal.id, { atRisk, riskNote: atRisk ? note : null, result }), "Цель отмечена");
          onClose();
        }}
      >
        <label className="flex items-start gap-3 text-body text-ink">
          <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} className="mt-1 h-4 w-4 accent-blue-700" />
          <span>
            Цель в риске
            <span className="block text-small text-muted">Красный статус безопасен: на риск отвечаем помощью</span>
          </span>
        </label>
        {atRisk ? <TextInput label="Почему в риске и какая помощь нужна" id="g-risk" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required /> : null}
        <SelectField label="Итог квартала" id="g-result" value={result} onChange={(e) => setResult(e.target.value as GoalResult)} options={RESULTS} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}

type ImportSource = "paste" | "bord" | "file";
type AnyPlan = Omit<GoalsPlan, "rows"> & Partial<Pick<LeaderPlan, "people" | "skipped">>;

/** Файл борда лидера уходит на сервер формой: в серверное действие файл больше 1 МБ не пролезает */
async function postLeaderBoard(file: File, team: string, quarter: string, mode: "preview" | "apply"): Promise<{ ok: true; value: never } | { ok: false; error: string }> {
  const form = new FormData();
  form.set("file", file);
  form.set("team", team);
  form.set("quarter", quarter);
  form.set("mode", mode);
  let res: Response;
  try {
    res = await fetch("/api/goals/leader-board", { method: "POST", body: form });
  } catch {
    return { ok: false, error: "Нет связи с сервером: файл не отправился" };
  }
  // Вход закончился: сервер отправил на страницу входа, а не ответ
  if (res.redirected || !(res.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, error: "Вход закончился: обновите страницу, войдите и загрузите файл снова" };
  }
  try {
    return await res.json();
  } catch {
    return { ok: false, error: "Не получилось прочитать ответ сервера. Обновите страницу и попробуйте ещё раз" };
  }
}

function ImportDrawer({
  teams,
  defaultTeam,
  quarter,
  bordTabs,
  leaderBoard,
  onClose,
}: {
  teams: { id: string; name: string }[];
  defaultTeam: string | null;
  quarter: string;
  bordTabs: string[] | null;
  leaderBoard: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [source, setSource] = useState<ImportSource>("paste");
  const [team, setTeam] = useState(defaultTeam && teams.some((t) => t.id === defaultTeam) ? defaultTeam : (teams[0]?.id ?? ""));
  const [text, setText] = useState("");
  const [tab, setTab] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<AnyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sources: { value: ImportSource; label: string }[] = [
    { value: "paste", label: "Вставить ячейки" },
    ...(bordTabs ? [{ value: "bord" as const, label: "Вкладка Bord" }] : []),
    ...(leaderBoard ? [{ value: "file" as const, label: "Файл борда лидера" }] : []),
  ];
  const ready = source === "paste" ? !!text.trim() : source === "bord" ? !!tab.trim() : !!file;
  const check = () =>
    start(async () => {
      setError(null);
      const r =
        source === "paste"
          ? await previewGoalsAction(text, team, quarter)
          : source === "bord"
            ? await previewBordGoalsAction(tab, team, quarter)
            : ((await postLeaderBoard(file!, team, quarter, "preview")) as { ok: true; value: LeaderPlan } | { ok: false; error: string });
      if (r.ok) setPlan(r.value);
      else {
        setPlan(null);
        setError(r.error);
      }
    });
  const apply = () =>
    start(async () => {
      const r =
        source === "paste"
          ? await applyGoalsAction(text, team, quarter)
          : source === "bord"
            ? await applyBordGoalsAction(tab, team, quarter)
            : ((await postLeaderBoard(file!, team, quarter, "apply")) as { ok: true; value: { added: number; changed: number } } | { ok: false; error: string });
      if (!r.ok) return setError(r.error);
      notify(`Цели загружены: новых ${r.value.added}, изменено ${r.value.changed}`);
      onClose();
      router.refresh();
    });
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title="Загрузить цели"
      description="Вкладка целей из борда лидера, файл борда или своя таблица. Сначала проверка: база меняется только по кнопке «Загрузить»"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="secondary" disabled={pending || !ready} onClick={check}>
            Проверить
          </Button>
          <Button disabled={!plan || plan.problems.length > 0 || pending} onClick={apply}>
            {pending ? "Подождите" : "Загрузить"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {sources.length > 1 ? (
          <Segmented
            label="Откуда"
            value={source}
            onChange={(v) => {
              setSource(v);
              setPlan(null);
              setError(null);
            }}
            options={sources}
          />
        ) : null}
        <SelectField
          label={source === "file" ? "Команда для людей, которые не состоят ни в одной команде" : "Команда для целей без колонки «Команда»"}
          id="gi-team"
          value={team}
          onChange={(e) => {
            // Проверка была для другой команды: загрузка только после новой проверки
            setTeam(e.target.value);
            setPlan(null);
          }}
          options={teams.map((t) => ({ value: t.id, label: t.name }))}
        />
        {source === "file" ? (
          <p className="text-small text-muted">
            Борд лидера в Google Таблицах: «Файл», «Скачать», «Microsoft Excel (.xlsx)». Ресурс читает только вкладки, имя которых начинается с «Цели», и в них
            только раздел «Запланировано на {quarter.slice(-1)}Q»: цель, направление, описание, Start и «Целевые». Вкладки с зарплатами, мотивацией, оценками и
            премиями не читаются, колонки оценки результата тоже, файл нигде не сохраняется. Цель становится личной целью владельца вкладки в команде, которой он
            руководит, иначе в его команде, с кодом из инициалов: «РТ-1». Повторная загрузка обновляет цели, а не дублирует.
          </p>
        ) : (
        <p className="text-small text-muted">
          Читаются колонки: № или ID, Квартал, Команда, Владелец, Цель или «Запланировано», Метрика или «Как проверяем», База или Start, Целевое значение или «Целевые», Родительская цель или «Сквозная цель», Ссылка, Итог или «Закрытие». Разделы «Запланировано на Q4 2026» задают квартал, договорённости и бэклог не читаются. Без квартала цели идут в {quarterLabel(quarter)}.
        </p>
        )}
        {source === "file" ? (
          <FileField
            id="gi-file"
            label="Файл борда лидера"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            fileName={file?.name ?? null}
            onChange={(f) => {
              setFile(f);
              setPlan(null);
              setError(null);
            }}
          />
        ) : source === "paste" ? (
          <TextArea label="Ячейки из таблицы" id="gi-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} hint="Выделите вкладку вместе со строкой заголовков, скопируйте и вставьте" />
        ) : (
          <div className="flex flex-col gap-1.5">
            <TextInput label="Вкладка целей в Bord" id="gi-tab" value={tab} onChange={(e) => setTab(e.target.value)} list="gi-tabs" hint="Ресурс только читает вкладку тем же служебным аккаунтом, что и задачи" />
            <datalist id="gi-tabs">
              {bordTabs!.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        )}
        {error ? (
          <p role="alert" className="sv-alert sv-alert--danger">
            {error}
          </p>
        ) : null}
        {plan ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="text-body text-ink">
              Новых целей {plan.add.length}, изменится {plan.change.length}, без изменений {plan.same}
            </p>
            {plan.people?.length ? (
              <div>
                <p className="text-small font-medium text-ink">Чьи цели</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-ink">
                  {plan.people.map((p) => (
                    <li key={p.tab}>
                      {p.person}: целей {p.goals}, команда «{p.team}». Вкладка «{p.tab}»
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan.skipped?.length ? (
              <div>
                <p className="text-small font-medium text-ink">Не взяты</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-muted">
                  {plan.skipped.map((p) => (
                    <li key={p.tab}>
                      «{p.tab}»: {p.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan.problems.length ? (
              <ul className="flex list-disc flex-col gap-0.5 rounded-lg bg-danger-soft py-3 pl-8 pr-4 text-small text-danger-ink">
                {plan.problems.map((p, i) => (
                  <li key={i}>{source === "file" ? p.text : `Строка ${p.line}: ${p.text}`}</li>
                ))}
              </ul>
            ) : null}
            {plan.add.length ? (
              <div>
                <p className="text-small font-medium text-ink">Добавятся</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-ink">
                  {plan.add.map((a, i) => (
                    <li key={i}>
                      {quarterLabel(a.quarter)}, {a.team}: {a.code ? `${a.code}. ` : ""}
                      {a.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {plan.change.length ? (
              <div>
                <p className="text-small font-medium text-ink">Изменятся</p>
                <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-ink">
                  {plan.change.map((c, i) => (
                    <li key={i}>
                      {c.title}: {c.changes.join("; ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
