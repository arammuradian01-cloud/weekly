"use client";

// Части очереди «Ждёт вас» (этап 76): заголовок группы и кнопка «Показать все». Отдельно от очереди, чтобы группа
// событий «Прочитать» (inbox-list) и группы задач и просьб (me-queue) выглядели одинаково без взаимного импорта

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { QUEUE_GROUP_LIMIT } from "./me-tasks";

// Этап 68: у группы цветная точка срочности, у «Срок прошёл» красноватая рамка списка. Подсказка группы в одну строку
// и только на широком экране: смысл ясен из названия
export type GroupTone = "danger" | "warning" | "info" | "neutral";

const DOT: Record<GroupTone, string> = { danger: "bg-danger", warning: "bg-warning", info: "bg-blue", neutral: "bg-steel" };

/** Заголовок группы внутри «Ждёт вас»: третий уровень под заголовком блока, якорь с отступом под липкую шапку */
export function GroupTitle({ id, tone, count, children }: { id: string; tone?: GroupTone; count: number; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className={cn(
        "inline-flex scroll-mt-[calc(6rem+var(--view-as-h,0px))] items-center gap-2 text-title-sm font-semibold",
        tone === "danger" ? "text-danger-ink" : tone === "warning" ? "text-warning-ink" : "text-ink",
      )}
    >
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[tone ?? "neutral"])} aria-hidden="true" />
      {children} <span className="sv-section__count">{count}</span>
    </h3>
  );
}

/** Кнопка «Показать все N» под группой: строки сверх пяти раскрываются на месте, без перехода */
export function ShowAll({ total, open, onToggle, controls, label }: { total: number; open: boolean; onToggle: () => void; controls: string; label: string }) {
  if (total <= QUEUE_GROUP_LIMIT) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="mt-2 inline-flex min-h-11 items-center gap-1 self-start rounded-md text-small font-semibold text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-8"
    >
      <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      {open ? "Свернуть" : `Показать все ${total}`}
      <span className="sr-only">{`: ${label}`}</span>
    </button>
  );
}

