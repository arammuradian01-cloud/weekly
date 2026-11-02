// Переключатель недель на экране сдачи weekly (этап 73+81): отчётная и прошлые недели с состоянием каждой. Ссылками,
// без состояния: подходит серверу, работает без JavaScript и на телефоне 360 переносится строками.

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatLong } from "@/domain/dates";
import { SUBMIT_WEEK_LABEL } from "@/lib/weekly/rules";
import type { SubmitWeekOption } from "@/lib/weekly/submit-weeks";
import { buttonClass } from "@/components/ui/button";

/** older: неделя перед списком. null: дошли до самой старой недели ресурса, листать дальше некуда */
export function SubmitWeeks({ weeks, selected, older }: { weeks: SubmitWeekOption[]; selected: string; older: string | null }) {
  return (
    <nav aria-label="Неделя weekly" className="mb-5 flex min-w-0 flex-wrap items-center gap-2" data-testid="submit-weeks">
      {weeks.map((w) => {
        const active = w.key === selected;
        return (
          <Link
            key={w.key}
            href={`/weekly/submit?week=${w.key}`}
            aria-current={active ? "page" : undefined}
            data-testid={`submit-week-${w.key}`}
            className={cn(
              "inline-flex min-h-11 flex-col justify-center rounded-lg px-3 py-1.5 text-small",
              active ? "bg-accent-soft font-semibold text-ink" : "text-ink hover:bg-field",
            )}
            title={`${formatLong(w.start)} - ${formatLong(w.end)}`}
          >
            <span>
              Неделя {w.number}
              {w.reporting ? " (отчётная)" : ""}
            </span>
            <span className={cn("text-caption font-normal", w.state === "not-started" || w.state === "closed" ? "text-muted" : "text-text-secondary")}>{SUBMIT_WEEK_LABEL[w.state]}</span>
          </Link>
        );
      })}
      {/* Недели старше списка открываются по одной: ресурс живёт не первый месяц, а список недель на экране короткий */}
      {older ? (
        <Link href={`/weekly/submit?week=${older}`} className={buttonClass("ghost", "sm")} aria-label="Открыть неделю раньше списка">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Раньше
        </Link>
      ) : null}
    </nav>
  );
}
