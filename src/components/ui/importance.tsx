"use client";

// Отметка важности задачи (этап 56): звёздочки на доске roadmap. Решение Арама 21.10: важные задачи видно сразу.
// Важность берётся из приоритета: критичная две звёздочки, важная (высокий приоритет) одна, остальные без отметки.
// Сменить важность можно прямо на карточке, если у человека есть право менять приоритет задачи.

import { Check, Star } from "lucide-react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import type { PriorityCode } from "@/domain/dictionaries";
import { IMPORTANCE_LABEL, importanceOf } from "@/lib/tasks/roadmap";
import { cn } from "@/lib/cn";

function Stars({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cn("inline-flex items-center", n === 2 ? "text-danger-ink" : "text-warning-ink", className)} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} className="h-4 w-4" fill="currentColor" strokeWidth={1.5} />
      ))}
    </span>
  );
}

/** Звёздочки без действия: для подписи в легенде и для тех, кто важность не меняет */
export function ImportanceMark({ priority, className }: { priority: PriorityCode; className?: string }) {
  const n = importanceOf(priority);
  if (!n) return null;
  return (
    <span className={cn("inline-flex items-center", className)} title={`${IMPORTANCE_LABEL[n]} задача`}>
      <Stars n={n} />
      <span className="sr-only">{IMPORTANCE_LABEL[n]} задача</span>
    </span>
  );
}

const CHOICES: { priority: PriorityCode; label: string; stars: number }[] = [
  { priority: "critical", label: "Критичная", stars: 2 },
  { priority: "high", label: "Важная", stars: 1 },
  { priority: "medium", label: "Обычная", stars: 0 },
  { priority: "low", label: "Низкая", stars: 0 },
];

/**
 * Кнопка важности на карточке: звёздочки или контур звезды, если задача обычная. Меню из четырёх уровней.
 * subject: о какой задаче, для экранного диктора
 */
export function ImportanceMenu({ priority, subject, onChange }: { priority: PriorityCode; subject: string; onChange: (next: PriorityCode) => void }) {
  const n = importanceOf(priority);
  return (
    <Menu.Root>
      <Menu.Trigger
        className="sv-icon-btn sv-icon-btn--sm shrink-0"
        aria-label={`Важность ${subject}: ${IMPORTANCE_LABEL[n].toLowerCase()}. Изменить`}
        title="Важность задачи"
      >
        {n ? <Stars n={n} /> : <Star className="h-4 w-4 text-icon" strokeWidth={1.5} aria-hidden="true" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
          <Menu.Label className="sv-menu__group">Важность</Menu.Label>
          {CHOICES.map((c) => (
            <Menu.Item key={c.priority} onSelect={() => c.priority !== priority && onChange(c.priority)} className="sv-menu__item cursor-pointer select-none justify-between outline-none data-[highlighted]:bg-field">
              <span className="inline-flex items-center gap-2">
                {c.label}
                <Stars n={c.stars} />
              </span>
              {c.priority === priority ? <Check className="h-4 w-4 text-blue-700" aria-label="выбрано" /> : null}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
