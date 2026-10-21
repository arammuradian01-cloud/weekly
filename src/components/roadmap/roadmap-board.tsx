"use client";

// Доска roadmap (этап 56): задачи команды или человека по направлениям и срокам, важные со звёздочками.
// На ноутбуке строки направлений и пять столбцов сроков. На телефоне столбцов нет: по каждому направлению список
// сроков сверху вниз, пустые сроки не показываются. Фильтр человека и «только важные» живут в адресе страницы:
// ссылкой на доску человека можно поделиться.

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePrototype } from "@/domain/store";
import { ownerName } from "@/domain/people";
import { DIRECTIONS, directionLabel, type PriorityCode } from "@/domain/dictionaries";
import { formatShort, plural } from "@/domain/dates";
import { isOverdue, overdueDays, permissions } from "@/lib/tasks/rules";
import { buildRoadmap, type Period, type RoadmapRow } from "@/lib/tasks/roadmap";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { SelectField } from "@/components/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import { GoalTag, OverdueNote, StateDot } from "@/components/ui/task-badges";
import { ImportanceMark, ImportanceMenu } from "@/components/ui/importance";
import { useViewer } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/task-drawer";

function RoadmapCard({ task, today, onOpen, onPriority, canPriority }: { task: Task; today: string; onOpen: () => void; onPriority: (next: PriorityCode) => void; canPriority: boolean }) {
  const overdue = isOverdue(task, today);
  return (
    <li>
      {/* Вся карточка открывает задачу через растянутую кнопку названия; кнопка важности лежит поверх неё, а не внутри */}
      <div className={cn("sv-card-task !cursor-pointer", overdue && "!bg-[var(--color-row-overdue)]")} data-testid={`roadmap-task-${task.number}`}>
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={onOpen} className="min-w-0 text-left text-small font-semibold leading-snug text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-control-lg focus-visible:after:ring-2 focus-visible:after:ring-blue">
            <span className="mr-1 font-normal tabular-nums text-muted">{task.number}</span>
            {task.title}
          </button>
          <span className="relative z-[1]">
            {canPriority ? <ImportanceMenu priority={task.priority} subject={`задачи ${task.number}`} onChange={onPriority} /> : <ImportanceMark priority={task.priority} className="pt-0.5" />}
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
          <span>{ownerName(task.owner, true)}</span>
          <span className={cn("tabular-nums", overdue && "font-semibold text-danger-ink")}>до {formatShort(task.due)}</span>
          {overdue ? <OverdueNote days={overdueDays(task, today)} /> : null}
          {task.status === "proposed" ? <span className="text-blue-700">предложена</span> : null}
          {task.state === "at-risk" || task.state === "blocked" ? <StateDot state={task.state} className="text-caption" /> : null}
        </p>
        {task.goal ? <GoalTag goal={task.goal} link={false} /> : null}
      </div>
    </li>
  );
}

/** Сколько карточек в ячейке видно сразу: остальные по кнопке «Ещё», чтобы одна длинная ячейка не растягивала доску */
const CELL_LIMIT = 4;

function Cell({ tasks, render, label }: { tasks: Task[]; render: (t: Task) => React.ReactNode; label: string }) {
  const [all, setAll] = useState(false);
  if (!tasks.length) return <div className="min-h-12 rounded-control-lg border border-dashed border-line" aria-hidden="true" />;
  const shown = all ? tasks : tasks.slice(0, CELL_LIMIT);
  const more = tasks.length - shown.length;
  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">{shown.map(render)}</ul>
      {more > 0 ? (
        <button type="button" onClick={() => setAll(true)} className="self-start text-small font-medium text-blue-700 hover:underline" aria-label={`${label}: показать ещё ${more}`}>
          Ещё {more}
        </button>
      ) : null}
    </div>
  );
}

function RowHeading({ row, id }: { row: RoadmapRow; id: string }) {
  return (
    <h2 id={id} className="flex flex-wrap items-baseline gap-x-3 text-body font-semibold text-ink">
      {row.label}
      <span className="text-small font-normal text-muted">
        {row.total} {plural(row.total, "задача", "задачи", "задач")}
        {row.important ? `, важных ${row.important}` : ""}
      </span>
    </h2>
  );
}

export function RoadmapBoard() {
  const { data, teamPeople, me } = usePrototype();
  const viewer = useViewer();
  const actions = useTaskActions();
  const { open } = useOpenTask();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Фильтры сразу меняют доску, а адрес догоняет их: флажок не ждёт перехода страницы
  const [person, setPerson] = useState<string | null>(params.get("person"));
  const [onlyImportant, setOnlyImportant] = useState(params.get("important") === "1");

  const setParam = (key: string, value: string | null) => {
    if (key === "person") setPerson(value);
    if (key === "important") setOnlyImportant(value === "1");
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Направления в порядке справочника; скрытое направление, у которого остались задачи, в конце
  const directions = useMemo(() => {
    const known = DIRECTIONS.map((d) => ({ code: d.code, label: d.label }));
    const extra = [...new Set(data.teamTasks.map((t) => t.direction))].filter((c) => !known.some((d) => d.code === c)).map((c) => ({ code: c, label: directionLabel(c) }));
    return [...known, ...extra];
  }, [data.teamTasks]);
  const people = teamPeople.filter((p) => p.role !== "OBSERVER");
  const chosen = person && people.some((p) => p.slug === person) ? person : null;
  const board = useMemo(() => buildRoadmap(data.teamTasks, data.today, { person: chosen, onlyImportant }, directions), [data.teamTasks, data.today, chosen, onlyImportant, directions]);

  const card = (t: Task) => (
    <RoadmapCard key={t.number} task={t} today={data.today} onOpen={() => open(t.number)} canPriority={permissions(t, viewer).priority} onPriority={(next) => actions.changePriority(t, next)} />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <SelectField
            label="Чьи задачи"
            id="roadmap-person"
            value={chosen ?? ""}
            onChange={(e) => setParam("person", e.target.value || null)}
            options={[{ value: "", label: "Вся команда" }, ...people.map((p) => ({ value: p.slug, label: p.slug === me.slug ? `${p.fullName} (я)` : p.fullName }))]}
            className="sm:w-72"
          />
          <label className="inline-flex h-11 cursor-pointer items-center gap-2 text-body text-ink">
            <input type="checkbox" className="h-4 w-4 accent-blue-700" checked={onlyImportant} onChange={(e) => setParam("important", e.target.checked ? "1" : null)} />
            Только важные
          </label>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted" aria-label="Обозначения">
          <span className="inline-flex items-center gap-1.5">
            <ImportanceMark priority="critical" />
            критичная
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ImportanceMark priority="high" />
            важная
          </span>
          <span>Важность меняется звёздочкой на карточке</span>
        </p>
      </div>

      <p className="text-small text-muted" data-testid="roadmap-summary" aria-live="polite">
        {board.total
          ? `На доске ${board.total} ${plural(board.total, "задача", "задачи", "задач")}, важных ${board.important}${board.overdue ? `, просрочено ${board.overdue}` : ""}`
          : null}
      </p>

      {!board.rows.length ? (
        <EmptyState title={onlyImportant ? "Важных задач нет" : "Задач впереди нет"}>
          {onlyImportant ? "Отметьте важные задачи звёздочкой или снимите фильтр «Только важные»." : "Здесь появятся открытые задачи команды по направлениям и срокам. Поставьте задачу кнопкой «Новая задача»."}
        </EmptyState>
      ) : (
        <>
          {/* Ноутбук: столбцы сроков общие для всех направлений */}
          <div className="hidden lg:block" data-testid="roadmap-grid">
            <div className="sticky top-0 z-10 grid grid-cols-5 gap-3 border-b border-line bg-canvas pb-2" aria-hidden="true">
              {board.periods.map((p) => (
                <p key={p.key} className={cn("text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>
                  {p.label}
                </p>
              ))}
            </div>
            {board.rows.map((row) => (
              <section key={row.direction} aria-labelledby={`rm-${row.direction}`} className="border-b border-line py-4" data-testid={`roadmap-row-${row.direction}`}>
                <RowHeading row={row} id={`rm-${row.direction}`} />
                <div className="mt-3 grid grid-cols-5 gap-3">
                  {board.periods.map((p) => (
                    <div key={p.key} aria-label={`${row.label}, ${p.label}`} role="group">
                      <Cell tasks={row.cells[p.key] ?? []} render={card} label={`${row.label}, ${p.label}`} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {/* Телефон и узкий экран: направления списком, внутри сроки по порядку */}
          <div className="flex flex-col gap-6 lg:hidden" data-testid="roadmap-list">
            {board.rows.map((row) => (
              <section key={row.direction} aria-labelledby={`rm-m-${row.direction}`}>
                <RowHeading row={row} id={`rm-m-${row.direction}`} />
                {board.periods
                  .filter((p: Period) => (row.cells[p.key] ?? []).length)
                  .map((p) => (
                    <div key={p.key} className="mt-3">
                      <h3 className={cn("mb-2 text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>{p.label}</h3>
                      <Cell tasks={row.cells[p.key] ?? []} render={card} label={`${row.label}, ${p.label}`} />
                    </div>
                  ))}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
