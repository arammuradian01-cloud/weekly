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
  // Этап 36: таблица вместо карточек. Цифры по человеку в колонках, задачи плашками в последней колонке
  return (
    <div className="sv-card sv-card--soft overflow-x-auto p-0">
      <table className="sv-datatable sv-datatable--stack" data-testid="task-people">
        <caption className="sr-only">Открытые задачи по людям команды</caption>
        <thead>
          <tr>
            <th scope="col">Человек</th>
            <th scope="col" className="is-num">
              Открыто
            </th>
            <th scope="col" className="is-num">
              Просрочено
            </th>
            <th scope="col" className="is-num">
              Заблокировано
            </th>
            <th scope="col">Задачи по сроку</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const mine = open.filter((t) => t.owner === p.slug).sort((a, b) => a.due.localeCompare(b.due));
            const late = mine.filter((t) => isOverdue(t, data.today)).length;
            const blocked = mine.filter((t) => t.state === "blocked").length;
            return (
              <tr key={p.slug} data-testid={`task-people-${p.slug}`}>
                <td className="is-wide">
                  <span className="sv-datatable__strong">{p.fullName}</span>
                  <div className="mt-1.5 h-1.5 w-full max-w-40 rounded-full bg-field" aria-hidden="true">
                    <div className={cn("h-full rounded-full", late ? "bg-danger" : "bg-blue")} style={{ width: `${(mine.length / max) * 100}%` }} />
                  </div>
                </td>
                <td className="is-num" data-label="Открыто">
                  {mine.length}
                </td>
                <td className="is-num" data-label="Просрочено">
                  {late ? <span className="font-semibold text-danger-ink">{late}</span> : <span className="sv-datatable__muted">0</span>}
                </td>
                <td className="is-num" data-label="Заблокировано">
                  {blocked || <span className="sv-datatable__muted">0</span>}
                </td>
                <td className="sv-task-people__chips" data-label="Задачи">
                  {mine.length ? (
                    <ul className="flex flex-wrap gap-2">
                      {mine.map((t) => (
                        <li key={t.number}>
                          <Chip task={t} today={data.today} onOpen={() => openTask.open(t.number)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-small text-muted">Открытых задач нет</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
