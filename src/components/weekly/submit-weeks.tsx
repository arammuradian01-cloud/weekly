// Переключатель недель экрана сдачи (этап 73): отчётная и прошлые недели, у каждой состояние своего weekly: «сдан»,
// «сдан с опозданием», «черновик», «не сдан», «закрыта». Будущих недель нет. На телефоне строка листается вбок внутри
// себя, страница вбок не прокручивается.

import Link from "next/link";
import { Lock } from "lucide-react";
import { formatShort } from "@/domain/dates";
import { SUBMIT_WEEK_LABEL, type SubmitWeekState } from "@/lib/weekly/rules";
import type { SubmitWeekOption } from "@/lib/weekly/submit-weeks";
import { cn } from "@/lib/cn";

const DOT: Record<SubmitWeekState, string> = {
  submitted: "bg-green",
  late: "bg-warning",
  draft: "bg-accent",
  "not-started": "bg-danger",
  closed: "bg-text-secondary",
};

export function SubmitWeekSwitcher({ weeks, current }: { weeks: SubmitWeekOption[]; current: string }) {
  if (weeks.length < 2) return null;
  return (
    <nav aria-label="Неделя weekly" className="mb-6" data-testid="submit-weeks">
      <ul className="sv-pills sv-pills--phone-scroll m-0 list-none p-0 lg:flex-nowrap lg:overflow-x-auto">
        {weeks.map((w) => {
          const active = w.key === current;
          const state = SUBMIT_WEEK_LABEL[w.state];
          return (
            <li key={w.key} className="flex-none">
              <Link
                href={w.reporting ? "/weekly/submit" : `/weekly/submit?week=${w.key}`}
                aria-current={active ? "page" : undefined}
                aria-label={`Неделя ${w.number}, ${formatShort(w.start)} - ${formatShort(w.end)}${w.reporting ? ", отчётная" : ""}: ${state}${w.closed && w.state !== "closed" ? ", неделя закрыта" : ""}`}
                data-state={w.state}
                className={cn(
                  "flex min-h-12 min-w-[7.5rem] flex-col justify-center rounded-lg border px-3 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  active ? "border-accent-soft-border bg-accent-soft" : "border-line bg-surface hover:bg-field",
                )}
              >
                <span className={cn("text-small font-semibold", active ? "text-link" : "text-ink")}>
                  Неделя {w.number}
                  {w.reporting ? <span className="font-normal text-text-secondary"> отчётная</span> : null}
                </span>
                <span className="inline-flex items-center gap-1.5 text-caption text-text-secondary">
                  {w.closed ? <Lock className="h-3 w-3 shrink-0" aria-hidden="true" /> : <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[w.state])} aria-hidden="true" />}
                  {state}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
