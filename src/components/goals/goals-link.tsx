"use client";

// Связать задачи с целями (этап 65). Задача Арама 22.10: сотрудник перетаскивает к каждой цели задачи, которыми
// занимался или которые видел. Слева (на телефоне сверху) цели человека, его команд и команд ниже на квартал, справа
// «Мои задачи». На ноутбуке колонка целей закреплена и прокручивается сама: колесом прямо во время перетаскивания
// (карточка задачи под курсором не перехватывает колесо) и сама, когда курсор у её верхнего или нижнего края.
// Мышью тянут строку задачи, пальцем долгим нажатием, с клавиатуры: пробел берёт задачу, стрелки выбирают цель,
// пробел отпускает, Escape отменяет. Без перетаскивания то же кнопкой «К цели» у задачи и «Привязать к цели» для
// отмеченных. Правка видна сразу, при ошибке возвращается; в тосте «Отменить». Задачи, которые человек только видит,
// лежат отдельно в свёрнутом блоке «Только посмотреть» лёгкими строками без перетаскивания.
//
// Скорость: строки и карточки запомнены (memo) и получают постоянные обработчики, поэтому поиск, отметка и начало
// перетаскивания перерисовывают только то, что поменялось.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical, Search, Target, X } from "lucide-react";
import type { GoalLinkBoard } from "@/lib/goals/link-board";
import {
  REASON_LABEL,
  WHICH_GOALS,
  WHO_LINKS,
  dragSet,
  edgeStep,
  failedText,
  filterCounts,
  focusAfter,
  goalFitsTask,
  goalName,
  groupGoals,
  linkToast,
  listTasks,
  nothingToMove,
  planLink,
  stepTarget,
  tallyText,
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
/** Строк в блоке «Только посмотреть» за раз */
const VIEW_PAGE = 30;
const TASKS_TITLE = "link-tasks-title";

type DragData = { number: number; from: "list" | "goal" };
type DropData = { kind: "goal"; id: string; order: number } | { kind: "none"; order: number };
/** Правка, которая ещё не пришла с сервера: pending, пока сервер не ответил. seq отличает повторную правку той же задачи */
type Override = { goal: string | null; pending: boolean; seq: number };
type Finder = () => HTMLElement | null;
/** Откуда правка: перетаскивание, окно «К цели», крестик в карточке цели, кнопки отмеченных */
type Source = { kind: "drag" | "picker" | "bar" } | { kind: "card"; focus: Finder };
type GoalLabel = { code: string | null; title: string };

const statusLabel = (code: LinkTask["status"]) => STATUSES.find((s) => s.code === code)?.label ?? "";
const rowFinder = (n: number): Finder => () => document.querySelector<HTMLElement>(`[data-testid="drag-task-${n}"]`);
const titleFinder: Finder = () => document.getElementById(TASKS_TITLE);

/** Подпись строки задачи: статус, срок или день закрытия, просрочка, почему задача в списке */
function caption(task: LinkTask, today: IsoDate) {
  const overdue = (task.status === "in-progress" || task.status === "clarify") && diffDays(task.due, today) > 0;
  const when = task.closed ? (task.closedAt ? `закрыта ${formatShort(task.closedAt)}` : "закрыта") : `до ${formatShort(task.due)}`;
  const reason = task.reasons[0] ? REASON_LABEL[task.reasons[0]] : null;
  return { overdue, when, reason };
}

/** Где курсор или палец сейчас: точка начала перетаскивания плюс сдвиг. С клавиатуры точки нет */
function pointerOf(event: Event | null, delta: { x: number; y: number }): { x: number; y: number } | null {
  if (!event) return null;
  if (typeof TouchEvent !== "undefined" && event instanceof TouchEvent) {
    const t = event.touches[0] ?? event.changedTouches[0];
    return t ? { x: t.clientX + delta.x, y: t.clientY + delta.y } : null;
  }
  if (event instanceof MouseEvent) return { x: event.clientX + delta.x, y: event.clientY + delta.y };
  return null;
}

/**
 * Колонка целей на ноутбуке закреплена и прокручивается сама. Пока задачу тянут, после любой прокрутки (страницы или
 * колонки) места целей перемеряются: иначе dnd-kit считал бы закреплённую колонку уехавшей вместе со страницей
 */
function RemeasureOnScroll() {
  const { active, measureDroppableContainers } = useDndContext();
  const dragging = active !== null;
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measureDroppableContainers([]));
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [dragging, measureDroppableContainers]);
  return null;
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
  const [viewOpen, setViewOpen] = useState(false);
  const [viewLimit, setViewLimit] = useState(VIEW_PAGE);
  // Перерисовка после шага стрелкой: цель «над которой» задача берётся из keyTarget, координаты не меняются
  const [, setKeyStep] = useState(0);
  const seq = useRef(0);
  // Куда перевести фокус после перерисовки: строка задачи пропала из списка «Без цели», крестик в карточке цели
  const pendingFocus = useRef<Finder | null>(null);
  // Окно «К цели»: откуда открыли и куда вернуть фокус, если строки с кнопкой больше нет
  const pickerReturn = useRef<Finder | null>(null);
  const pickerFocus = useRef<Finder | null>(null);
  // Цель, к которой задачу подвели стрелками. С клавиатуры «над чем задача» решает выбор стрелкой, а не геометрия
  const keyTarget = useRef<UniqueIdentifier | null>(null);
  // Закреплённая колонка целей и где курсор, пока задачу тянут: для автопрокрутки у краёв колонки
  const columnRef = useRef<HTMLElement | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Свежие данные с сервера: правки, на которые сервер уже ответил, в них есть. Ждущие ответа правки остаются
  const [seen, setSeen] = useState(board);
  if (seen !== board) {
    setSeen(board);
    setOverrides((m) => new Map([...m].filter(([, o]) => o.pending)));
  }
  useEffect(() => {
    const find = pendingFocus.current;
    if (!find) return;
    pendingFocus.current = null;
    find()?.focus();
  });

  const isDragging = dragging !== null;
  // Автопрокрутка колонки целей: курсор у верхнего или нижнего края колонки крутит её, пока задачу держат
  useEffect(() => {
    if (!isDragging) return;
    let frame = 0;
    const tick = () => {
      const col = columnRef.current;
      const p = pointer.current;
      if (col && p && col.scrollHeight > col.clientHeight) {
        // Края считаются по видимой части колонки: её низ может уходить за край окна, пока страницу не прокрутили
        const r = col.getBoundingClientRect();
        const step = p.x >= r.left && p.x <= r.right ? edgeStep(p.y, Math.max(r.top, 0), Math.min(r.bottom, window.innerHeight)) : 0;
        if (step) col.scrollTop += step;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      pointer.current = null;
    };
  }, [isDragging]);

  /** Показать цель в закреплённой колонке, не трогая прокрутку страницы. На телефоне колонка не своя: ближайшая прокрутка */
  const revealInColumn = (node: HTMLElement | null) => {
    if (!node) return;
    const col = columnRef.current;
    if (col && col.scrollHeight > col.clientHeight && col.contains(node)) {
      const r = node.getBoundingClientRect();
      const c = col.getBoundingClientRect();
      if (r.top < c.top + 8) col.scrollTop -= c.top + 8 - r.top;
      else if (r.bottom > c.bottom - 8) col.scrollTop += r.bottom - (c.bottom - 8);
      return;
    }
    node.scrollIntoView({ block: "nearest" });
  };

  /** Мышь и палец: цель под курсором. Клавиатура: цель, выбранная стрелками */
  const collision: CollisionDetection = (args) => {
    if (args.pointerCoordinates) return pointerWithin(args);
    const id = keyTarget.current;
    const hit = id === null ? undefined : args.droppableContainers.find((c) => c.id === id && !c.disabled);
    return hit ? [{ id: hit.id, data: { droppableContainer: hit, value: 0 } }] : [];
  };
  /**
   * Стрелки ведут задачу с цели на цель по порядку на экране. Координаты карточки задачи не меняются: иначе dnd-kit
   * прокручивал бы страницу к ней. Цель подсвечивается по выбору стрелкой, колонка прокручивается к цели сама
   */
  const stepCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
    const forward = event.code === "ArrowDown" || event.code === "ArrowRight";
    const back = event.code === "ArrowUp" || event.code === "ArrowLeft";
    if (!forward && !back) return undefined;
    event.preventDefault();
    const { droppableRects, droppableContainers } = context;
    const order = (data: unknown) => (data as DropData | undefined)?.order ?? 0;
    const targets = droppableContainers
      .getEnabled()
      .filter((c) => !c.disabled && droppableRects.has(c.id))
      .sort((a, b) => order(a.data.current) - order(b.data.current));
    const next = stepTarget(targets.length, targets.findIndex((t) => t.id === keyTarget.current), forward);
    if (next < 0) return undefined;
    const target = targets[next]!;
    keyTarget.current = target.id;
    revealInColumn(target.node.current);
    setKeyStep((n) => n + 1);
    return currentCoordinates;
  };
  // Мышь и палец отдельно: пальцем перетаскивание начинается долгим нажатием, свайп прокручивает страницу
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: stepCoordinates }),
  );

  const byNumber = useMemo(() => new Map(board.tasks.map((t) => [t.number, t])), [board.tasks]);
  const goalById = useMemo(() => new Map(board.goals.map((g) => [g.id, g])), [board.goals]);
  const goalOf = useCallback<GoalOf>(
    (t) => {
      const o = overrides.get(t.number);
      return o ? o.goal : (t.goal?.id ?? null);
    },
    [overrides],
  );
  /** Цель задачи для подписи: цель экрана или цель задачи с сервера (другой квартал, чужая команда). Объекты постоянные */
  const goalShown = (t: LinkTask): GoalLabel | null => {
    const id = goalOf(t);
    if (!id) return null;
    return goalById.get(id) ?? (t.goal?.id === id ? t.goal : null);
  };

  const counts = useMemo(() => filterCounts(board.tasks, goalOf), [board.tasks, goalOf]);
  const shown = useMemo(() => listTasks(board.tasks, filter, query, goalOf), [board.tasks, filter, query, goalOf]);
  const linked = useMemo(() => tasksByGoal(board.tasks, goalOf), [board.tasks, goalOf]);
  const groups = useMemo(() => groupGoals(board.goals), [board.goals]);
  const orderOf = useMemo(() => new Map(board.goals.map((g, i) => [g.id, i + 1])), [board.goals]);
  const draggedTasks = (dragging ?? []).map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);
  const openShown = shown.open.slice(0, limit.open);
  const closedShown = shown.closed.slice(0, limit.closed);
  // Видимые строки, которые можно привязать: по ним считаются отмеченные и фокус после привязки
  const visible = [...openShown, ...closedShown].map((t) => t.number);
  const selectedVisible = visible.filter((n) => selected.has(n));
  const hiddenSelected = [...selected].filter((n) => !visible.includes(n)).length;

  const toggle = useCallback(
    (n: number) =>
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        return next;
      }),
    [],
  );
  const toggleGoal = useCallback(
    (id: string) =>
      setOpen((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  /** returnTo: кнопка, с которой открыли окно; ищется заново после закрытия, строку могли перерисовать */
  const openPicker = useCallback((numbers: number[], returnTo: Finder) => {
    pickerReturn.current = returnTo;
    pickerFocus.current = null;
    setPicker(numbers);
  }, []);
  const pickOne = useCallback((n: number) => openPicker([n], () => document.querySelector<HTMLElement>(`[data-testid="link-task-${n}"] [aria-label="К цели: задача ${n}"]`)), [openPicker]);

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
  const commit = async (numbers: number[], goalId: string | null, source: Source) => {
    const goal = goalId ? (goalById.get(goalId) ?? null) : null;
    const list = numbers.map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);
    const plan = planLink(list, goal, goalOf);
    // Двигать нечего. Задачу отпустили на её же цель: молча, это не ошибка. Не подходит или нет права: объясняем
    if (!plan.move.length) {
      if (plan.unfit.length || plan.locked.length) notify(nothingToMove(plan, goal), "error");
      return;
    }
    // Фокус: строки пропадут из «Без цели», если их привязали. Тогда на следующую строку или на заголовок списка
    const removed = filter === "nogoal" && goalId !== null ? plan.move.filter((n) => visible.includes(n)) : [];
    const after = removed.length ? focusAfter(visible, removed) : undefined;
    const finder: Finder | null = after === undefined ? null : after === null ? titleFinder : rowFinder(after);
    if (source.kind === "card") pendingFocus.current = source.focus;
    else if (source.kind === "bar") pendingFocus.current = titleFinder;
    else if (source.kind === "picker") pickerFocus.current = finder && removed.length ? finder : null;
    else if (finder) {
      const active = document.activeElement;
      const row = active instanceof HTMLElement ? active.closest<HTMLElement>("[data-link-row]") : null;
      if (row && removed.includes(Number(row.dataset.linkRow))) pendingFocus.current = finder;
    }

    const before = new Map(plan.move.map((n) => [n, goalOf(byNumber.get(n)!)]));
    const wasSelected = plan.move.filter((n) => selected.has(n));
    const mine = ++seq.current;
    setOverrides((m) => {
      const next = new Map(m);
      for (const n of plan.move) next.set(n, { goal: goalId, pending: true, seq: mine });
      return next;
    });
    // Отметка снимается только с задач, которые сдвинулись или уже стояли у этой цели
    setSelected((s) => new Set([...s].filter((n) => !plan.move.includes(n) && !plan.same.includes(n))));
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
    // Не прошедшие задачи возвращаются в выбор: их можно привязать ещё раз
    const back = wasSelected.filter((n) => failed.has(n));
    if (back.length) setSelected((s) => new Set([...s, ...back]));
    if (!r.ok) {
      notify(r.error, "error");
      return;
    }
    const done = r.value.done;
    const toast = linkToast({ done: done.map((d) => d.number), failed: r.value.failed, unfit: plan.unfit, locked: plan.locked }, goal);
    const tokens = done.filter((d) => d.undo).map((d) => ({ number: d.number, token: d.undo!, goal: before.get(d.number) ?? null }));
    if (tokens.length) notifyUndo(toast.text, () => void revert(tokens), toast.error ? "error" : undefined);
    else notify(toast.text, toast.error ? "error" : undefined);
    router.refresh();
  };
  // Крестик в карточке цели получает постоянный обработчик: карточки не перерисовываются от каждой правки списка
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  const unlink = useCallback((n: number, focus: Finder) => void commitRef.current([n], null, { kind: "card", focus }), []);

  const dragNumbers = (data: DragData | undefined) => (data ? dragSet(data.number, data.from === "list", selectedVisible) : []);
  const onDragStart = (e: DragStartEvent) => {
    keyTarget.current = null;
    pointer.current = null;
    setDragging(dragNumbers(e.active.data.current as DragData | undefined));
  };
  const onDragMove = (e: DragMoveEvent) => {
    pointer.current = pointerOf(e.activatorEvent, e.delta);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const numbers = dragNumbers(e.active.data.current as DragData | undefined);
    keyTarget.current = null;
    setDragging(null);
    const target = e.over?.data.current as DropData | undefined;
    if (!target || !numbers.length) return;
    void commit(numbers, target.kind === "goal" ? target.id : null, { kind: "drag" });
  };

  const subjectOf = (id: UniqueIdentifier) => {
    const n = Number(String(id).slice(2));
    const numbers = dragNumbers({ number: n, from: String(id).startsWith("t:") ? "list" : "goal" });
    if (numbers.length > 1) return `отмеченные задачи, ${numbers.length}`;
    const t = byNumber.get(n);
    return t ? `задача ${t.number}, «${t.title}»` : `задача ${n}`;
  };
  const targetOf = (id: UniqueIdentifier) => {
    if (id === "none") return "без цели, цель снимется";
    const g = goalById.get(String(id).slice(5));
    if (!g) return "цель";
    // Задачу взяли из карточки её же цели: отпускание здесь ничего не меняет
    const already = draggedTasks.length > 0 && draggedTasks.every((t) => goalOf(t) === g.id);
    return already ? `цель «${goalName(g)}», ${draggedTasks.length > 1 ? "задачи уже у неё" : "задача уже у неё"}` : `цель «${goalName(g)}»`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Взяли: ${subjectOf(active.id)}. Стрелками выберите цель, пробел или Enter привязывает, Escape отменяет`,
    onDragOver: ({ over }) => (over ? `Над: ${targetOf(over.id)}` : "Вне целей"),
    onDragEnd: ({ over }) => (over ? `Отпущено на: ${targetOf(over.id)}` : "Отпущено вне целей, связь не изменилась"),
    onDragCancel: () => "Перетаскивание отменено, связь не изменилась",
  };

  // Задача могла пропасть после обновления (её перенесли в другую команду): окно выбора без задач не открывается
  const pickerTasks = (picker ?? []).map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);
  const selectedTasks = selectedVisible.map((n) => byNumber.get(n)).filter((t): t is LinkTask => !!t);
  const quarterName = quarterLabel(board.quarter);

  const row = (t: LinkTask) => (
    <TaskRow
      key={t.number}
      task={t}
      goal={goalShown(t)}
      today={today}
      interactive={interactive}
      selected={selected.has(t.number)}
      pending={!!overrides.get(t.number)?.pending}
      onSelect={toggle}
      onPick={pickOne}
    />
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
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
      <RemeasureOnScroll />
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
        {board.observer ? <p className="sv-alert sv-alert--info">Наблюдатель только смотрит: связи задач с целями меняют {WHO_LINKS}.</p> : null}
        {board.limited ? <p className="sv-alert sv-alert--info">Вход по общему логину: цель можно сменить только у задач, которые вы ведёте, поставили или где вы соисполнитель. Задачи команды привязывают, войдя по своей ссылке.</p> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <section
            ref={columnRef}
            aria-labelledby="link-goals-title"
            data-testid="link-goals"
            className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:-m-1 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:p-1"
          >
            <div>
              <h2 id="link-goals-title" className="text-title font-semibold text-ink">
                Цели на {quarterName}
              </h2>
              <p className="mt-1 text-small text-muted">Перетащите задачу на цель. Колонку целей можно крутить колесом прямо во время перетаскивания или подвести задачу к её краю. У цели кнопка «Задачи»: там видно, что на неё работает, и задачу можно отвязать.</p>
            </div>
            {interactive ? <NoneZone dragging={isDragging} enabled={draggedTasks.some((t) => goalOf(t) !== null)} /> : null}
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
                        tasks={linked.get(goal.id) ?? NO_TASKS}
                        open={open.has(goal.id)}
                        onToggle={toggleGoal}
                        dragging={isDragging}
                        fits={draggedTasks.length > 0 && draggedTasks.some((t) => goalFitsTask(goal, t))}
                        already={draggedTasks.length > 0 && draggedTasks.every((t) => goalOf(t) === goal.id)}
                        interactive={interactive}
                        onUnlink={unlink}
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

          <section id="link-tasks" aria-labelledby={TASKS_TITLE} className="flex min-w-0 scroll-mt-20 flex-col gap-3">
            <div>
              <h2 id={TASKS_TITLE} tabIndex={-1} className="text-title font-semibold text-ink">
                Мои задачи
              </h2>
              <p className="mt-1 text-small text-muted">Что вы ведёте, поставили или где вы соисполнитель, и задачи ваших команд и команд ниже. То, что вы только видели и привязать не можете, ниже в блоке «Только посмотреть».</p>
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
            {selected.size ? (
              <div className="flex flex-wrap items-center gap-2 rounded-control-lg bg-blue-soft px-3 py-2" role="group" aria-label="Отмеченные задачи" data-testid="link-selection">
                <span className="text-small font-medium text-ink">
                  {selectedTasks.length ? `Отмечено ${selectedTasks.length} ${plural(selectedTasks.length, "задача", "задачи", "задач")}` : "Отмеченные задачи не видны"}
                  {hiddenSelected ? (
                    <span className="block text-caption font-normal text-muted">
                      {selectedTasks.length ? "Ещё" : "Все"} {hiddenSelected} {plural(hiddenSelected, "скрыта", "скрыты", "скрыты")} поиском или фильтром: их не тронем
                    </span>
                  ) : null}
                </span>
                <Button size="sm" className="max-sm:h-11" disabled={!selectedTasks.length} onClick={() => openPicker(selectedTasks.map((t) => t.number), () => document.querySelector<HTMLElement>('[data-testid="link-selection"] button'))}>
                  Привязать к цели…
                </Button>
                {selectedTasks.some((t) => goalOf(t) !== null) ? (
                  <Button size="sm" variant="secondary" className="max-sm:h-11" onClick={() => void commit(selectedTasks.map((t) => t.number), null, { kind: "bar" })}>
                    Снять цель
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="max-sm:h-11"
                  onClick={() => {
                    // Плашка пропадёт вместе с кнопкой: фокус на заголовок списка
                    pendingFocus.current = titleFinder;
                    setSelected(new Set());
                  }}
                >
                  Снять отметку
                </Button>
              </div>
            ) : null}

            {!board.tasks.some((t) => t.mine) ? (
              <p className="sv-card sv-card--soft px-4 py-3 text-small text-muted">Задач, которые вы ведёте или видели, на {quarterName} нет.</p>
            ) : !shown.open.length && !shown.closed.length ? (
              <p className="sv-card sv-card--soft px-4 py-3 text-small text-muted" data-testid="link-tasks-empty">
                {query.trim()
                  ? "Под поиск ничего не подходит: проверьте номер или слова."
                  : !counts.all
                    ? `Задач, которые вы можете привязать, нет: цель меняют ${WHO_LINKS}.`
                    : filter === "nogoal"
                      ? "Все ваши задачи уже работают на цели. Нажмите «Все», чтобы перевязать задачу."
                      : "Задач нет."}
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
            {shown.viewOnly.length ? (
              // Свёрнутый блок: строки появляются только в открытом блоке, лёгкие, без перетаскивания, частями
              <details className="sv-collapse sv-card sv-card--soft" data-testid="link-view-only" open={viewOpen} onToggle={(e) => setViewOpen(e.currentTarget.open)}>
                <summary className="sv-collapse__head">
                  <h3 className="sv-collapse__title" id="link-view-only-title">
                    Только посмотреть: {shown.viewOnly.length}
                  </h3>
                  <span className="sv-collapse__hint">Цель этих задач меняют {WHO_LINKS}</span>
                  <ChevronDown className="sv-collapse__chev" strokeWidth={1.75} aria-hidden="true" />
                </summary>
                {viewOpen ? (
                  <div className="sv-collapse__body flex flex-col gap-2">
                    <ul className="m-0 flex list-none flex-col p-0" aria-labelledby="link-view-only-title">
                      {shown.viewOnly.slice(0, viewLimit).map((t) => (
                        <ViewRow key={t.number} task={t} goal={goalShown(t)} today={today} />
                      ))}
                    </ul>
                    {shown.viewOnly.length > viewLimit ? (
                      <Button size="sm" variant="secondary" className="self-start max-sm:h-11" onClick={() => setViewLimit((l) => l + VIEW_PAGE)}>
                        Показать ещё {Math.min(VIEW_PAGE, shown.viewOnly.length - viewLimit)}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </details>
            ) : null}
            {board.truncated ? <p className="text-caption text-muted">Показаны не все задачи команд: остальные найдутся в разделе «Задачи». Свои задачи здесь все.</p> : null}
          </section>
        </div>
      </div>

      {/* Карточка под курсором не ловит колесо мыши: колонка целей крутится колесом прямо во время перетаскивания */}
      <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
        {draggedTasks.length ? (
          <div className="sv-card max-w-72 bg-surface px-3 py-2 text-small font-medium text-ink shadow-medium" data-testid="link-drag-overlay">
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
            void commit(numbers, goalId, { kind: "picker" });
          }}
          onCloseAutoFocus={(e) => {
            // Строка с кнопкой «К цели» могла пропасть из «Без цели»: тогда на следующую строку или на заголовок
            e.preventDefault();
            const find = pickerFocus.current;
            pickerFocus.current = null;
            const back = pickerReturn.current;
            pickerReturn.current = null;
            (find?.() ?? back?.() ?? titleFinder())?.focus();
          }}
        />
      ) : null}
    </DndContext>
  );
}

/** Пустой список задач цели: один на всех, чтобы карточка без задач не перерисовывалась */
const NO_TASKS: LinkTask[] = [];

/** Зона «Без цели»: задача, отпущенная сюда, теряет цель. На ноутбуке прилипает к верху колонки целей: она всегда под рукой */
function NoneZone({ dragging, enabled }: { dragging: boolean; enabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: "none", data: { kind: "none", order: 0 } satisfies DropData, disabled: dragging && !enabled });
  return (
    <div
      ref={setNodeRef}
      data-testid="link-none"
      className={cn(
        "rounded-panel border border-dashed border-border-strong px-4 py-3 text-small text-muted transition-colors lg:sticky lg:top-0 lg:z-10",
        isOver ? "bg-blue-soft text-ink ring-2 ring-blue" : "bg-canvas",
        dragging && !enabled && "opacity-50",
      )}
    >
      <span className="font-semibold text-ink">Без цели.</span> Перетащите сюда задачу, чтобы снять с неё цель
    </div>
  );
}

const GoalCard = memo(function GoalCard({
  goal,
  order,
  tasks,
  open,
  onToggle,
  dragging,
  fits,
  already,
  interactive,
  onUnlink,
}: {
  goal: LinkGoal;
  order: number;
  tasks: LinkTask[];
  open: boolean;
  onToggle: (goalId: string) => void;
  dragging: boolean;
  /** Цель подходит хотя бы одной перетаскиваемой задаче */
  fits: boolean;
  /** Все перетаскиваемые задачи уже у этой цели: отпускание ничего не меняет */
  already: boolean;
  interactive: boolean;
  /** Отвязать задачу; focus: куда перевести фокус, когда её строка пропадёт из карточки */
  onUnlink: (number: number, focus: Finder) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `goal:${goal.id}`, data: { kind: "goal", id: goal.id, order } satisfies DropData, disabled: dragging && !fits });
  const name = goalName(goal);
  const context = [goal.owner ?? "владелец не задан", goal.personal ? "личная цель" : null, goal.result].filter(Boolean).join(", ");
  const pct = progressLabel(goal.numeric);
  const toggleId = `link-goal-toggle-${goal.id}`;
  /** После крестика: следующий крестик в карточке, иначе предыдущий, иначе кнопка «Задачи» */
  const focusAfterUnlink = (n: number): Finder => {
    const rest = tasks.filter((t) => t.canLink && interactive).map((t) => t.number);
    const next = focusAfter(rest, [n]);
    return () => (next !== null ? document.querySelector<HTMLElement>(`[aria-label="Отвязать задачу ${next} от цели"]`) : null) ?? document.getElementById(toggleId);
  };
  return (
    <li>
      <section
        ref={setNodeRef}
        aria-labelledby={`link-goal-title-${goal.id}`}
        data-testid={`link-goal-${goal.id}`}
        className={cn("sv-card relative bg-surface p-3 transition-shadow", isOver ? "ring-2 ring-blue" : dragging && fits && "ring-1 ring-blue/50", dragging && !fits && "opacity-50")}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 id={`link-goal-title-${goal.id}`} className="break-words text-small font-semibold text-ink">
              {name}
            </h4>
            <p className="mt-0.5 text-caption text-muted">{context}</p>
          </div>
          <button
            id={toggleId}
            type="button"
            onClick={() => onToggle(goal.id)}
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
          <span data-testid={`link-goal-tally-${goal.id}`}>{tallyText(tasks)}</span>
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
        {/* Подсказки поверх карточки, а не новой строкой: карточки не прыгают, когда задачу берут */}
        {isOver ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] bg-surface/85 px-3 text-center text-small font-semibold text-blue-700" aria-hidden="true">
            {already ? "Уже у этой цели" : "Отпустите, чтобы привязать"}
          </span>
        ) : dragging && !fits ? (
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-field px-2 py-0.5 text-caption font-medium text-ink" aria-hidden="true">
            Не подходит этой задаче
          </span>
        ) : null}
        {open ? (
          <div id={`link-goal-tasks-${goal.id}`} className="mt-2 border-t border-line pt-2">
            {tasks.length ? (
              <ul className="m-0 flex list-none flex-col p-0" aria-label={`Задачи цели «${name}»`}>
                {tasks.map((t) => (
                  <LinkedRow key={t.number} task={t} interactive={interactive} onUnlink={() => onUnlink(t.number, focusAfterUnlink(t.number))} />
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
});

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

/** Метка цели у задачи: код и название, полностью в подсказке */
function GoalBadge({ goal, pending = false }: { goal: GoalLabel; pending?: boolean }) {
  return (
    <span className={cn("sv-badge sv-badge--info mt-1 inline-flex max-w-full items-center gap-1", pending && "opacity-60")} title={goalName(goal)}>
      <Target className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{goalName(goal)}</span>
    </span>
  );
}

/** Строка блока «Только посмотреть»: без перетаскивания и кнопок, только текст */
const ViewRow = memo(function ViewRow({ task, goal, today }: { task: LinkTask; goal: GoalLabel | null; today: IsoDate }) {
  const { overdue, when, reason } = caption(task, today);
  return (
    <li className="rounded-control px-1 py-1.5" data-testid={`link-task-${task.number}`}>
      <span className={cn("block break-words text-small text-ink", task.closed && "text-muted")}>
        <span className="mr-1.5 tabular-nums text-muted">{task.number}</span>
        {task.title}
      </span>
      <span className="mt-0.5 block text-caption text-muted">
        {statusLabel(task.status)}, <span className={cn(overdue && "font-semibold text-danger-ink")}>{overdue ? `просрочена, срок был ${formatShort(task.due)}` : when}</span>, {task.owner}
        {reason ? `, ${reason}` : ""}
      </span>
      {goal ? <GoalBadge goal={goal} /> : null}
    </li>
  );
});

const TaskRow = memo(function TaskRow({
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
  goal: GoalLabel | null;
  today: IsoDate;
  interactive: boolean;
  selected: boolean;
  pending: boolean;
  onSelect: (number: number) => void;
  onPick: (number: number) => void;
}) {
  const draggable = interactive && task.canLink;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `t:${task.number}`, data: { number: task.number, from: "list" } satisfies DragData, disabled: !draggable });
  const { overdue, when, reason } = caption(task, today);
  return (
    <li
      className={cn("flex items-start gap-1 rounded-control py-1 pr-1", selected ? "bg-field ring-1 ring-inset ring-blue" : "hover:bg-field", isDragging && "opacity-40")}
      data-testid={`link-task-${task.number}`}
      data-link-row={task.number}
    >
      {draggable ? (
        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center sm:h-9 sm:w-9">
          <input type="checkbox" checked={selected} onChange={() => onSelect(task.number)} aria-label={`Отметить задачу ${task.number}`} className="h-4 w-4 accent-blue-700" />
        </label>
      ) : (
        <span className="w-3 shrink-0" aria-hidden="true" />
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
            {!draggable ? `, ${task.owner}` : ""}
          </span>
          {goal ? <GoalBadge goal={goal} pending={pending} /> : null}
        </span>
      </div>
      {draggable ? (
        <Button variant="secondary" size="sm" className="mt-1 shrink-0 gap-1 max-sm:h-11 sm:mt-0" onClick={() => onPick(task.number)} aria-label={`К цели: задача ${task.number}`}>
          <Target className="h-4 w-4" aria-hidden="true" />
          <span aria-hidden="true">К цели</span>
        </Button>
      ) : null}
    </li>
  );
});

/** Выбор цели без перетаскивания: «К цели» у задачи и «Привязать к цели» для отмеченных */
function GoalPicker({
  tasks,
  goals,
  goalOf,
  onChoose,
  onClose,
  onCloseAutoFocus,
}: {
  tasks: LinkTask[];
  goals: LinkGoal[];
  goalOf: GoalOf;
  onChoose: (goalId: string | null) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
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
      onCloseAutoFocus={onCloseAutoFocus}
      title={one ? `Задача ${tasks[0]!.number}: к цели` : `Отмеченные задачи: ${tasks.length}, к цели`}
      description={`Подходят ${WHICH_GOALS}`}
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
                  const note = here
                    ? one
                      ? "задача уже здесь"
                      : "задачи уже здесь"
                    : !fit
                      ? "не подходит: цель другой команды, чужая личная или не текущего квартала и не квартала срока"
                      : fit < tasks.length
                        ? `подходит ${fit} из ${tasks.length}`
                        : [goal.owner, goal.personal ? "личная цель" : null].filter(Boolean).join(", ");
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
