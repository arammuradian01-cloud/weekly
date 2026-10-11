"use client";

// Сворачиваемый блок (этап 47): заголовок с подсказкой виден всегда, содержимое по клику. На details/summary, без
// состояния в React: браузер сам помнит открыт ли блок, клавиатура и диктор работают из коробки

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function Collapsible({
  id,
  title,
  hint,
  open = false,
  headingLevel = 2,
  children,
  className,
  flush = false,
  testId,
}: {
  id: string;
  title: React.ReactNode;
  /** Одна строка о содержимом: видна и в свёрнутом блоке («сделано 7 из 10») */
  hint?: React.ReactNode;
  open?: boolean;
  headingLevel?: 2 | 3;
  children: React.ReactNode;
  className?: string;
  /** Содержимое со своими отступами (модуль, таблица во всю ширину): тело блока без внутреннего отступа */
  flush?: boolean;
  testId?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <details id={id} className={cn("sv-collapse sv-card sv-card--soft", className)} open={open} data-testid={testId}>
      {/* Заголовок и подсказка прямыми детьми summary: без лишней обёртки вокруг заголовка */}
      <summary className="sv-collapse__head">
        <H className="sv-collapse__title" id={`${id}-title`}>
          {title}
        </H>
        {hint ? <span className="sv-collapse__hint">{hint}</span> : null}
        <ChevronDown className="sv-collapse__chev" strokeWidth={1.75} aria-hidden="true" />
      </summary>
      <div className={cn("sv-collapse__body", flush && "sv-collapse__body--flush")}>{children}</div>
    </details>
  );
}

/** Раскрыть свёрнутый блок и прокрутить к нему: для цифр и ссылок, которые ведут внутрь блока */
export function revealCollapsible(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el instanceof HTMLDetailsElement) el.open = true;
  el.scrollIntoView({ block: "start", behavior: "smooth" });
}
