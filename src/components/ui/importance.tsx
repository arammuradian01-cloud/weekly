"use client";

// Отметка важности задачи (этап 56): звёздочки на доске roadmap. Решение Арама 21.10: важные задачи видно сразу.
// Важность берётся из приоритета: критичная две звёздочки, важная (высокий приоритет) одна, остальные без отметки.
// Сменить важность можно прямо на карточке тем, кто может менять приоритет: автор, ответственный, руководитель
// команды задачи и режим управления. Меню монтируется только по первому нажатию: на доске сотни карточек.

import { useState } from "react";
import { Star } from "lucide-react";
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

/** Звёздочки без действия: для тех, кто важность не меняет. decorative: подпись рядом уже есть (легенда) */
export function ImportanceMark({ priority, className, decorative = false }: { priority: PriorityCode; className?: string; decorative?: boolean }) {
  const n = importanceOf(priority);
  if (!n) return null;
  return (
    <span className={cn("inline-flex items-center", className)} title={decorative ? undefined : `${IMPORTANCE_LABEL[n]} задача`}>
      <Stars n={n} />
      {decorative ? null : <span className="sr-only">{IMPORTANCE_LABEL[n]} задача</span>}
    </span>
  );
}

const CHOICES: { priority: PriorityCode; label: string; stars: number }[] = [
  { priority: "critical", label: "Критичная", stars: 2 },
  { priority: "high", label: "Важная", stars: 1 },
  { priority: "medium", label: "Обычная", stars: 0 },
  { priority: "low", label: "Низкая", stars: 0 },
];

/** Подпись уровня для кнопки и тоста: «не задана» отдельно от обычной */
export function importanceWord(priority: PriorityCode): string {
  if (priority === "unset") return "не задана";
  return (CHOICES.find((c) => c.priority === priority)?.label ?? "Обычная").toLowerCase();
}

/**
 * Кнопка важности на карточке: звёздочки или контур звезды, если задача без отметки. Меню из четырёх уровней.
 * subject: о какой задаче, для экранного диктора
 */
export function ImportanceMenu({ priority, subject, onChange }: { priority: PriorityCode; subject: string; onChange: (next: PriorityCode) => void }) {
  const [armed, setArmed] = useState(false);
  const n = importanceOf(priority);
  const icon = n ? <Stars n={n} /> : <Star className="h-4 w-4 text-icon" strokeWidth={1.5} aria-hidden="true" />;
  const label = `Важность ${subject}: ${importanceWord(priority)}. Изменить`;
  // До первого нажатия обычная кнопка: Radix-меню на каждой из сотен карточек тормозит доску
  if (!armed) {
    return (
      <button type="button" className="sv-icon-btn sv-icon-btn--sm shrink-0" aria-label={label} aria-haspopup="menu" title="Важность задачи" onClick={() => setArmed(true)}>
        {icon}
      </button>
    );
  }
  return (
    <Menu.Root defaultOpen>
      <Menu.Trigger className="sv-icon-btn sv-icon-btn--sm shrink-0" aria-label={label} title="Важность задачи">
        {icon}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
          <Menu.Label className="sv-menu__group">Важность</Menu.Label>
          <Menu.RadioGroup value={priority} onValueChange={(v) => v !== priority && onChange(v as PriorityCode)}>
            {CHOICES.map((c) => (
              <Menu.RadioItem key={c.priority} value={c.priority} className="sv-menu__item cursor-pointer select-none justify-between outline-none data-[state=checked]:font-semibold">
                <span className="inline-flex items-center gap-2">
                  {c.label}
                  <Stars n={c.stars} />
                </span>
                <Menu.ItemIndicator className="text-small text-blue-700">выбрано</Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
