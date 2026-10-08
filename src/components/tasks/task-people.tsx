"use client";

// Вид «По людям» (этап 16): строка на человека выбранной команды, в ней его открытые задачи плашками по сроку.
// Так видны перегруз и простой: у кого десять задач и половина просрочена, а у кого ни одной.

import { usePrototype } from "@/domain/store";
import { formatShort } from "@/domain/dates";
import { personOf } from "@/domain/people";
import { isOverdue, isStale } from "@/domain/rules";
import type { PersonSlug, Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/components/empty-state";
import { useOpenTask } from "./task-drawer";

const OPEN = ["proposed", "in-progress", "clarify"];

export function TaskPeople() {
  const { data, teamPeople } = usePrototype();
  const openTask = useOpenTask();
  const open = data.teamTasks.filter((t) => OPEN.includes(t.status) && !t.archived && t.owner !== "all");
  // Люди команды по порядку, потом ответственные задач команды не из её состава
  const extra = [...new Set(open.map((t) => t.owner as PersonSlug).filter((s) => !teamPeople.some((p) => p.slug === s)))].map(personOf);
  const people = [...teamPeople, ...extra];
  if (!people.length) return <EmptyState title="В команде пока нет людей">Состав команды задаётся на странице «Структура».</EmptyState>;
  const max = Math.max(1, ...people.map((p) => open.filter((t) => t.owner === p.slug).length));
  return (
    <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft">
      {people.map((p) => {
        const mine = open.filter((t) => t.owner === p.slug).sort((a, b) => a.due.localeCompare(b.due));
        const late = mine.filter((t) => isOverdue(t, data.today)).length;
        return (
          <li key={p.slug} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-start lg:gap-6">
            <div className="lg:w-56 lg:shrink-0">
              <p className="text-body font-semibold text-ink">{p.fullName}</p>
              <p className="text-small text-muted">
                открытых {mine.length}
                {late ? <span className="text-danger-ink">, просрочено {late}</span> : null}
              </p>
              <div className="mt-1.5 h-1.5 w-full max-w-40 rounded-full bg-field" aria-hidden="true">
                <div className={cn("h-full rounded-full", late ? "bg-danger" : "bg-blue")} style={{ width: `${(mine.length / max) * 100}%` }} />
              </div>
            </div>
            {mine.length ? (
              <ul className="flex flex-wrap gap-2">
                {mine.map((t) => (
                  <li key={t.number}>
                    <Chip task={t} today={data.today} onOpen={() => openTask.open(t.number)} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-small text-muted">Открытых задач нет</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Chip({ task: t, today, onOpen }: { task: Task; today: string; onOpen: () => void }) {
  const overdue = isOverdue(t, today);
  const stale = isStale(t, today);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={t.title}
      className={cn(
        "flex max-w-64 flex-col items-start rounded-lg px-3 py-2 text-left ring-1 transition-colors hover:ring-border-strong",
        overdue ? "bg-danger-soft ring-danger/30" : t.status === "proposed" ? "bg-surface ring-line" : t.status === "clarify" ? "bg-warning-soft ring-warning-line" : "bg-surface ring-line",
      )}
    >
      <span className="line-clamp-2 text-small font-medium text-ink">
        <span className="mr-1 tabular-nums text-muted">{t.number}</span>
        {t.title}
      </span>
      <span className={cn("mt-0.5 text-caption tabular-nums", overdue ? "font-semibold text-danger-ink" : "text-muted")}>
        до {formatShort(t.due)}
        {t.status === "proposed" ? ", предложена" : t.status === "clarify" ? ", требует уточнений" : ""}
        {t.state === "blocked" ? ", заблокирована" : ""}
        {stale ? ", давно без обновлений" : ""}
      </span>
    </button>
  );
}
