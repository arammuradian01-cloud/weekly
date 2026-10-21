"use client";

// Доска roadmap (этап 56): задачи команды или человека по направлениям и срокам, важные со звёздочками.
// На широком экране строки направлений и пять столбцов сроков. Уже 1280 пикселей столбцов нет: по каждому
// направлению список сроков сверху вниз, пустые сроки не показываются. Рисуется одно дерево, не два сразу.
// Фильтры «Чьи задачи» и «Только важные» живут в адресе страницы (без запроса к серверу): ссылкой на доску
// человека можно поделиться, «Назад» возвращает прежний фильтр.

import { useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { usePrototype } from "@/domain/store";
import { ownerName, personOf } from "@/domain/people";
import { DIRECTIONS, directionLabel, type PriorityCode } from "@/domain/dictionaries";
import { formatShort, plural } from "@/domain/dates";
import { isOverdue, overdueDays, permissions } from "@/lib/tasks/rules";
import { buildRoadmap, proposedLate, type RoadmapRow } from "@/lib/tasks/roadmap";
import type { Task } from "@/domain/types";
import { changePriorityAction } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/cn";
import { SelectField } from "@/components/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import { GoalTag, OverdueNote, StateDot } from "@/components/ui/task-badges";
import { ImportanceMark, ImportanceMenu, importanceWord } from "@/components/ui/importance";
import { useViewer } from "@/components/tasks/task-fields";
import { useOpenTask } from "@/components/tasks/task-drawer";

/** Широкий экран: сетка сроков. Уже: список. На сервере и до гидратации список */
const WIDE = "(min-width: 1280px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

function RoadmapCard({ task, today, onOpen, onPriority, canPriority }: { task: Task; today: string; onOpen: () => void; onPriority: (next: PriorityCode) => void; canPriority: boolean }) {
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
        {task.goal ? <GoalTag goal={task.goal} link={false} /> : null}
      </div>
    </li>
  );
}

/** Сколько карточек в ячейке видно сразу: остальные по кнопке «Ещё», чтобы одна длинная ячейка не растягивала доску */
const CELL_LIMIT = 4;

function Cell({ tasks, render, label }: { tasks: Task[]; render: (t: Task) => React.ReactNode; label: string }) {
  const [all, setAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  if (!tasks.length) return <div className="min-h-12 rounded-control-lg border border-dashed border-line" aria-hidden="true" />;
  const shown = all ? tasks : tasks.slice(0, CELL_LIMIT);
  const more = tasks.length - shown.length;
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
            requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-rm-title]")[CELL_LIMIT]?.focus());
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

export function RoadmapBoard() {
  const { data, teamPeople, me, team, runTask } = usePrototype();
  const viewer = useViewer();
  const { open } = useOpenTask();
  const params = useSearchParams();
  const pathname = usePathname();
  const wide = useWide();
  const person = params.get("person");
  const onlyImportant = params.get("important") === "1";

  // Адрес меняется без перехода страницы: Next видит его через useSearchParams, сервер не дёргается
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
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
  const board = buildRoadmap(data.teamTasks, data.today, { person: chosen, personLeads: leads, onlyImportant }, directions.list);
  const canAny = data.teamTasks.some((t) => permissions(t, viewer).priority);

  const changeImportance = (t: Task, next: PriorityCode) => void runTask(() => changePriorityAction(t.number, next), `Важность задачи ${t.number}: ${importanceWord(next)}`);
  const card = (t: Task) => <RoadmapCard key={t.number} task={t} today={data.today} onOpen={() => open(t.number)} canPriority={permissions(t, viewer).priority} onPriority={(next) => changeImportance(t, next)} />;
  const rows = board.rows.map((r) => ({ ...r, hidden: directions.hidden.has(r.direction) }));

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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted">
          <span className="inline-flex items-center gap-1.5">
            <ImportanceMark priority="critical" decorative />
            критичная
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ImportanceMark priority="high" decorative />
            важная
          </span>
          {canAny ? <span>Важность меняется звёздочкой на карточке</span> : null}
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
        {board.total
          ? `На доске ${board.total} ${plural(board.total, "задача", "задачи", "задач")}, важных ${board.important}${board.overdue ? `, просрочено ${board.overdue}` : ""}`
          : null}
      </p>

      {!rows.length ? (
        <EmptyState title={onlyImportant ? "Важных задач нет" : "Задач впереди нет"}>
          {onlyImportant
            ? canAny
              ? "Отметьте важные задачи звёздочкой или снимите фильтр «Только важные»."
              : "Снимите фильтр «Только важные», чтобы увидеть все задачи."
            : chosen
              ? "У человека нет открытых задач в выбранной команде."
              : "Здесь появятся открытые задачи команды по направлениям и срокам. Поставьте задачу кнопкой «Новая задача»."}
        </EmptyState>
      ) : wide ? (
        // Широкий экран: столбцы сроков общие для всех направлений, строка столбцов липнет под верхней панелью
        <div data-testid="roadmap-grid" key={`${team.id}-${chosen}-${onlyImportant}`}>
          <div className="sticky top-16 z-10 grid grid-cols-5 gap-3 border-b border-line bg-canvas py-2" aria-hidden="true">
            {board.periods.map((p) => (
              <p key={p.key} className={cn("m-0 text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>
                {p.label}
              </p>
            ))}
          </div>
          {rows.map((row) => (
            <section key={row.direction} aria-labelledby={`rm-${row.direction}`} className="border-b border-line py-4" data-testid={`roadmap-row-${row.direction}`}>
              <RowHeading row={row} id={`rm-${row.direction}`} />
              <div className="mt-3 grid grid-cols-5 gap-3">
                {board.periods.map((p) => (
                  <Cell key={p.key} tasks={row.cells[p.key] ?? []} render={card} label={`${row.label}, ${p.label}`} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        // Телефон и узкий экран: направления списком, внутри сроки по порядку
        <div className="flex flex-col gap-6" data-testid="roadmap-list" key={`${team.id}-${chosen}-${onlyImportant}`}>
          {rows.map((row) => (
            <section key={row.direction} aria-labelledby={`rm-m-${row.direction}`}>
              <RowHeading row={row} id={`rm-m-${row.direction}`} />
              {board.periods
                .filter((p) => (row.cells[p.key] ?? []).length)
                .map((p) => (
                  <div key={p.key} className="mt-3">
                    <h3 className={cn("mb-2 text-small font-semibold", p.key === "overdue" ? "text-danger-ink" : "text-muted")}>{p.label}</h3>
                    <Cell tasks={row.cells[p.key] ?? []} render={card} label={`${row.label}, ${p.label}`} />
                  </div>
                ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
