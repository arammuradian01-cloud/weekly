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
  testId?: string;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <details id={id} className={cn("sv-collapse sv-card sv-card--soft", className)} open={open} data-testid={testId}>
      <summary className="sv-collapse__head">
        <span className="sv-collapse__titles">
          <H className="sv-collapse__title">{title}</H>
          {hint ? <span className="sv-collapse__hint">{hint}</span> : null}
        </span>
        <ChevronDown className="sv-collapse__chev" strokeWidth={1.75} aria-hidden="true" />
      </summary>
      <div className="sv-collapse__body">{children}</div>
    </details>
  );
}
