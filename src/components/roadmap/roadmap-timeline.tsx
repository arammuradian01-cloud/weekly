"use client";

// Карта сроков roadmap (этап 68): задачи полосами от начала до срока по месяцам. Полосу тянут за середину
// (сдвигаются начало и срок), за левый край (начало, сохраняется сразу) или за правый (срок, с причиной, как в
// карточке задачи). С клавиатуры: стрелки двигают полосу на день, Alt со стрелкой меняет начало, Shift срок,
// Enter сохраняет, Escape отменяет. Нажатие без перетаскивания (мышью, Enter или пробелом) открывает задачу.
// Права те же, что у срока задачи: кто не может менять срок, видит полосу без ручек. В режиме «Смотреть как»
// сервер всё равно откажет: действия идут через тот же run, что и перенос срока.

import { useRef, useState } from "react";
import { Star } from "lucide-react";
import type { Task } from "@/domain/types";
import { diffDays, formatLong, formatShort, plural, type IsoDate } from "@/domain/dates";
import { ownerName } from "@/domain/people";
import { IMPORTANCE_LABEL } from "@/lib/tasks/roadmap";
import { barOf, dragSpan, spanPlan, type Bar, type DragMode, type TimelineRange, type TimelineRow } from "@/lib/tasks/timeline";
import { setTaskStartAction, transferDueAction } from "@/app/(app)/tasks/actions";
import type { TaskActionResult } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/cn";
import { Modal } from "@/components/ui/overlays";
import { TextArea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type Span = { start: IsoDate; end: IsoDate };
type Drag = { number: number; mode: DragMode; x0: number; width: number; base: Span; moved: boolean; span: Span | null };
type Pending = { task: Task; before: Span & { startKnown: boolean }; after: Span };

const pct = (day: number, range: TimelineRange) => `${(day / range.days) * 100}%`;

/** Даты полосы словами: «с 12 окт. по 25 окт.» или «без начала, срок 25 окт.» */
const spanText = (bar: Pick<Bar, "start" | "end" | "startKnown">) => (bar.startKnown ? `с ${formatShort(bar.start)} по ${formatShort(bar.end)}` : `без начала, срок ${formatShort(bar.end)}`);

function tone(bar: Bar): string {
  // Цвета токенами: критичная тёмная, важная синяя, обычная светло-голубая, просроченная красная. Текст на полосе
  // держит 4,5:1 в обеих темах; рамка цвета ссылки отделяет тёмную и светлую полосу от фона карточки
  if (bar.overdue) return "bg-danger-soft text-danger-ink ring-1 ring-inset ring-danger-ink";
  if (bar.importance === 2) return "bg-navy text-sidebar-text ring-1 ring-inset ring-link";
  if (bar.importance === 1) return "bg-link text-surface";
  return "bg-blue-line text-ink ring-1 ring-inset ring-link";
}

export function RoadmapTimeline({
  range,
  rows,
  today,
  canMove,
  onOpen,
  runTask,
}: {
  range: TimelineRange;
  rows: TimelineRow[];
  today: IsoDate;
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
  const todayAt = diffDays(range.start, today);
  const anyMovable = rows.some((r) => r.bars.some((b) => canMove(b.task)));

  const cancel = (number: number) =>
    setPreview((p) => {
      const next = { ...p };
      delete next[number];
      return next;
    });

  const commit = async (task: Task, before: Span & { startKnown: boolean }, after: Span, why?: string) => {
    const plan = spanPlan(before, after);
    if (!plan.order.length) return cancel(task.number);
    if (plan.due && why === undefined) {
      setPending({ task, before, after });
      setReason("");
      return;
    }
    setBusy(true);
    // Сервер не даёт начало позже срока и срок раньше начала: порядок шагов из spanPlan. Шаг не прошёл: дальше не идём
    let ok = true;
    for (const step of plan.order) {
      if (!ok) break;
      ok =
        step === "start"
          ? await runTask(() => setTaskStartAction(task.number, plan.start), `Начало задачи ${task.number}: ${formatLong(plan.start!)}`)
          : await runTask(() => transferDueAction(task.number, plan.due!, why ?? ""), `Срок задачи ${task.number} перенесён на ${formatLong(plan.due!)}`);
    }
    setBusy(false);
    setPending(null);
    cancel(task.number);
  };

  const begin = (e: React.PointerEvent<HTMLElement>, bar: Bar, mode: DragMode) => {
    if (e.button !== 0 || busy) return;
    const el = e.currentTarget.closest<HTMLElement>("[data-rm-bar]");
    const track = el?.closest<HTMLElement>("[data-rm-track]");
    if (!el || !track) return;
    e.preventDefault();
    e.stopPropagation();
    // Захват указателя: движение и отпускание приходят полосе, даже когда указатель ушёл с неё
    el.setPointerCapture(e.pointerId);
    drag.current = { number: bar.task.number, mode, x0: e.clientX, width: track.getBoundingClientRect().width, base: { start: bar.start, end: bar.end }, moved: false, span: null };
  };

  const move = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const delta = Math.round(((e.clientX - d.x0) / d.width) * range.days);
    if (delta !== 0) d.moved = true;
    if (!d.moved) return;
    d.span = dragSpan(d.base, d.mode, delta, today);
    setPreview((p) => ({ ...p, [d.number]: d.span! }));
  };

  const end = (task: Task) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) return onOpen(task.number);
    if (d.span) void commit(task, { ...d.base, startKnown: !!task.start }, d.span);
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
      if (preview[bar.task.number]) void commit(bar.task, { start: base.start, end: base.end, startKnown: base.startKnown }, preview[bar.task.number]!);
      else onOpen(bar.task.number);
    } else if (e.key === "Escape" && preview[bar.task.number]) {
      e.preventDefault();
      cancel(bar.task.number);
      setLive(`Задача ${bar.task.number}: сдвиг отменён`);
    }
  };

  const shift = pending ? diffDays(pending.before.end, pending.after.end) : 0;

  return (
    // overflow-clip, а не hidden: строка месяцев липнет к верху страницы, а у контейнера с прокруткой она бы не липла
    <div className="sv-card overflow-clip" data-testid="roadmap-timeline">
      <p id="timeline-keys" className="sr-only">
        Стрелки двигают полосу на день, Alt со стрелкой меняет начало, Shift со стрелкой срок, Enter сохраняет, Escape отменяет
      </p>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {/* В просмотре «Смотреть как» (этап 63) под верхней панелью липнет плашка: строка месяцев встаёт под ней */}
      <div className="sticky top-[calc(4rem+var(--view-as-h,0px))] z-10 grid grid-cols-[280px_minmax(0,1fr)] border-b border-line bg-surface" aria-hidden="true">
        <p className="m-0 self-end px-4 py-2 text-caption font-semibold text-muted">Задача</p>
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
        {rows.map((row) => (
          <section key={row.direction} aria-labelledby={`tl-${row.direction}`} data-testid={`timeline-row-${row.direction}`}>
            <h2 id={`tl-${row.direction}`} className="m-0 flex items-baseline gap-2 border-b border-line bg-canvas px-4 py-2 text-body font-semibold text-ink">
              {row.label}
              <span className="text-small font-normal text-muted">
                {row.bars.length} {plural(row.bars.length, "задача", "задачи", "задач")}
                {row.important ? `, важных ${row.important}` : ""}
              </span>
            </h2>
            <ul className="m-0 list-none p-0">
              {row.bars.map((base) => {
                const span = preview[base.task.number];
                const bar = span ? barOf(base.task, range, today, span) : base;
                const can = canMove(base.task);
                const words = [`${bar.task.number}. ${bar.task.title}`, spanText(bar), ...(bar.importance ? [IMPORTANCE_LABEL[bar.importance].toLowerCase()] : []), ...(bar.overdue ? ["просрочена"] : [])];
                const label = words.join(", ");
                return (
                  <li key={base.task.number} className="grid h-14 grid-cols-[280px_minmax(0,1fr)] border-b border-line last:border-b-0">
                    <div className="flex min-w-0 flex-col justify-center px-4">
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
                        onPointerDown={can ? (e) => begin(e, bar, "move") : undefined}
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
                        onClick={can ? undefined : () => onOpen(bar.task.number)}
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
                          "absolute top-3 flex h-8 items-center gap-1.5 overflow-hidden rounded-control px-3 text-caption font-semibold whitespace-nowrap select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                          tone(bar),
                          can ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer",
                          span && "shadow-medium",
                          bar.cutStart && "rounded-l-none",
                          bar.cutEnd && "rounded-r-none",
                        )}
                        style={{ left: pct(bar.from, range), width: `max(12px, ${pct(bar.to - bar.from + 1, range)})` }}
                        data-testid={`timeline-bar-${bar.task.number}`}
                      >
                        {can ? (
                          <span
                            onPointerDown={(e) => begin(e, bar, "start")}
                            className={cn("absolute inset-y-0 left-0 w-2.5 cursor-ew-resize", !bar.startKnown && "border-l-[3px] border-dashed border-current")}
                            aria-hidden="true"
                          />
                        ) : !bar.startKnown ? (
                          <span className="absolute inset-y-0 left-0 border-l-[3px] border-dashed border-current" aria-hidden="true" />
                        ) : null}
                        {bar.importance ? (
                          // Звёздочки цветом текста полосы: цветные звёздочки доски на тёмной и синей полосе не видны
                          <span className="inline-flex shrink-0 items-center" aria-hidden="true">
                            {Array.from({ length: bar.importance }, (_, i) => (
                              <Star key={i} className="h-3.5 w-3.5" fill="currentColor" strokeWidth={1.5} />
                            ))}
                          </span>
                        ) : null}
                        <span className="truncate">{bar.to - bar.from > 10 ? bar.task.title : formatShort(bar.end)}</span>
                        {can ? <span onPointerDown={(e) => begin(e, bar, "end")} className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-current/20" aria-hidden="true" /> : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {anyMovable ? <p className="m-0 border-t border-line px-4 py-2 text-caption text-muted">Полосу тянут мышью: за середину сдвигается вся, за левый край начало, за правый срок с причиной переноса</p> : null}

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
            ? `Был ${formatLong(pending.before.end)}, новый ${formatLong(pending.after.end)}: на ${Math.abs(shift)} ${plural(Math.abs(shift), "день", "дня", "дней")} ${shift > 0 ? "позже" : "раньше"}`
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
