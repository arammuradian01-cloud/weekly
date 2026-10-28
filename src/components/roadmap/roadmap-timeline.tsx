"use client";

// Карта сроков roadmap (этап 68): задачи полосами от начала до срока по месяцам. Полосу тянут за середину
// (сдвигаются начало и срок, одна правка с причиной), за левый край (начало, сохраняется сразу) или за правый (срок, с
// причиной, как в карточке задачи). Обрезанный край (задача началась до окна карты или кончается после) тоже тянется:
// край встаёт на дату под указателем. Перетаскивание засчитывается после 6 px движения в основном по горизонтали, иначе
// это нажатие: оно открывает задачу и ничего не сохраняет. С клавиатуры: стрелки двигают полосу на день, Alt со
// стрелкой меняет начало, Shift срок, Enter сохраняет, Escape отменяет, Enter или пробел без сдвига открывают задачу.
// Права те же, что у срока задачи: кто не может менять срок, видит полосу без ручек. На сенсорном экране и в «Смотреть
// как» полосы не двигаются (начало задаётся в карточке задачи), сервер всё равно проверяет права и режим просмотра.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Star, Target } from "lucide-react";
import type { Task } from "@/domain/types";
import { diffDays, formatLong, formatShort, plural, type IsoDate } from "@/domain/dates";
import { ownerName } from "@/domain/people";
import { IMPORTANCE_LABEL } from "@/lib/tasks/roadmap";
import { barOf, dayAtX, dragSpan, handleInside, HANDLE_PX, spanPlan, type Bar, type DragMode, type TimelineRange } from "@/lib/tasks/timeline";
import type { GoalLine, GoalTimelineRow } from "@/lib/tasks/roadmap-goals";
import { moveTaskSpanAction, setTaskStartAction, transferDueAction, type TaskActionResult } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/overlays";
import { TextArea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { GoalCode, GoalStatus, GroupToggle, goalHref, goalName, goalOrigin, goalProgressText, goalSpanText, groupCount, tasksText } from "./roadmap-goals";

type Span = { start: IsoDate; end: IsoDate };
/** abs: тянут обрезанный край, он встаёт на дату под указателем; left: левый край трека на экране */
type Drag = { number: number; mode: DragMode; x0: number; y0: number; left: number; width: number; base: Span; abs: boolean; moved: boolean; span: Span | null };
type Pending = { task: Task; before: Span; after: Span };

/**
 * Раздел карты (этап 77). direction: направление с полосами задач («По задачам»); goals: строки целей без задач («По
 * целям»); goal: строка цели и под ней полосы её задач, сворачивается («Цели и задачи»); nogoal: задачи без цели
 */
export type TimelineSection =
  | { kind: "direction"; key: string; label: string; bars: Bar[]; important: number }
  | { kind: "goals"; key: string; label: string; rows: GoalTimelineRow[] }
  | { kind: "goal"; key: string; row: GoalTimelineRow }
  | { kind: "nogoal"; key: string; label: string; bars: Bar[]; important: number; overdue: number };

/**
 * Цвет полосы цели по статусу, как метка статуса на экране «Цели»: в риске красная, достигнута зелёная, закрыта не
 * полностью или цель другого квартала серая, идёт фиолетовая (у задач голубые). У цели без задач полоса пунктиром на
 * фоне карты. Текст держит 4,5:1 в обеих темах
 */
function goalColors(row: GoalTimelineRow): { filled: string; empty: string } {
  const g = row.group.goal;
  if (!g.known || (g.result !== "IN_PROGRESS" && g.result !== "ACHIEVED")) return { filled: "bg-field text-ink ring-1 ring-inset ring-steel", empty: "bg-surface text-ink border-2 border-dashed border-steel" };
  if (g.result === "IN_PROGRESS" && g.risk) return { filled: "bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger-ink", empty: "bg-surface text-danger-ink border-2 border-dashed border-danger-ink" };
  if (g.result === "ACHIEVED") return { filled: "bg-green-soft text-green-ink ring-1 ring-inset ring-green-ink", empty: "bg-surface text-green-ink border-2 border-dashed border-green-ink" };
  return { filled: "bg-info-soft text-info-ink ring-1 ring-inset ring-info-ink", empty: "bg-surface text-info-ink border-2 border-dashed border-info-ink" };
}

/** Подпись на полосе цели: сроки или обрубок за окном */
function goalBarText(line: GoalLine): string {
  if (line.outside === "before") return `${line.late ? "просрочено с" : "срок"} ${formatShort(line.end)}`;
  if (line.outside === "after") return `с ${formatShort(line.start)}`;
  return line.empty ? "задач нет, до конца квартала" : `по ${formatShort(line.end)}`;
}

/** Сколько пикселей нужно сдвинуть указатель, чтобы нажатие стало перетаскиванием */
const DRAG_THRESHOLD = 6;
/** Ширина трека до первого замера: ноутбук 1440 с боковым меню */
const TRACK_PX = 860;

const pct = (day: number, range: TimelineRange) => `${(day / range.days) * 100}%`;

/** Даты полосы словами: «с 12 окт. по 25 окт.» или «без начала, срок 25 окт.» */
const spanText = (bar: Pick<Bar, "start" | "end" | "startKnown">) => (bar.startKnown ? `с ${formatShort(bar.start)} по ${formatShort(bar.end)}` : `без начала, срок ${formatShort(bar.end)}`);

/** Подпись обрубка за окном карты: у левого края просроченные, у правого срок позже окна */
const outsideText = (bar: Bar) => (bar.outside === "before" ? (bar.overdue ? `просрочено с ${formatShort(bar.end)}` : `срок ${formatShort(bar.end)}`) : `срок ${formatShort(bar.end)}`);

function tone(bar: Bar): string {
  // Цвета токенами: критичная тёмная, важная синяя, обычная светло-голубая, просроченная красная. Текст на полосе
  // держит 4,5:1 в обеих темах; рамка цвета ссылки отделяет тёмную и светлую полосу от фона карточки
  if (bar.overdue) return "bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger-ink";
  if (bar.importance === 2) return "bg-navy text-sidebar-text ring-1 ring-inset ring-link";
  if (bar.importance === 1) return "bg-link text-surface";
  return "bg-blue-line text-ink ring-1 ring-inset ring-link";
}

/** Сохраняет новую пару дат по плану: одно начало, один срок или сдвиг целиком одной правкой */
function saveSpan(task: Task, before: Span, after: Span, why: string | undefined, runTask: (action: () => Promise<TaskActionResult>, toastText: string) => Promise<boolean>) {
  const plan = spanPlan(before, after);
  if (plan.kind === "start") return runTask(() => setTaskStartAction(task.number, plan.start), `Начало задачи ${task.number}: ${formatLong(plan.start)}`);
  if (plan.kind === "due") return runTask(() => transferDueAction(task.number, plan.due, why ?? ""), `Срок задачи ${task.number} перенесён на ${formatLong(plan.due)}`);
  return runTask(() => moveTaskSpanAction(task.number, plan.start, plan.due, why ?? ""), `Задача ${task.number}: с ${formatLong(plan.start)} по ${formatLong(plan.due)}`);
}

/**
 * Ручка края полосы: прозрачная нажимаемая полоса HANDLE_PX шириной, inside пикселей из неё внутри полосы, остальное
 * снаружи. Видна тонкая черта у края: внутри цветом текста полосы, снаружи цветом иконок (на фоне трека)
 */
function EdgeHandle({ side, inside, dashed = false, onPointerDown }: { side: "start" | "end"; inside: number; dashed?: boolean; onPointerDown: (e: React.PointerEvent<HTMLElement>) => void }) {
  const out = HANDLE_PX - inside;
  // Черта на 2 px внутрь от края полосы, если ручка заходит в полосу хотя бы на 6 px, иначе на 4 px снаружи
  const at = inside >= 6 ? out + 2 : out - 4;
  const line = cn("absolute inset-y-1 w-0.5 rounded-full", inside >= 6 ? "bg-current/50" : "bg-icon", dashed && "w-0 rounded-none border-l-2 border-dashed bg-transparent", dashed && (inside >= 6 ? "border-current" : "border-icon"));
  return (
    <span
      onPointerDown={onPointerDown}
      className="absolute inset-y-0 z-[1] cursor-ew-resize"
      style={side === "start" ? { left: -out, width: HANDLE_PX } : { right: -out, width: HANDLE_PX }}
      aria-hidden="true"
      data-handle={side}
    >
      <span className={line} style={side === "start" ? { left: at } : { right: at }} />
    </span>
  );
}

export function RoadmapTimeline({
  range,
  sections,
  today,
  quarter = "",
  collapsed,
  onToggle,
  canMove,
  onOpen,
  runTask,
}: {
  range: TimelineRange;
  sections: TimelineSection[];
  today: IsoDate;
  /** Текущий квартал: у цели другого квартала он подписан */
  quarter?: string;
  /** Свёрнутые группы «Цели и задачи»: ключи разделов */
  collapsed?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
  canMove: (t: Task) => boolean;
  onOpen: (number: number) => void;
  runTask: (action: () => Promise<TaskActionResult>, toastText: string) => Promise<boolean>;
}) {
  const [preview, setPreview] = useState<Record<number, Span>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("");
  const drag = useRef<Drag | null>(null);
  // Ширина трека в пикселях: по ней ручки краёв решают, сколько их внутри полосы (узкую полосу можно тянуть за середину)
  const root = useRef<HTMLDivElement>(null);
  const [trackPx, setTrackPx] = useState(TRACK_PX);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    // Трек: ширина карты без колонки задач (280 px) и её рамки. Карта на месте всегда, строки меняются фильтрами
    const measure = () => setTrackPx(Math.max(0, el.clientWidth - 281) || TRACK_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Нажатие после перетаскивания: click приходит следом за отпусканием кнопки, задачу он открывать не должен
  const dragged = useRef(false);
  const todayAt = diffDays(range.start, today);
  const allBars = sections.flatMap((sec) => (sec.kind === "goals" ? [] : sec.kind === "goal" ? sec.row.bars : sec.bars));
  const anyMovable = allBars.some((b) => canMove(b.task));
  const isOpen = (key: string) => !collapsed?.has(key);

  const cancel = (number: number) =>
    setPreview((p) => {
      const next = { ...p };
      delete next[number];
      return next;
    });

  const commit = async (task: Task, before: Span, after: Span, why?: string) => {
    const plan = spanPlan(before, after);
    // Подсказка диктору о несохранённом сдвиге больше не нужна: дальше говорит окно причины или всплывающее сообщение
    setLive("");
    if (!plan.kind) return cancel(task.number);
    if (plan.kind !== "start" && why === undefined) {
      setPending({ task, before, after });
      setReason("");
      return;
    }
    setBusy(true);
    await saveSpan(task, before, after, why, runTask);
    setBusy(false);
    setPending(null);
    cancel(task.number);
  };

  // base: полоса по настоящим датам задачи, а не по несохранённому сдвигу с клавиатуры: сдвиг сбрасывается, иначе
  // правка сравнивалась бы с предпросмотром и перенос срока с клавиатуры молча терялся бы
  const begin = (e: React.PointerEvent<HTMLElement>, base: Bar, mode: DragMode) => {
    if (e.button !== 0 || busy) return;
    const el = e.currentTarget.closest<HTMLElement>("[data-rm-bar]");
    const track = el?.closest<HTMLElement>("[data-rm-track]");
    if (!el || !track) return;
    e.stopPropagation();
    dragged.current = false;
    if (preview[base.task.number]) {
      cancel(base.task.number);
      setLive("");
    }
    // Захват указателя: движение и отпускание приходят полосе, даже когда указатель ушёл с неё
    el.setPointerCapture(e.pointerId);
    const rect = track.getBoundingClientRect();
    const abs = (mode === "start" && base.cutStart) || (mode === "end" && base.cutEnd);
    drag.current = { number: base.task.number, mode, x0: e.clientX, y0: e.clientY, left: rect.left, width: rect.width, base: { start: base.start, end: base.end }, abs, moved: false, span: null };
  };

  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    // Перетаскивание только после 6 px и в основном по горизонтали: дрожание руки при нажатии остаётся нажатием
    if (!d.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
      d.moved = true;
    }
    e.preventDefault();
    let delta = Math.round((dx / d.width) * range.days);
    if (d.abs) {
      // Обрезанный край встаёт на день под указателем: сдвиг считается от настоящей даты края
      const day = dayAtX(range, e.clientX - d.left, d.width);
      delta = diffDays(d.mode === "start" ? d.base.start : d.base.end, day);
    }
    d.span = dragSpan(d.base, d.mode, delta, today);
    setPreview((p) => ({ ...p, [d.number]: d.span! }));
  };

  const end = (task: Task) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    dragged.current = true;
    // Нажатие после перетаскивания гасится только сразу: браузер без click после захвата указателя не съест следующее
    setTimeout(() => {
      dragged.current = false;
    }, 0);
    if (d.span) void commit(task, d.base, d.span);
  };

  const click = (number: number) => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    onOpen(number);
  };

  const onKey = (e: React.KeyboardEvent, bar: Bar, base: Bar) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step) {
      e.preventDefault();
      if (busy) return;
      const mode: DragMode = e.altKey ? "start" : e.shiftKey ? "end" : "move";
      const next = dragSpan({ start: bar.start, end: bar.end }, mode, step, today);
      setPreview((p) => ({ ...p, [bar.task.number]: next }));
      setLive(`Задача ${bar.task.number}: ${spanText({ ...next, startKnown: base.startKnown || mode !== "end" })}. Enter сохраняет, Escape отменяет`);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      // Пока идёт сохранение, повторный Enter не отправляет правку ещё раз
      if (busy) return;
      if (preview[bar.task.number]) void commit(bar.task, { start: base.start, end: base.end }, preview[bar.task.number]!);
      else onOpen(bar.task.number);
    } else if (e.key === "Escape" && preview[bar.task.number]) {
      e.preventDefault();
      cancel(bar.task.number);
      setLive(`Задача ${bar.task.number}: сдвиг отменён`);
    }
  };

  const renderBar = (base: Bar, indent = false) => {
    const span = preview[base.task.number];
    const bar = span ? barOf(base.task, range, today, span) : base;
    const can = canMove(base.task);
    const words = [`${bar.task.number}. ${bar.task.title}`, spanText(bar), ...(bar.importance ? [IMPORTANCE_LABEL[bar.importance].toLowerCase()] : []), ...(bar.overdue ? ["просрочена"] : [])];
    const label = words.join(", ");
    // Полоса за окном карты: обрубок прижат к краю трека с подписью даты, ширина по подписи
    const place: React.CSSProperties = bar.outside === "before" ? { left: 0 } : bar.outside === "after" ? { right: 0 } : { left: `min(${pct(bar.from, range)}, calc(100% - 12px))`, width: `max(12px, ${pct(bar.to - bar.from + 1, range)})` };
    const edges = can && !bar.outside;
    // Ширина полосы в пикселях: по ней ручки решают, сколько их внутри, и отступ текста
    const barPx = Math.max(12, ((bar.to - bar.from + 1) / range.days) * trackPx);
    const inL = handleInside(barPx);
    const inR = handleInside(barPx, bar.cutEnd);
    return (
      <li key={base.task.number} className="grid h-14 grid-cols-[280px_minmax(0,1fr)] border-b border-line last:border-b-0">
        <div className={cn("flex min-w-0 flex-col justify-center pr-4", indent ? "pl-10" : "pl-4")}>
          <p className="m-0 truncate text-small font-semibold text-ink" title={bar.task.title}>
            <span className="mr-1.5 font-normal tabular-nums text-muted">{bar.task.number}</span>
            {bar.task.title}
          </p>
          <p className="m-0 truncate text-caption text-muted">
            {ownerName(bar.task.owner, true)}, {spanText(bar)}
            {bar.overdue ? <span className="font-semibold text-danger-ink">, просрочена</span> : null}
          </p>
        </div>
        <div data-rm-track className="relative border-l border-line">
          {range.months.slice(1).map((m) => (
            <span key={m.key} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(m.offset, range) }} aria-hidden="true" />
          ))}
          <div
            data-rm-bar
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-describedby={can ? "timeline-keys" : undefined}
            title={label}
            onPointerDown={can ? (e) => begin(e, base, "move") : undefined}
            onPointerMove={can ? move : undefined}
            onPointerUp={can ? () => end(base.task) : undefined}
            onPointerCancel={
              can
                ? () => {
                    drag.current = null;
                    cancel(base.task.number);
                  }
                : undefined
            }
            onClick={() => click(bar.task.number)}
            onKeyDown={
              can
                ? (e) => onKey(e, bar, base)
                : (e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onOpen(bar.task.number);
                  }
            }
            className={cn(
              "absolute top-3 flex h-8 items-center rounded-control text-caption font-semibold select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              tone(bar),
              can ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
              span && "shadow-medium",
              (bar.cutStart || bar.outside === "before") && "rounded-l-none",
              (bar.cutEnd || bar.outside === "after") && "rounded-r-none",
            )}
            style={place}
            data-testid={`timeline-bar-${bar.task.number}`}
            data-outside={bar.outside ?? undefined}
            data-cut={bar.cutStart ? (bar.cutEnd ? "both" : "start") : bar.cutEnd ? "end" : undefined}
          >
            {/* Ручки краёв: нажимается полоса 24 px, внутри полосы не больше четверти её ширины, у узкой полосы ручки
                снаружи. Обрезанный край тоже с ручкой: он встаёт на дату под указателем */}
            {edges ? (
              <EdgeHandle side="start" inside={inL} dashed={!bar.startKnown} onPointerDown={(e) => begin(e, base, "start")} />
            ) : !bar.startKnown && !bar.outside && !bar.cutStart ? (
              <span className="absolute inset-y-0 left-0 border-l-[3px] border-dashed border-current" aria-hidden="true" />
            ) : null}
            {/* Звёздочки и текст внутри своей обёртки с обрезкой: у узкой полосы они не вылезают, ручки снаружи видны */}
            <span className={cn("flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap", barPx < 40 && !bar.outside ? "px-1" : "px-3")}>
              {bar.importance ? (
                // Звёздочки цветом текста полосы: цветные звёздочки доски на тёмной и синей полосе не видны
                <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                  {Array.from({ length: bar.importance }, (_, i) => (
                    <Star key={i} className="h-3.5 w-3.5" fill="currentColor" strokeWidth={1.5} />
                  ))}
                </span>
              ) : null}
              <span className="min-w-0 truncate">{bar.outside ? outsideText(bar) : bar.to - bar.from > 10 ? bar.task.title : formatShort(bar.end)}</span>
            </span>
            {edges ? <EdgeHandle side="end" inside={inR} onPointerDown={(e) => begin(e, base, "end")} /> : null}
          </div>
        </div>
      </li>
    );
  };

  // Строка цели: слева код, название (ссылка на цель), статус, прогресс и счётчик задач; справа полоса цели от начала
  // первой задачи до самого позднего срока. Полоса тоже ведёт к цели, с клавиатуры хватает ссылки в названии
  const renderGoalRow = (row: GoalTimelineRow, toggle: { key: string; controls: string } | null, headingId?: string) => {
    const { group, line } = row;
    const g = group.goal;
    const name = goalName(g);
    const Heading = headingId ? "h2" : "p";
    const meta = [goalOrigin(g, quarter), goalProgressText(g), group.tasks.length ? (toggle ? groupCount(group) : tasksText(group.tasks.length)) : null].filter(Boolean).join(", ");
    const colors = goalColors(row);
    const narrow = !line.outside && ((line.to - line.from + 1) / range.days) * trackPx < 110;
    const place: React.CSSProperties =
      line.outside === "before" ? { left: 0 } : line.outside === "after" ? { right: 0 } : { left: `min(${pct(line.from, range)}, calc(100% - 12px))`, width: `max(12px, ${pct(line.to - line.from + 1, range)})` };
    return (
      <div className="grid h-16 grid-cols-[280px_minmax(0,1fr)] border-b border-line" data-testid={`timeline-goal-${g.id}`}>
        <div className="flex min-w-0 flex-col justify-center gap-1 px-4">
          <Heading id={headingId} className="m-0 flex min-w-0 items-center gap-1.5 text-small font-semibold text-ink">
            {toggle ? <GroupToggle open={isOpen(toggle.key)} onToggle={() => onToggle?.(toggle.key)} controls={toggle.controls} label={`задачи цели ${name}, ${tasksText(group.tasks.length)}`} /> : null}
            <GoalCode code={g.code} />
            <Link href={goalHref(g)} className="min-w-0 truncate hover:underline" title={g.title} data-testid={`timeline-goal-link-${g.id}`}>
              {g.title}
            </Link>
          </Heading>
          <p className="m-0 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-caption text-muted">
            <GoalStatus goal={g} />
            <span className="min-w-0 truncate">{meta}</span>
          </p>
        </div>
        <div className="relative border-l border-line">
          {range.months.slice(1).map((m) => (
            <span key={m.key} className="absolute inset-y-0 w-px bg-line" style={{ left: pct(m.offset, range) }} aria-hidden="true" />
          ))}
          <Link
            href={goalHref(g)}
            tabIndex={-1}
            aria-label={`Цель ${name}: ${goalSpanText(group)}`}
            title={`${name}: ${goalSpanText(group)}`}
            className={cn(
              cn("absolute top-4 flex h-8 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-control text-caption font-semibold", narrow ? "px-1.5" : "px-3"),
              line.empty ? colors.empty : colors.filled,
              (line.cutStart || line.outside === "before") && "rounded-l-none",
              (line.cutEnd || line.outside === "after") && "rounded-r-none",
            )}
            style={place}
            data-testid={`timeline-goalbar-${g.id}`}
            data-empty={line.empty ? "true" : undefined}
            data-outside={line.outside ?? undefined}
          >
            {/* У короткой полосы без значка и только дата: иначе подпись обрезается до «по…» */}
            {narrow ? null : <Target className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{narrow && !line.outside && !line.empty ? formatShort(line.end) : goalBarText(line)}</span>
          </Link>
        </div>
      </div>
    );
  };

  const shift = pending ? diffDays(pending.before.end, pending.after.end) : 0;

  return (
    // overflow-clip, а не hidden: строка месяцев липнет к верху страницы, а у контейнера с прокруткой она бы не липла
    <div ref={root} className="sv-card overflow-clip" data-testid="roadmap-timeline">
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {/* В просмотре «Смотреть как» (этап 63) под верхней панелью липнет плашка: строка месяцев встаёт под ней */}
      <div className="sticky top-[calc(4rem+var(--view-as-h,0px))] z-10 grid grid-cols-[280px_minmax(0,1fr)] border-b border-line bg-surface" aria-hidden="true">
        <p className="m-0 self-end px-4 py-2 text-caption font-semibold text-muted">{sections.some((sec) => sec.kind === "goals") ? "Цель" : sections.some((sec) => sec.kind === "goal") ? "Цель и задачи" : "Задача"}</p>
        <div className="relative h-11 border-l border-line">
          {range.months.map((m) => (
            <span key={m.key} className="absolute inset-y-0 border-l border-line px-2 pt-2 text-small font-semibold text-ink first:border-l-0" style={{ left: pct(m.offset, range), width: pct(m.days, range) }}>
              {m.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 z-[3] w-0.5 bg-danger-ink" style={{ left: `calc(280px + (100% - 280px) * ${(todayAt + 0.5) / range.days})` }} aria-hidden="true" />
        {sections.map((sec) => {
          if (sec.kind === "direction")
            return (
              <section key={sec.key} aria-labelledby={`tl-${sec.key}`} data-testid={`timeline-row-${sec.key}`}>
                <h2 id={`tl-${sec.key}`} className="m-0 flex items-baseline gap-2 border-b border-line bg-canvas px-4 py-2 text-body font-semibold text-ink">
                  {sec.label}
                  <span className="text-small font-normal text-muted">
                    {sec.bars.length} {plural(sec.bars.length, "задача", "задачи", "задач")}
                    {sec.important ? `, важных ${sec.important}` : ""}
                  </span>
                </h2>
                <ul className="m-0 list-none p-0">{sec.bars.map((b) => renderBar(b))}</ul>
              </section>
            );
          if (sec.kind === "goals")
            return (
              <section key={sec.key} aria-labelledby={`tl-${sec.key}`} data-testid="timeline-goals">
                <h2 id={`tl-${sec.key}`} className="m-0 flex items-baseline gap-2 border-b border-line bg-canvas px-4 py-2 text-body font-semibold text-ink">
                  {sec.label}
                  <span className="text-small font-normal text-muted">
                    {sec.rows.length} {plural(sec.rows.length, "цель", "цели", "целей")}
                  </span>
                </h2>
                <ul className="m-0 list-none p-0">
                  {sec.rows.map((r) => (
                    <li key={r.group.goal.id}>{renderGoalRow(r, null)}</li>
                  ))}
                </ul>
              </section>
            );
          if (sec.kind === "goal") {
            const id = sec.row.group.goal.id;
            const open = isOpen(sec.key);
            return (
              <section key={sec.key} aria-labelledby={`tl-goal-${id}`} data-testid={`timeline-group-${id}`}>
                {renderGoalRow(sec.row, { key: sec.key, controls: `tl-goal-tasks-${id}` }, `tl-goal-${id}`)}
                <ul id={`tl-goal-tasks-${id}`} className="m-0 list-none p-0" hidden={!open}>
                  {sec.row.bars.length ? (
                    sec.row.bars.map((b) => renderBar(b, true))
                  ) : (
                    <li className="border-b border-line py-2 pl-10 pr-4 text-caption text-muted">Открытых задач у цели нет</li>
                  )}
                </ul>
              </section>
            );
          }
          const open = isOpen(sec.key);
          return (
            <section key={sec.key} aria-labelledby="tl-nogoal" data-testid="timeline-nogoal">
              <h2 id="tl-nogoal" className="m-0 flex items-center gap-1.5 border-b border-line bg-canvas px-4 py-2 text-body font-semibold text-ink">
                <GroupToggle open={open} onToggle={() => onToggle?.(sec.key)} controls="tl-nogoal-tasks" label={`${sec.label}, ${tasksText(sec.bars.length)}`} />
                {sec.label}
                <span className="text-small font-normal text-muted">{groupCount({ tasks: sec.bars, important: sec.important, overdue: sec.overdue })}</span>
              </h2>
              <ul id="tl-nogoal-tasks" className="m-0 list-none p-0" hidden={!open}>
                {sec.bars.map((b) => renderBar(b))}
              </ul>
            </section>
          );
        })}
      </div>
      {anyMovable ? (
        // Видимая подсказка и есть описание полос для диктора (aria-describedby): одна копия текста, а не две
        <p id="timeline-keys" className="m-0 border-t border-line px-4 py-2 text-caption text-muted" data-testid="timeline-hint">
          Мышью: за середину полоса сдвигается вся, за левый край меняется начало, за правый срок с причиной переноса; обрезанный край встаёт на дату под
          указателем. С клавиатуры: стрелки двигают полосу на день, Alt со стрелкой меняет начало, Shift со стрелкой срок, Enter сохраняет, Escape отменяет.
        </p>
      ) : null}

      <Modal
        open={!!pending}
        onOpenChange={(open) => {
          if (open || busy) return;
          if (pending) cancel(pending.task.number);
          setPending(null);
        }}
        title={pending ? `Перенести срок задачи ${pending.task.number}` : "Перенести срок"}
        description={
          pending
            ? `Был ${formatLong(pending.before.end)}, новый ${formatLong(pending.after.end)}: на ${Math.abs(shift)} ${plural(Math.abs(shift), "день", "дня", "дней")} ${shift > 0 ? "позже" : "раньше"}${
                pending.after.start !== pending.before.start ? `. Начало ${formatLong(pending.after.start)}` : ""
              }`
            : undefined
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (pending && reason.trim() && !busy) void commit(pending.task, pending.before, pending.after, reason.trim());
          }}
        >
          <TextArea label="Причина переноса" id="timeline-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} hint="Число переносов видно всем в карточке задачи" autoFocus />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (pending) cancel(pending.task.number);
                setPending(null);
              }}
            >
              Отмена
            </Button>
            <Button type="submit" loading={busy} disabled={!reason.trim() || busy}>
              Перенести срок
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
