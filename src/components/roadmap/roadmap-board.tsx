"use client";

// Доска roadmap (этап 56): задачи команды или человека по направлениям и срокам, важные со звёздочками.
// На широком экране строки направлений и пять столбцов сроков. Уже 1280 пикселей столбцов нет: по каждому
// направлению список сроков сверху вниз, пустые сроки не показываются. Рисуется одно дерево, не два сразу.
// Фильтры «Чьи задачи» и «Только важные» живут в адресе страницы: ссылкой на доску человека можно поделиться, «Назад»
// возвращает прежний фильтр.
// Этап 68: на широком экране по умолчанию карта сроков (roadmap-timeline.tsx), доска вторым видом в адресе ?view=board.
// Этап 77: группировка «По задачам» (направления, как раньше), «По целям» (строки целей квартала) и «Цели и задачи»
// (под каждой целью её задачи, последней группой задачи без цели), в адресе ?group=goals|both. Работает и на карте
// сроков, и на доске. Адрес меняется через router.replace: нативный history.replaceState в Next 16.3 перезагружает
// страницу целиком (этап 70), а цели для группировок приходят с сервера по адресу.

import { useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { usePrototype } from "@/domain/store";
import { ownerName, personOf } from "@/domain/people";
import { DIRECTIONS, directionLabel, type PriorityCode } from "@/domain/dictionaries";
import { formatShort, plural } from "@/domain/dates";
import { isOverdue, overdueDays, permissions } from "@/lib/tasks/rules";
import { buildRoadmap, importanceOf, proposedLate, roadmapCells, type Period, type RoadmapRow } from "@/lib/tasks/roadmap";
import { buildGoalGroups, buildGoalTimeline, goalPeriodOf, groupByOf, type GoalGroup, type GoalGroups, type RoadmapGoal, type RoadmapGroupBy } from "@/lib/tasks/roadmap-goals";
import type { Task } from "@/domain/types";
import { changePriorityAction } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/cn";
import { Segmented } from "@/components/ui/primitives";
import { SearchPicker } from "@/components/ui/search-picker";
import { EmptyState } from "@/components/empty-state";
import { GoalTag, OverdueNote, StateDot } from "@/components/ui/task-badges";
import { ImportanceMark, ImportanceMenu, importanceWord } from "@/components/ui/importance";
import { useViewer } from "@/components/tasks/task-fields";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { buildTimeline, canMoveBar, type TimelineRange } from "@/lib/tasks/timeline";
import { RoadmapTimeline, type TimelineSection } from "./roadmap-timeline";
import { GoalCard, GoalGroupHeading, NoGoalHeading } from "./roadmap-goals";

/** Широкий экран: сетка сроков. Уже: список. На сервере и до гидратации список */
const WIDE = "(min-width: 1280px)";
/** Сенсорный экран (этап 68): полосы карты сроков пальцем не тянут, начало задаётся в карточке задачи */
const COARSE = "(pointer: coarse)";
/** Значение «Вся команда» в выборе человека: пустая строка в поиске значит «человек печатает» */
const WHOLE_TEAM = "__team";
const NO_GOAL = "nogoal";
function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function RoadmapCard({ task, today, onOpen, onPriority, canPriority, showGoal = true }: { task: Task; today: string; onOpen: () => void; onPriority: (next: PriorityCode) => void; canPriority: boolean; showGoal?: boolean }) {
  const overdue = isOverdue(task, today);
  return (
    <li>
      {/* Вся карточка открывает задачу через растянутую кнопку названия; кнопка важности лежит поверх неё, а не внутри.
          Рамка фокуса на самой карточке: у карточки overflow hidden, рамка на псевдоэлементе обрезалась бы */}
      <div
        className={cn("sv-card-task !cursor-pointer has-[button[data-rm-title]:focus-visible]:ring-2 has-[button[data-rm-title]:focus-visible]:ring-blue", overdue && "!bg-[var(--color-row-overdue)]")}
        data-testid={`roadmap-task-${task.number}`}
      >
        <button type="button" data-rm-title onClick={onOpen} className="text-left text-small font-semibold leading-snug text-ink [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
          <span className="mr-1 font-normal tabular-nums text-muted">{task.number}</span>{" "}
          {task.title}
        </button>
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
            <span>{ownerName(task.owner, true)}</span>
            <span className={cn("tabular-nums", overdue && "font-semibold text-danger-ink")}>до {formatShort(task.due)}</span>
            {overdue ? <OverdueNote days={overdueDays(task, today)} /> : null}
            {task.status === "proposed" ? <span className="text-blue-700">{proposedLate(task, today) ? "предложена, срок прошёл" : "предложена"}</span> : null}
            {task.state === "at-risk" || task.state === "blocked" ? <StateDot state={task.state} className="text-caption" /> : null}
          </p>
          <span className="relative z-[1] shrink-0">
            {canPriority ? <ImportanceMenu priority={task.priority} subject={`задачи ${task.number}`} onChange={onPriority} /> : <ImportanceMark priority={task.priority} />}
          </span>
        </div>
        {/* В группировке «Цели и задачи» карточка уже под своей целью: метка цели не нужна */}
        {task.goal && showGoal ? <GoalTag goal={task.goal} link={false} /> : null}
      </div>
    </li>
  );
}

/** Сколько карточек в ячейке видно сразу: остальные по кнопке «Ещё», чтобы одна длинная ячейка не растягивала доску */
const CELL_LIMIT = 4;

function Cell<T>({ items, render, label }: { items: T[]; render: (item: T) => React.ReactNode; label: string }) {
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  if (!items.length) return <div className="min-h-12 rounded-control-lg border border-dashed border-line" aria-hidden="true" />;
  const shown = all ? items : items.slice(0, CELL_LIMIT);
  const more = items.length - shown.length;
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <ul ref={listRef} className="m-0 flex list-none flex-col gap-2 p-0">
        {shown.map(render)}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          onClick={() => {
            setAll(true);
            // Кнопка исчезает: фокус на первую открывшуюся карточку, а не в никуда
            requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("[data-rm-title]")[CELL_LIMIT]?.focus());
          }}
          className="self-start text-small font-medium text-blue-700 hover:underline"
          aria-label={`${label}: показать ещё ${more}`}
        >
          Ещё {more}
        </button>
      ) : null}
    </div>
  );
}

function RowHeading({ row, id }: { row: RoadmapRow & { hidden?: boolean }; id: string }) {
  return (
    <h2 id={id} className="flex flex-wrap items-baseline gap-x-3 text-body font-semibold text-ink">
      {row.label}
      {row.hidden ? <span className="text-small font-normal text-muted">скрыто в справочнике</span> : null}
      <span className="text-small font-normal text-muted">
        {row.total} {plural(row.total, "задача", "задачи", "задач")}
        {row.important ? `, важных ${row.important}` : ""}
      </span>
    </h2>
  );
}

/** Строка столбцов сроков над широкой доской: липнет под верхней панелью (и под плашкой «Смотреть как», этап 63) */
function PeriodsHeader({ periods }: { periods: Period[] }) {
  return (
    <div className="sticky top-[calc(4rem+var(--view-as-h,0px))] z-10 grid grid-cols-5 gap-3 border-b border-line bg-canvas py-2" aria-hidden="true">
      {periods.map((p) => (
        <p key={p.key} className={cn("m-0 text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>
          {p.label}
        </p>
      ))}
    </div>
  );
}

const GROUPS: { value: RoadmapGroupBy; label: string }[] = [
  { value: "tasks", label: "По задачам" },
  { value: "goals", label: "По целям" },
  { value: "both", label: "Цели и задачи" },
];

/** Подпись над доской: сколько всего и сколько важных и просроченных */
function summaryText(group: RoadmapGroupBy, where: string, tasks: { total: number; important: number; overdue: number }, goals: GoalGroups | null): string | null {
  const tail = `${tasks.important ? `, важных ${tasks.important}` : ""}${tasks.overdue ? `, просрочено ${tasks.overdue}` : ""}`;
  if (group === "tasks" || !goals) return tasks.total ? `${where} ${tasks.total} ${plural(tasks.total, "задача", "задачи", "задач")}, важных ${tasks.important}${tasks.overdue ? `, просрочено ${tasks.overdue}` : ""}` : null;
  const n = goals.goals.length;
  const goalsWord = `${n} ${plural(n, "цель", "цели", "целей")}`;
  if (group === "goals") {
    if (!n) return null;
    const under = goals.total - goals.noGoal.length;
    return `${where} ${goalsWord}, под ними ${under} ${plural(under, "открытая задача", "открытые задачи", "открытых задач")}`;
  }
  if (!n && !goals.noGoal.length) return null;
  return `${where} ${goalsWord} и ${goals.total} ${plural(goals.total, "задача", "задачи", "задач")}, без цели ${goals.noGoal.length}${tail}`;
}

export function RoadmapBoard({ goals }: { goals: { quarter: string; goals: RoadmapGoal[] } | null }) {
  const { data, teamPeople, me, team, runTask, viewing } = usePrototype();
  const viewer = useViewer();
  const { open } = useOpenTask();
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const wide = useMedia(WIDE);
  const coarse = useMedia(COARSE);
  const person = params.get("person");
  const onlyImportant = params.get("important") === "1";
  // Этап 68: карта сроков на широком экране по умолчанию, доска по ?view=board. На узком экране только доска списком
  const view = params.get("view") === "board" ? "board" : "timeline";
  const group = groupByOf(params.get("group"));
  // Свёрнутые группы «Цели и задачи»: по умолчанию все раскрыты
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Этап 77: адрес меняется через router.replace без прокрутки, а не нативным history.replaceState: тот в Next 16.3
  // перезагружал страницу целиком (разобрано на этапе 70). Цели для группировок сервер отдаёт по новому адресу
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Направления в порядке справочника; скрытое направление, у которого остались задачи, в конце с пометкой
  // Пересчёт доски запоминает компилятор React: ручной useMemo здесь ему только мешает
  const known = DIRECTIONS.map((d) => ({ code: d.code, label: d.label }));
  const extra = [...new Set(data.teamTasks.map((t) => t.direction))].filter((c) => !known.some((d) => d.code === c)).map((c) => ({ code: c, label: directionLabel(c) }));
  const directions = { list: [...known, ...extra], hidden: new Set(extra.map((d) => d.code)) };
  const people = teamPeople.filter((p) => p.role !== "OBSERVER");
  const chosenPerson = person ? people.find((p) => p.slug === person) : undefined;
  const chosen = chosenPerson?.slug ?? null;
  // Человек из ссылки не в выбранной команде: говорим об этом, а не показываем молча всю команду
  const stranger = person && !chosenPerson ? person : null;
  const leads = chosenPerson?.role === "LEADER";
  const filter = { person: chosen, personLeads: leads, onlyImportant };
  const board = buildRoadmap(data.teamTasks, data.today, filter, directions.list);
  const canAny = data.teamTasks.some((t) => permissions(t, viewer).priority);
  const quarter = goals?.quarter ?? "";
  // Группы целей считаются из тех же задач на экране: правка срока или цели задачи сразу видна в группах
  const goalGroups = group !== "tasks" ? buildGoalGroups(data.teamTasks, goals?.goals ?? [], data.today, filter) : null;

  const changeImportance = (t: Task, next: PriorityCode) => void runTask(() => changePriorityAction(t.number, next), `Важность задачи ${t.number}: ${importanceWord(next)}`);
  const card = (t: Task, showGoal = true) => (
    <RoadmapCard key={t.number} task={t} today={data.today} onOpen={() => open(t.number)} canPriority={permissions(t, viewer).priority} onPriority={(next) => changeImportance(t, next)} showGoal={showGoal} />
  );
  const goalCard = (g: GoalGroup) => <GoalCard key={g.goal.id} group={g} quarter={quarter} />;
  const rows = board.rows.map((r) => ({ ...r, hidden: directions.hidden.has(r.direction) }));
  const showTimeline = wide && view === "timeline";
  const where = showTimeline ? "На карте" : "На доске";
  const summary = summaryText(group, where, board, goalGroups);
  const boardKey = `${team.id}-${chosen}-${onlyImportant}-${group}`;
  // Права как у срока. В «Смотреть как» и на сенсорном экране полосы не двигаются: сервер в просмотре всё равно откажет,
  // а пальцем полосу легко сдвинуть случайно. Начало и срок тогда меняют в карточке задачи. В группировках по целям так же
  const canMove = (t: Task) => canMoveBar(t, viewer, { viewing, coarse });

  // Карта сроков: разделы для выбранной группировки
  let sections: TimelineSection[] = [];
  let range: TimelineRange | null = null;
  if (showTimeline) {
    if (group === "tasks") {
      const timeline = buildTimeline(data.teamTasks, data.today, filter, directions.list);
      range = timeline.range;
      sections = timeline.rows.map((r) => ({ kind: "direction", key: r.direction, label: r.label, bars: r.bars, important: r.important }));
    } else if (goalGroups) {
      const timeline = buildGoalTimeline(goalGroups, data.today);
      range = timeline.range;
      if (group === "goals") sections = timeline.goals.length ? [{ kind: "goals", key: "goals", label: "Цели квартала", rows: timeline.goals }] : [];
      else {
        sections = timeline.goals.map((row) => ({ kind: "goal", key: row.group.goal.id, row }));
        if (timeline.noGoal.length)
          sections.push({ kind: "nogoal", key: NO_GOAL, label: "Задачи без цели", bars: timeline.noGoal, important: goalGroups.noGoal.filter((t) => importanceOf(t.priority) > 0).length, overdue: timeline.noGoal.filter((b) => b.overdue).length });
      }
    }
  }

  const empty = group === "tasks" ? !rows.length : group === "goals" ? !goalGroups?.goals.length : !goalGroups?.goals.length && !goalGroups?.noGoal.length;
  const noGoalCount = goalGroups
    ? { tasks: goalGroups.noGoal, important: goalGroups.noGoal.filter((t) => importanceOf(t.priority) > 0).length, overdue: goalGroups.noGoal.filter((t) => isOverdue(t, data.today)).length }
    : null;

  const emptyState =
    group === "goals" ? (
      <EmptyState title={onlyImportant ? "Важных задач под целями нет" : chosen ? "У человека нет задач под целями квартала" : "Целей квартала нет"}>
        {chosen || onlyImportant ? (
          "Снимите фильтр или откройте группировку «По задачам»: там все открытые задачи."
        ) : (
          <>
            Цели квартала заводят на экране{" "}
            <Link href="/goals" className="font-medium text-blue-700 underline-offset-2 hover:underline">
              «Цели»
            </Link>
            . Задачи без цели видны в группировках «По задачам» и «Цели и задачи».
          </>
        )}
      </EmptyState>
    ) : (
      <EmptyState title={onlyImportant ? "Важных задач нет" : "Задач впереди нет"}>
        {onlyImportant
          ? canAny
            ? "Отметьте важные задачи звёздочкой или снимите фильтр «Только важные»."
            : "Снимите фильтр «Только важные», чтобы увидеть все задачи."
          : chosen
            ? "У человека нет открытых задач в выбранной команде."
            : "Здесь появятся открытые задачи команды по направлениям и срокам. Поставьте задачу кнопкой «Новая задача»."}
      </EmptyState>
    );

  // Доска «По целям»: карточки целей по месяцу самого позднего срока
  const goalsBoard = () => {
    const list = goalGroups?.goals ?? [];
    const cells = Object.fromEntries(board.periods.map((p) => [p.key, list.filter((g) => goalPeriodOf(g, data.today, board.periods) === p.key)]));
    const heading = (
      <h2 id="rm-goals" className="flex flex-wrap items-baseline gap-x-3 text-body font-semibold text-ink">
        Цели квартала
        <span className="text-small font-normal text-muted">
          {list.length} {plural(list.length, "цель", "цели", "целей")}
        </span>
      </h2>
    );
    return wide ? (
      <div data-testid="roadmap-grid" data-group="goals" key={boardKey}>
        <PeriodsHeader periods={board.periods} />
        <section aria-labelledby="rm-goals" className="border-b border-line py-4" data-testid="roadmap-goals">
          {heading}
          <div className="mt-3 grid grid-cols-5 gap-3">
            {board.periods.map((p) => (
              <Cell key={p.key} items={cells[p.key] ?? []} render={goalCard} label={`Цели, ${p.label}`} />
            ))}
          </div>
        </section>
      </div>
    ) : (
      <div className="flex flex-col gap-6" data-testid="roadmap-list" data-group="goals" key={boardKey}>
        <section aria-labelledby="rm-goals" data-testid="roadmap-goals">
          {heading}
          {board.periods
            .filter((p) => (cells[p.key] ?? []).length)
            .map((p) => (
              <div key={p.key} className="mt-3">
                <h3 className={cn("mb-2 text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>{p.label}</h3>
                <Cell items={cells[p.key] ?? []} render={goalCard} label={`Цели, ${p.label}`} />
              </div>
            ))}
        </section>
      </div>
    );
  };

  // Доска «Цели и задачи»: группа цели со своими задачами по срокам, последней группой задачи без цели
  const bothBoard = () => {
    const list = goalGroups?.goals ?? [];
    const tasksOf = (tasks: Task[], label: string, id: string, open: boolean) => {
      const cells = roadmapCells(tasks, data.today, board.periods);
      const render = (t: Task) => card(t, false);
      if (!tasks.length)
        return (
          <p id={id} hidden={!open} className="m-0 mt-2 text-small text-muted sm:pl-7">
            Открытых задач у цели нет
          </p>
        );
      return wide ? (
        <div id={id} hidden={!open} className="mt-3 grid grid-cols-5 gap-3">
          {board.periods.map((p) => (
            <Cell key={p.key} items={cells[p.key] ?? []} render={render} label={`${label}, ${p.label}`} />
          ))}
        </div>
      ) : (
        <div id={id} hidden={!open}>
          {board.periods
            .filter((p) => (cells[p.key] ?? []).length)
            .map((p) => (
              <div key={p.key} className="mt-3">
                <h3 className={cn("mb-2 text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>{p.label}</h3>
                <Cell items={cells[p.key] ?? []} render={render} label={`${label}, ${p.label}`} />
              </div>
            ))}
        </div>
      );
    };
    const prefix = wide ? "rm" : "rm-m";
    const sectionCls = wide ? "border-b border-line py-4" : "";
    return (
      <div className={wide ? "" : "flex flex-col gap-6"} data-testid={wide ? "roadmap-grid" : "roadmap-list"} data-group="both" key={boardKey}>
        {wide ? <PeriodsHeader periods={board.periods} /> : null}
        {list.map((g) => {
          const id = g.goal.id;
          const isOpen = !collapsed.has(id);
          const name = g.goal.code ? `Цель ${g.goal.code}` : g.goal.title;
          return (
            <section key={id} aria-labelledby={`${prefix}-goal-${id}`} className={sectionCls} data-testid={`roadmap-group-${id}`}>
              <GoalGroupHeading group={g} quarter={quarter} id={`${prefix}-goal-${id}`} open={isOpen} onToggle={() => toggle(id)} controls={`${prefix}-goal-tasks-${id}`} />
              {tasksOf(g.tasks, name, `${prefix}-goal-tasks-${id}`, isOpen)}
            </section>
          );
        })}
        {noGoalCount && noGoalCount.tasks.length ? (
          <section aria-labelledby={`${prefix}-nogoal`} className={sectionCls} data-testid="roadmap-nogoal">
            <NoGoalHeading count={noGoalCount} id={`${prefix}-nogoal`} open={!collapsed.has(NO_GOAL)} onToggle={() => toggle(NO_GOAL)} controls={`${prefix}-nogoal-tasks`} />
            {tasksOf(noGoalCount.tasks, "Задачи без цели", `${prefix}-nogoal-tasks`, !collapsed.has(NO_GOAL))}
          </section>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          {wide ? (
            <Segmented
              label="Вид roadmap"
              value={view}
              onChange={(v) => setParam("view", v === "board" ? "board" : null)}
              options={[
                { value: "timeline", label: "Карта сроков" },
                { value: "board", label: "Доска по месяцам" },
              ]}
              className="self-end"
            />
          ) : null}
          {/* На телефоне три кнопки делят ширину поровну и не уже 44 px по высоте: переключатель помещается в 360 */}
          <div className="flex flex-col gap-1">
            <span className="text-small font-medium text-ink" aria-hidden="true">
              Группировка
            </span>
            <Segmented
              label="Группировка"
              value={group}
              onChange={(v) => setParam("group", v === "tasks" ? null : v)}
              options={GROUPS}
              className="max-sm:flex max-sm:w-full max-sm:[&>*]:min-h-11 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1 max-sm:[&>*]:whitespace-normal max-sm:[&>*]:text-center max-sm:[&>*]:leading-tight"
            />
          </div>
          {/* Выбор человека с поиском (этап 77): в «Все мои команды» людей десятки, нативный список длинный */}
          <SearchPicker
            label="Чьи задачи"
            id="roadmap-person"
            value={chosen ?? WHOLE_TEAM}
            // Пустое значение приходит, пока человек печатает: выбор не сбрасывается, пока не выбран новый вариант
            onChange={(v) => {
              if (!v) return;
              setParam("person", v === WHOLE_TEAM ? null : v);
            }}
            options={[{ value: WHOLE_TEAM, label: "Вся команда" }, ...people.map((p) => ({ value: p.slug, label: p.slug === me.slug ? `${p.fullName} (я)` : p.fullName }))]}
            placeholder="Вся команда"
            emptyText="Никого не нашли в команде: проверьте написание"
            className="sm:w-72"
          />
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 text-body text-ink">
            <input type="checkbox" className="h-4 w-4 accent-blue-700" checked={onlyImportant} onChange={(e) => setParam("important", e.target.checked ? "1" : null)} />
            Только важные
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted">
          <span className="inline-flex items-center gap-1.5">
            <ImportanceMark priority="critical" decorative />
            критичная
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ImportanceMark priority="high" decorative />
            важная
          </span>
          {/* На карте сроков меню важности нет: важность меняют на доске или в карточке задачи */}
          {canAny && !showTimeline && group !== "goals" ? <span>Важность меняется звёздочкой на карточке</span> : null}
        </div>
      </div>

      {stranger ? (
        <p className="sv-alert sv-alert--info flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="roadmap-stranger">
          {`${personOf(stranger).fullName || "Этот человек"} не в выбранной команде: показана вся команда.`}
          <button type="button" onClick={() => setParam("person", null)} className="font-medium text-blue-700 hover:underline">
            Сбросить
          </button>
        </p>
      ) : null}

      <p className="text-small text-muted" data-testid="roadmap-summary" aria-live="polite">
        {summary}
      </p>

      {empty ? (
        emptyState
      ) : showTimeline && range ? (
        <RoadmapTimeline
          key={boardKey}
          range={range}
          sections={sections}
          today={data.today}
          quarter={quarter}
          collapsed={collapsed}
          onToggle={toggle}
          canMove={canMove}
          onOpen={open}
          runTask={runTask}
        />
      ) : group === "goals" ? (
        goalsBoard()
      ) : group === "both" ? (
        bothBoard()
      ) : wide ? (
        // Широкий экран: столбцы сроков общие для всех направлений, строка столбцов липнет под верхней панелью
        <div data-testid="roadmap-grid" data-group="tasks" key={boardKey}>
          <PeriodsHeader periods={board.periods} />
          {rows.map((row) => (
            <section key={row.direction} aria-labelledby={`rm-${row.direction}`} className="border-b border-line py-4" data-testid={`roadmap-row-${row.direction}`}>
              <RowHeading row={row} id={`rm-${row.direction}`} />
              <div className="mt-3 grid grid-cols-5 gap-3">
                {board.periods.map((p) => (
                  <Cell key={p.key} items={row.cells[p.key] ?? []} render={(t: Task) => card(t)} label={`${row.label}, ${p.label}`} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        // Телефон и узкий экран: направления списком, внутри сроки по порядку
        <div className="flex flex-col gap-6" data-testid="roadmap-list" data-group="tasks" key={boardKey}>
          {rows.map((row) => (
            <section key={row.direction} aria-labelledby={`rm-m-${row.direction}`}>
              <RowHeading row={row} id={`rm-m-${row.direction}`} />
              {board.periods
                .filter((p) => (row.cells[p.key] ?? []).length)
                .map((p) => (
                  <div key={p.key} className="mt-3">
                    <h3 className={cn("mb-2 text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>{p.label}</h3>
                    <Cell items={row.cells[p.key] ?? []} render={(t: Task) => card(t)} label={`${row.label}, ${p.label}`} />
                  </div>
                ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
