"use client";

// Подсказка по задаче на карте сроков (этап 84). При наведении на полосу или на строку задачи, без открытия
// карточки, показывается полное название, описание задачи, срок, состояние и ответственный. Подсказка появляется и
// при переходе на задачу с клавиатуры, закрывается по Escape, уходу указателя и потере фокуса.
//
// Атрибут title не используется: браузер показывает его через секунду, с клавиатуры он не читается и оформить его
// нельзя. Здесь обычный блок с role="tooltip", связанный с полосой через aria-describedby.
//
// Подсказка лежит в конце карты с position: fixed, а не рядом с полосой: у карты обрезка по краям (overflow-clip),
// внутри неё подсказка обрезалась бы. На сенсорном экране наведения нет: там работает открытие карточки задачи.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Task } from "@/domain/types";
import type { IsoDate } from "@/domain/dates";
import { taskTip, type TaskTip } from "@/lib/tasks/task-tip";

/** Одна подсказка на карту: видна всегда не больше одной */
export const TASK_TIP_ID = "roadmap-task-tip";

type Anchor = { top: number; bottom: number; left: number; right: number };
type Shown = { number: number; tip: TaskTip; anchor: Anchor };

/** Отступ подсказки от полосы и от краёв окна */
const GAP = 8;

export function useTaskTip(today: IsoDate) {
  const [shown, setShown] = useState<Shown | null>(null);

  const show = (task: Task, el: Element | null | undefined) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setShown({ number: task.number, tip: taskTip(task, today), anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } });
  };
  /** Прячет подсказку этой задачи: подсказку другой задачи, которая уже открылась, не гасит */
  const hide = (number?: number) => setShown((cur) => (cur && number !== undefined && cur.number !== number ? cur : null));

  // Прокрутка и смена размера окна уводят полосу из-под подсказки: проще закрыть, чем пересчитывать на каждом кадре
  useEffect(() => {
    if (!shown) return;
    const close = () => setShown(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShown(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  return {
    shown,
    show,
    hide,
    /** id подсказки для aria-describedby полосы: только пока подсказка этой задачи видна */
    describedBy: (number: number) => (shown?.number === number ? TASK_TIP_ID : undefined),
  };
}

export function TaskTipBubble({ shown }: { shown: Shown | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = shown?.anchor;

  // Замер до отрисовки: подсказка встаёт над полосой, а если сверху места нет, под ней; по горизонтали прижимается
  // к краю окна, но не вылезает за него
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) {
      setPos(null);
      return;
    }
    const box = el.getBoundingClientRect();
    const above = anchor.top - box.height - GAP;
    const top = above >= GAP ? above : Math.min(anchor.bottom + GAP, window.innerHeight - box.height - GAP);
    const left = Math.max(GAP, Math.min(anchor.left, window.innerWidth - box.width - GAP));
    setPos({ top: Math.max(GAP, top), left });
  }, [anchor]);

  if (!shown) return null;
  const { tip } = shown;
  return (
    <div
      ref={ref}
      id={TASK_TIP_ID}
      role="tooltip"
      // Подсказка не ловит указатель: она не мешает нажать полосу под ней и не держит сама себя открытой
      className="pointer-events-none fixed z-50 flex max-h-[60vh] w-[22rem] max-w-[calc(100vw-16px)] flex-col gap-1.5 overflow-hidden rounded-control-lg border border-line bg-surface p-3 shadow-medium"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? "visible" : "hidden" }}
      data-testid="task-tip"
    >
      <p className="m-0 line-clamp-3 text-small font-semibold text-ink">{tip.title}</p>
      {tip.description ? <p className="m-0 line-clamp-4 text-caption text-ink">{tip.description}</p> : null}
      <dl className="m-0 flex flex-col gap-0.5 text-caption">
        {tip.rows.map((r) => (
          <div key={r.label} className="flex min-w-0 gap-1.5">
            <dt className="m-0 shrink-0 text-muted">{r.label}:</dt>
            <dd className="m-0 line-clamp-2 min-w-0 text-ink">{r.text}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
