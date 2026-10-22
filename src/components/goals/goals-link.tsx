"use client";

// Связать задачи с целями (этап 65). Задача Арама 22.10: сотрудник перетаскивает к каждой цели задачи, которыми
// занимался или которые видел. Слева (на телефоне сверху) цели человека и его команд на квартал, справа «Мои задачи».
// Мышью тянут строку задачи, пальцем долгим нажатием, с клавиатуры: пробел берёт задачу, стрелки выбирают цель,
// пробел отпускает, Escape отменяет. Без перетаскивания то же кнопкой «К цели» у задачи и «Привязать к цели» для
// отмеченных. Правка видна сразу, при ошибке возвращается; в тосте «Отменить».

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical, Search, Target, X } from "lucide-react";
import type { GoalLinkBoard } from "@/lib/goals/link-board";
import {
  REASON_LABEL,
  failedText,
  filterCounts,
  filterTasks,
  goalFitsTask,
  goalName,
  groupGoals,
  groupTasks,
  linkedText,
  nothingToMove,
  planLink,
  stepTarget,
  tasksByGoal,
  type GoalOf,
  type LinkFilter,
  type LinkGoal,
  type LinkTask,
} from "@/lib/goals/links";
import { quarterLabel } from "@/lib/goals/parse";
import { progressLabel } from "@/lib/goals/progress";
import { STATUSES } from "@/domain/dictionaries";
import { diffDays, formatShort, plural, type IsoDate } from "@/domain/dates";
import { usePrototype } from "@/domain/store";
import { linkTasksToGoalAction, undoGoalLinksAction } from "@/app/(app)/goals/actions";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Segmented, SelectField, TextInput } from "@/components/ui/primitives";

/** Перетаскиваемая область: долгое нажатие на телефоне не выделяет текст и не открывает системное меню */
const dragArea = "cursor-grab select-none [-webkit-touch-callout:none]";
/** Сколько задач показывать сразу, дальше «Показать ещё» */
const PAGE = { open: 40, closed: 20 };

type DragData = { number: number; from: "list" | "goal" };
type DropData = { kind: "goal"; id: string; order: number } | { kind: "none"; order: number };
/** Правка, которая ещё не пришла с сервера: pending, пока сервер не ответил. seq отличает повторную правку той же задачи */
type Override = { goal: string | null; pending: boolean; seq: number };

const statusLabel = (code: LinkTask["status"]) => STATUSES.find((s) => s.code === code)?.label ?? "";

/** Отмеченные задачи тянутся вместе, если тянут одну из них; иначе одна задача */
function dragNumbers(data: DragData | undefined, selected: Set<number>): number[] {
  if (!data) return [];
  return data.from === "list" && selected.has(data.number) && selected.size > 1 ? [...selected] : [data.number];
}

export function GoalsLink({ board }: { board: GoalLinkBoard }) {
  const router = useRouter();
  const { data, notify, notifyUndo } = usePrototype();
  const today = data.today;
  const interactive = !board.observer;
  const [filter, setFilter] = useState<LinkFilter>("nogoal");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [overrides, setOverrides] = useState<Map<number, Override>>(() => new Map());
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState<number[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const seq = useRef(0);
  // Цель, к которой задачу подвели стрелками. С клавиатуры «над чем задача» решает выбор стрелкой, а не геометрия:
  // dnd-kit при стрелках ещё и прокручивает страницу, и пересчёт по координатам мог бы попасть на соседнюю цель
  const keyTarget = useRef<UniqueIdentifier | null>(null);
  /** Мышь и палец: цель под курсором. Клавиатура: цель, выбранная стрелками */
  const collision: CollisionDetection = (args) => {
    if (args.pointerCoordinates) return pointerWithin(args);
    const id = keyTarget.current;
    const hit = id === null ? undefined : args.droppableContainers.find((c) => c.id === id && !c.disabled);
    return hit ? [{ id: hit.id, data: { droppableContainer: hit, value: 0 } }] : [];
  };
  /** Стрелки ведут задачу с цели на цель по порядку на экране, а не на 25 пикселей, как по умолчанию */
  const stepCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
    const forward = event.code === "ArrowDown" || event.code === "ArrowRight";
    const back = event.code === "ArrowUp" || event.code === "ArrowLeft";
    if (!forward && !back) return undefined;
    event.preventDefault();
    const { collisionRect, droppableRects, droppableContainers } = context;
    if (!collisionRect) return undefined;
    const order = (data: unknown) => (data as DropData | undefined)?.order ?? 0;
    const targets = droppableContainers
      .getEnabled()
      .filter((c) => !c.disabled && droppableRects.has(c.id))
      .sort((a, b) => order(a.data.current) - order(b.data.current));
    const next = stepTarget(targets.length, targets.findIndex((t) => t.id === keyTarget.current), forward);
    if (next < 0) return undefined;
    const target = targets[next]!;
    keyTarget.current = target.id;
    // Карточка задачи встаёт посередине цели: видно, куда она ляжет
    const rect = droppableRects.get(target.id)!;
    return { x: rect.left + rect.width / 2 - collisionRect.width / 2, y: rect.top + rect.height / 2 - collisionRect.height / 2 };
  };
  // Свежие данные с сервера: правки, на которые сервер уже ответил, в них есть. Ждущие ответа правки остаются
  const [seen, setSeen] = useState(board);
  if (seen !== board) {
    setSeen(board);
    setOverrides((m) => new Map([...m].filter(([, o]) => o.pending)));
  }
  // Мышь и палец отдельно: пальцем перетаскивание начинается долгим нажатием, свайп прокручивает страницу
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: stepCoordinates }),
  );

  const byNumber = useMemo(() => new Map(board.tasks.map((t) => [t.number, t])), [board.tasks]);
  const goalById = useMemo(() => new Map(board.goals.map((g) => [g.id, g])), [board.goals]);
  const goalOf: GoalOf = (t) => {
    const o = overrides.get(t.number);
    return o ? o.goal : (t.goal?.id ?? null);
  };
  /** Цель задачи для подписи: цель экрана или цель задачи с сервера (другой квартал, чужая команда) */
  const goalShown = (t: LinkTask): { code: string | null; title: string } | null => {
    const id = goalOf(t);
    if (!id) return null;
    return goalById.get(id) ?? (t.goal?.id === id ? t.goal : null);
  };

  const counts = filterCounts(board.tasks, goalOf);
  const shown = groupTasks(filterTasks(board.tasks, filter, query, goalOf));
  const linked = tasksByGoal(board.tasks, goalOf);
  const groups = groupGoals(board.goals);
  const orderOf = new Map(board.goals.map((g, i) => [g.id, i + 1]));
  const draggedTasks = (dragging ?? []).map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);

  const toggle = (n: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  /** Вернуть прежние цели (кнопка «Отменить» в тосте) */
  const revert = async (items: { number: number; token: string; goal: string | null }[]) => {
    const mine = ++seq.current;
    setOverrides((m) => {
      const next = new Map(m);
      for (const it of items) next.set(it.number, { goal: it.goal, pending: true, seq: mine });
      return next;
    });
    let r: Awaited<ReturnType<typeof undoGoalLinksAction>>;
    try {
      r = await undoGoalLinksAction(items.map(({ number, token }) => ({ number, token })));
    } catch {
      r = { ok: false, error: "Нет связи с сервером: отменить не получилось" };
    }
    const back = new Map(r.ok ? r.value.done.map((d) => [d.number, d.goal]) : []);
    setOverrides((m) => {
      const next = new Map(m);
      for (const it of items) {
        if (next.get(it.number)?.seq !== mine) continue;
        if (back.has(it.number)) next.set(it.number, { goal: back.get(it.number) ?? null, pending: false, seq: mine });
        else next.delete(it.number);
      }
      return next;
    });
    if (!r.ok) notify(r.error, "error");
    else if (r.value.failed.length) notify(failedText(r.value.failed), "error");
    else notify(items.length > 1 ? "Отменено: связи задач с целями как были" : items[0]?.goal ? "Отменено: задача снова у прежней цели" : "Отменено: задача снова без цели");
    router.refresh();
  };

  /** Связать задачи с целью (goalId null: снять цель). Экран меняется сразу, при ошибке возвращается */
  const commit = async (numbers: number[], goalId: string | null) => {
    const goal = goalId ? (goalById.get(goalId) ?? null) : null;
    const list = numbers.map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);
    const plan = planLink(list, goal, goalOf);
    // Двигать нечего. Задачу отпустили на её же цель: молча, это не ошибка. Не подходит или нет права: объясняем
    if (!plan.move.length) {
      if (plan.unfit.length || plan.locked.length) notify(nothingToMove(plan, goal), "error");
      return;
    }
    const before = new Map(plan.move.map((n) => [n, goalOf(byNumber.get(n)!)]));
    const mine = ++seq.current;
    setOverrides((m) => {
      const next = new Map(m);
      for (const n of plan.move) next.set(n, { goal: goalId, pending: true, seq: mine });
      return next;
    });
    setSelected(new Set());
    let r: Awaited<ReturnType<typeof linkTasksToGoalAction>>;
    try {
      r = await linkTasksToGoalAction(plan.move, goalId);
    } catch {
      r = { ok: false, error: "Нет связи с сервером: связь с целью не сохранилась" };
    }
    const failed = new Set(r.ok ? r.value.failed.map((f) => f.number) : plan.move);
    setOverrides((m) => {
      const next = new Map(m);
      for (const n of plan.move) {
        if (next.get(n)?.seq !== mine) continue;
        if (failed.has(n)) next.delete(n);
        else next.set(n, { goal: goalId, pending: false, seq: mine });
      }
      return next;
    });
    if (!r.ok) {
      notify(r.error, "error");
      return;
    }
    const done = r.value.done;
    // Не подошли цели или без права: говорим одной фразой после главного
    const skipped = [...plan.unfit, ...plan.locked];
    const tail = [failedText(r.value.failed), skipped.length ? `Не подошли к цели: ${skipped.join(", ")}` : ""].filter(Boolean);
    if (!done.length) notify(tail.join(". "), "error");
    else {
      const text = [linkedText(done.map((d) => d.number), goal), ...tail].join(". ");
      const tokens = done.filter((d) => d.undo).map((d) => ({ number: d.number, token: d.undo!, goal: before.get(d.number) ?? null }));
      if (tokens.length) notifyUndo(text, () => void revert(tokens));
      else notify(text);
    }
    router.refresh();
  };

  const onDragStart = (e: DragStartEvent) => {
    keyTarget.current = null;
    setDragging(dragNumbers(e.active.data.current as DragData | undefined, selected));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const numbers = dragNumbers(e.active.data.current as DragData | undefined, selected);
    keyTarget.current = null;
    setDragging(null);
    const target = e.over?.data.current as DropData | undefined;
    if (!target || !numbers.length) return;
    void commit(numbers, target.kind === "goal" ? target.id : null);
  };

  const subjectOf = (id: UniqueIdentifier) => {
    const n = Number(String(id).slice(2));
    const numbers = dragNumbers({ number: n, from: String(id).startsWith("t:") ? "list" : "goal" }, selected);
    if (numbers.length > 1) return `отмеченные задачи, ${numbers.length}`;
    const t = byNumber.get(n);
    return t ? `задача ${t.number}, «${t.title}»` : `задача ${n}`;
  };
  const targetOf = (id: UniqueIdentifier) => {
    if (id === "none") return "без цели, цель снимется";
    const g = goalById.get(String(id).slice(5));
    return g ? `цель «${goalName(g)}»` : "цель";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Взяли: ${subjectOf(active.id)}. Стрелками выберите цель, пробел или Enter привязывает, Escape отменяет`,
    onDragOver: ({ over }) => (over ? `Над: ${targetOf(over.id)}` : "Вне целей"),
    onDragEnd: ({ over }) => (over ? `Отпущено на: ${targetOf(over.id)}` : "Отпущено вне целей, связь не изменилась"),
    onDragCancel: () => "Перетаскивание отменено, связь не изменилась",
  };

  // Задача могла пропасть после обновления (её перенесли в другую команду): окно выбора без задач не открывается
  const pickerTasks = (picker ?? []).map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);
  const selectedTasks = [...selected].map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);
  const quarterName = quarterLabel(board.quarter);
  const openShown = shown.open.slice(0, limit.open);
  const closedShown = shown.closed.slice(0, limit.closed);

  const row = (t: LinkTask) => (
    <TaskRow
      key={t.number}
      task={t}
      goal={goalShown(t)}
      today={today}
      interactive={interactive}
      selected={selected.has(t.number)}
      pending={!!overrides.get(t.number)?.pending}
      onSelect={() => toggle(t.number)}
      onPick={() => setPicker([t.number])}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        keyTarget.current = null;
        setDragging(null);
      }}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "Чтобы взять задачу, нажмите пробел или Enter. Стрелками переходите между целями, пробел или Enter привязывает задачу к цели, Escape отменяет. Без перетаскивания нажмите «К цели» у задачи.",
        },
      }}
    >
      <div className="flex flex-col gap-5" data-testid="goals-link">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SelectField
            label="Квартал"
            id="link-quarter"
            value={board.quarter}
            onChange={(e) => router.push(`/goals?mode=link&q=${e.target.value}`)}
            options={board.quarters.map((x) => ({ value: x, label: quarterLabel(x) }))}
            className="sm:w-44"
          />
          <a href="#link-tasks" className="inline-flex min-h-11 items-center text-body font-medium text-blue-700 hover:underline lg:hidden">
            К моим задачам: без цели {counts.nogoal}
          </a>
        </div>
        {board.observer ? <p className="sv-alert sv-alert--info">Наблюдатель только смотрит: связи задач с целями меняют ответственные и руководители команд.</p> : null}
        {board.limited ? <p className="sv-alert sv-alert--info">Вход по общему логину: цель можно сменить только у задач, которые вы ведёте или поставили. Задачи команды привязывают, войдя по своей ссылке.</p> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="link-goals-title" className="flex min-w-0 flex-col gap-3">
            <div>
              <h2 id="link-goals-title" className="text-title font-semibold text-ink">
                Цели на {quarterName}
              </h2>
              <p className="mt-1 text-small text-muted">Перетащите задачу на цель. У цели кнопка «Задачи»: там видно, что на неё работает, и задачу можно отвязать.</p>
            </div>
            {interactive ? <NoneZone dragging={dragging !== null} enabled={draggedTasks.some((t) => goalOf(t) !== null)} /> : null}
            {groups.length ? (
              groups.map((g) => (
                <div key={g.key} className="flex flex-col gap-2">
                  <h3 className="text-small font-semibold text-muted">{g.label}</h3>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {g.goals.map((goal) => (
                      <GoalCard
                        key={goal.id}
                        goal={goal}
                        order={orderOf.get(goal.id) ?? 0}
                        tasks={linked.get(goal.id) ?? []}
                        open={open.has(goal.id)}
                        onToggle={() =>
                          setOpen((s) => {
                            const next = new Set(s);
                            if (next.has(goal.id)) next.delete(goal.id);
                            else next.add(goal.id);
                            return next;
                          })
                        }
                        dragging={dragging !== null}
                        fits={draggedTasks.length > 0 && draggedTasks.some((t) => goalFitsTask(goal, t))}
                        interactive={interactive}
                        onUnlink={(n) => void commit([n], null)}
                      />
                    ))}
                  </ul>
                </div>
              ))
            ) : (
              <p className="sv-card sv-card--soft px-4 py-3 text-small text-muted" data-testid="link-no-goals">
                Целей на {quarterName} у вас и ваших команд пока нет. Их заводят руководители команд на вкладке «Цели квартала».
              </p>
            )}
          </section>

          <section id="link-tasks" aria-labelledby="link-tasks-title" className="flex min-w-0 scroll-mt-20 flex-col gap-3">
            <div>
              <h2 id="link-tasks-title" className="text-title font-semibold text-ink">
                Мои задачи
              </h2>
              <p className="mt-1 text-small text-muted">Что вы ведёте или поставили, и что видели: задачи ваших команд, где вы комментировали, где вас упомянули и за которыми следите.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Segmented
                label="Показать"
                value={filter}
                onChange={setFilter}
                className="max-sm:[&_.sv-segment__item]:min-h-11"
                options={[
                  { value: "nogoal", label: "Без цели", count: counts.nogoal },
                  { value: "all", label: "Все", count: counts.all },
                ]}
              />
              <div className="relative min-w-0 flex-1 basis-48 sm:max-w-xs">
                <TextInput id="link-search" label="Поиск задачи" hideLabel placeholder="Номер или слова из названия" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              </div>
            </div>
            {selectedTasks.length ? (
              <div className="flex flex-wrap items-center gap-2 rounded-control-lg bg-blue-soft px-3 py-2" role="group" aria-label="Отмеченные задачи" data-testid="link-selection">
                <span className="text-small font-medium text-ink">
                  Отмечено {selectedTasks.length} {plural(selectedTasks.length, "задача", "задачи", "задач")}
                </span>
                <Button size="sm" className="max-sm:h-11" onClick={() => setPicker(selectedTasks.map((t) => t.number))}>
                  Привязать к цели…
                </Button>
                {selectedTasks.some((t) => goalOf(t) !== null) ? (
                  <Button size="sm" variant="secondary" className="max-sm:h-11" onClick={() => void commit(selectedTasks.map((t) => t.number), null)}>
                    Снять цель
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" className="max-sm:h-11" onClick={() => setSelected(new Set())}>
                  Снять отметку
                </Button>
              </div>
            ) : null}

            {!counts.all ? (
              <p className="sv-card sv-card--soft px-4 py-3 text-small text-muted">Задач, которые вы ведёте или видели, на {quarterName} нет.</p>
            ) : !shown.open.length && !shown.closed.length ? (
              <p className="sv-card sv-card--soft px-4 py-3 text-small text-muted" data-testid="link-tasks-empty">
                {query.trim() ? "Под поиск ничего не подходит: проверьте номер или слова." : filter === "nogoal" ? "Все ваши задачи уже работают на цели. Нажмите «Все», чтобы перевязать задачу." : "Задач нет."}
              </p>
            ) : (
              <>
                {shown.open.length ? (
                  <div className="flex flex-col gap-1">
                    <h3 className="text-small font-semibold text-muted">Открытые: {shown.open.length}</h3>
                    <ul className="m-0 flex list-none flex-col p-0" data-testid="link-open">
                      {openShown.map(row)}
                    </ul>
                    {shown.open.length > openShown.length ? (
                      <Button size="sm" variant="secondary" className="self-start max-sm:h-11" onClick={() => setLimit((l) => ({ ...l, open: l.open + PAGE.open }))}>
                        Показать ещё {Math.min(PAGE.open, shown.open.length - openShown.length)}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {shown.closed.length ? (
                  <div className="flex flex-col gap-1">
                    <h3 className="text-small font-semibold text-muted">
                      Закрыты в {quarterName}: {shown.closed.length}
                    </h3>
                    <ul className="m-0 flex list-none flex-col p-0" data-testid="link-closed">
                      {closedShown.map(row)}
                    </ul>
                    {shown.closed.length > closedShown.length ? (
                      <Button size="sm" variant="secondary" className="self-start max-sm:h-11" onClick={() => setLimit((l) => ({ ...l, closed: l.closed + PAGE.closed }))}>
                        Показать ещё {Math.min(PAGE.closed, shown.closed.length - closedShown.length)}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
            {board.truncated ? <p className="text-caption text-muted">Показаны не все задачи: остальные найдутся в разделе «Задачи».</p> : null}
          </section>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggedTasks.length ? (
          <div className="sv-card max-w-72 bg-surface px-3 py-2 text-small font-medium text-ink shadow-medium">
            {draggedTasks.length > 1 ? `Отмеченные задачи: ${draggedTasks.length}` : `${draggedTasks[0]!.number}. ${draggedTasks[0]!.title}`}
          </div>
        ) : null}
      </DragOverlay>

      {pickerTasks.length ? (
        <GoalPicker
          tasks={pickerTasks}
          goals={board.goals}
          goalOf={goalOf}
          onClose={() => setPicker(null)}
          onChoose={(goalId) => {
            const numbers = pickerTasks.map((t) => t.number);
            setPicker(null);
            void commit(numbers, goalId);
          }}
        />
      ) : null}
    </DndContext>
  );
}

/** Зона «Без цели»: задача, отпущенная сюда, теряет цель */
function NoneZone({ dragging, enabled }: { dragging: boolean; enabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "none", data: { kind: "none", order: 0 } satisfies DropData, disabled: dragging && !enabled });
  return (
    <div
      ref={setNodeRef}
      data-testid="link-none"
      className={cn("rounded-panel border border-dashed border-border-strong px-4 py-3 text-small text-muted transition-colors", isOver && "bg-blue-soft text-ink ring-2 ring-blue", dragging && !enabled && "opacity-50")}
    >
      <span className="font-semibold text-ink">Без цели.</span> Перетащите сюда задачу, чтобы снять с неё цель
    </div>
  );
}

function GoalCard({
  goal,
  order,
  tasks,
  open,
  onToggle,
  dragging,
  fits,
  interactive,
  onUnlink,
}: {
  goal: LinkGoal;
  order: number;
  tasks: LinkTask[];
  open: boolean;
  onToggle: () => void;
  dragging: boolean;
  /** Цель подходит хотя бы одной перетаскиваемой задаче */
  fits: boolean;
  interactive: boolean;
  onUnlink: (number: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `goal:${goal.id}`, data: { kind: "goal", id: goal.id, order } satisfies DropData, disabled: dragging && !fits });
  const name = goalName(goal);
  const context = [goal.owner ?? "владелец не задан", goal.personal ? "личная цель" : null, goal.result].filter(Boolean).join(", ");
  const pct = progressLabel(goal.numeric);
  return (
    <li>
      <section
        ref={setNodeRef}
        aria-labelledby={`link-goal-title-${goal.id}`}
        data-testid={`link-goal-${goal.id}`}
        className={cn("sv-card bg-surface p-3 transition-shadow", isOver && "ring-2 ring-blue", dragging && !fits && "opacity-50")}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 id={`link-goal-title-${goal.id}`} className="break-words text-small font-semibold text-ink">
              {name}
            </h4>
            <p className="mt-0.5 text-caption text-muted">{context}</p>
          </div>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`link-goal-tasks-${goal.id}`}
            aria-label={`Задачи ${tasks.length}, цель «${name}»`}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-control px-2 text-small font-medium text-blue-700 hover:bg-field sm:min-h-9"
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            <span aria-hidden="true">Задачи {tasks.length}</span>
          </button>
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
          <span>{goal.progress.total ? `закрыто ${goal.progress.done} из ${goal.progress.total}` : "задач пока нет"}</span>
          {goal.fact ? (
            <span>
              факт {goal.fact}
              {goal.target ? ` из ${goal.target}` : ""}
              {pct ? `, ${pct}` : ""}
            </span>
          ) : goal.target ? (
            <span>целевое {goal.target}</span>
          ) : null}
        </p>
        {dragging ? (
          <p className={cn("mt-2 text-caption font-medium", fits ? "text-blue-700" : "text-muted")} aria-hidden="true">
            {fits ? "Отпустите здесь, чтобы привязать" : "Не подходит этой задаче"}
          </p>
        ) : null}
        {open ? (
          <div id={`link-goal-tasks-${goal.id}`} className="mt-2 border-t border-line pt-2">
            {tasks.length ? (
              <ul className="m-0 flex list-none flex-col p-0" aria-label={`Задачи цели «${name}»`}>
                {tasks.map((t) => (
                  <LinkedRow key={t.number} task={t} interactive={interactive} onUnlink={() => onUnlink(t.number)} />
                ))}
              </ul>
            ) : (
              <p className="text-caption text-muted">Задач пока нет: перетащите сюда задачу или нажмите «К цели» у задачи.</p>
            )}
          </div>
        ) : null}
      </section>
    </li>
  );
}

/** Задача в раскрытой карточке цели: её можно перетащить на другую цель или в «Без цели» и отвязать кнопкой */
function LinkedRow({ task, interactive, onUnlink }: { task: LinkTask; interactive: boolean; onUnlink: () => void }) {
  const draggable = interactive && task.canLink;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `g:${task.number}`, data: { number: task.number, from: "goal" } satisfies DragData, disabled: !draggable });
  return (
    <li className={cn("flex items-center gap-1", isDragging && "opacity-40")} data-testid={`link-goal-task-${task.number}`}>
      <div
        ref={setNodeRef}
        {...(draggable ? { ...attributes, ...listeners, "aria-roledescription": "перетаскиваемая задача", "aria-label": `Задача ${task.number}: ${task.title}` } : {})}
        data-testid={`drag-goal-task-${task.number}`}
        className={cn("flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-control px-1 py-1.5 sm:min-h-9", draggable && dragArea, draggable && "hover:bg-field")}
      >
        {draggable ? <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-icon" aria-hidden="true" /> : null}
        <span className="min-w-0">
          <span className={cn("block break-words text-small text-ink", task.closed && "text-muted")}>
            <span className="mr-1.5 tabular-nums text-muted">{task.number}</span>
            {task.title}
          </span>
          <span className="block text-caption text-muted">
            {statusLabel(task.status)}, {task.owner}
          </span>
        </span>
      </div>
      {draggable ? (
        <button type="button" onClick={onUnlink} className="sv-icon-btn sv-icon-btn--sm shrink-0 max-sm:h-11 max-sm:w-11" aria-label={`Отвязать задачу ${task.number} от цели`}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </li>
  );
}

function TaskRow({
  task,
  goal,
  today,
  interactive,
  selected,
  pending,
  onSelect,
  onPick,
}: {
  task: LinkTask;
  goal: { code: string | null; title: string } | null;
  today: IsoDate;
  interactive: boolean;
  selected: boolean;
  pending: boolean;
  onSelect: () => void;
  onPick: () => void;
}) {
  const draggable = interactive && task.canLink;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `t:${task.number}`, data: { number: task.number, from: "list" } satisfies DragData, disabled: !draggable });
  const overdue = (task.status === "in-progress" || task.status === "clarify") && diffDays(task.due, today) > 0;
  const when = task.closed ? (task.closedAt ? `закрыта ${formatShort(task.closedAt)}` : "закрыта") : `до ${formatShort(task.due)}`;
  const reason = task.reasons[0] ? REASON_LABEL[task.reasons[0]] : null;
  return (
    <li className={cn("flex items-start gap-1 rounded-control py-1 pr-1", selected ? "bg-field ring-1 ring-inset ring-blue" : "hover:bg-field", isDragging && "opacity-40")} data-testid={`link-task-${task.number}`}>
      {draggable ? (
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-9 sm:w-9">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Отметить задачу ${task.number}`} className="h-4 w-4 accent-blue-700" />
        </label>
      ) : (
        <span className="w-11 shrink-0 sm:w-9" aria-hidden="true" />
      )}
      <div
        ref={setNodeRef}
        {...(draggable
          ? { ...attributes, ...listeners, "aria-roledescription": "перетаскиваемая задача", "aria-label": `Задача ${task.number}: ${task.title}. ${statusLabel(task.status)}, ${overdue ? "просрочена" : when}. ${goal ? `Цель: ${goalName(goal)}` : "Без цели"}` }
          : {})}
        data-testid={`drag-task-${task.number}`}
        className={cn("flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-control py-1.5 sm:min-h-9", draggable && dragArea)}
      >
        {draggable ? <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-icon" aria-hidden="true" /> : null}
        <span className="min-w-0 flex-1">
          <span className={cn("block break-words text-small text-ink", task.closed && "text-muted")}>
            <span className="mr-1.5 tabular-nums text-muted">{task.number}</span>
            {task.title}
          </span>
          <span className="mt-0.5 block text-caption text-muted">
            {statusLabel(task.status)}, <span className={cn(overdue && "font-semibold text-danger-ink")}>{overdue ? `просрочена, срок был ${formatShort(task.due)}` : when}</span>
            {reason ? `, ${reason}` : ""}
            {!task.canLink && interactive ? ", цель меняют ответственный и руководитель" : ""}
          </span>
          {goal ? (
            <span className={cn("sv-badge sv-badge--info mt-1 inline-flex max-w-full items-center gap-1", pending && "opacity-60")}>
              <Target className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{goalName(goal)}</span>
            </span>
          ) : null}
        </span>
      </div>
      {draggable ? (
        <Button variant="secondary" size="sm" className="mt-1 shrink-0 gap-1 max-sm:h-11 sm:mt-0" onClick={onPick} aria-label={`К цели: задача ${task.number}`}>
          <Target className="h-4 w-4" aria-hidden="true" />
          <span aria-hidden="true">К цели</span>
        </Button>
      ) : null}
    </li>
  );
}

/** Выбор цели без перетаскивания: «К цели» у задачи и «Привязать к цели» для отмеченных */
function GoalPicker({
  tasks,
  goals,
  goalOf,
  onChoose,
  onClose,
}: {
  tasks: LinkTask[];
  goals: LinkGoal[];
  goalOf: GoalOf;
  onChoose: (goalId: string | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.toLowerCase().replace(/ё/g, "е").trim();
  const found = q ? goals.filter((g) => `${g.code ?? ""} ${g.title} ${g.owner ?? ""} ${g.team.name}`.toLowerCase().replace(/ё/g, "е").includes(q)) : goals;
  const groups = groupGoals(found);
  const hasGoal = tasks.some((t) => goalOf(t) !== null);
  const one = tasks.length === 1;
  const option = "flex min-h-11 w-full flex-col items-start justify-center rounded-control px-3 py-2 text-left hover:bg-field disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent";
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={one ? `Задача ${tasks[0]!.number}: к цели` : `Отмеченные задачи: ${tasks.length}, к цели`}
      description="Подходят цели команды задачи, команд выше и личные цели её людей на квартал срока"
    >
      <div className="flex flex-col gap-3">
        {goals.length > 6 ? <TextInput id="link-picker-search" label="Найти цель" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название, код или владелец" autoComplete="off" /> : null}
        <ul className="m-0 flex max-h-[60dvh] list-none flex-col gap-1 overflow-y-auto p-0" aria-label="Цели" data-testid="link-picker">
          {hasGoal ? (
            <li>
              <button type="button" className={option} onClick={() => onChoose(null)}>
                <span className="text-small font-medium text-ink">Без цели</span>
                <span className="text-caption text-muted">{one ? "снять цель с задачи" : "снять цель с отмеченных задач"}</span>
              </button>
            </li>
          ) : null}
          {groups.map((g) => (
            <li key={g.key}>
              <p className="px-3 pb-1 pt-2 text-caption font-semibold text-muted">{g.label}</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {g.goals.map((goal) => {
                  const fit = tasks.filter((t) => goalFitsTask(goal, t)).length;
                  const here = tasks.every((t) => goalOf(t) === goal.id);
                  const note = here ? (one ? "задача уже здесь" : "задачи уже здесь") : !fit ? "не подходит: цель другой команды или квартала" : fit < tasks.length ? `подходит ${fit} из ${tasks.length}` : [goal.owner, goal.personal ? "личная цель" : null].filter(Boolean).join(", ");
                  return (
                    <li key={goal.id}>
                      <button type="button" className={option} disabled={!fit || here} onClick={() => onChoose(goal.id)} data-testid={`link-pick-${goal.id}`}>
                        <span className="break-words text-small font-medium text-ink">{goalName(goal)}</span>
                        {note ? <span className="text-caption text-muted">{note}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!groups.length ? <li className="px-3 py-2 text-small text-muted">{goals.length ? "Такой цели нет: проверьте написание" : "Целей на квартал пока нет"}</li> : null}
        </ul>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  );
}
