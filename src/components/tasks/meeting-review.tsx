"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { personOf } from "@/domain/people";
import { teamOf } from "@/domain/teams";
import { formatLong, formatShort } from "@/domain/dates";
import { isClosedThisWeek, isOverdue, overdueDays } from "@/domain/rules";
import type { PersonSlug, Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { OverdueNote, StatusBadge } from "@/components/ui/task-badges";
import { openNewTask } from "@/components/prototype/new-task";
import { PrioritySelect, StateSelect, StatusSelect } from "./task-fields";
import { useOpenTask } from "./task-drawer";

/** Разбор на встрече: по каждому лидеру подряд критичные, просроченные, заблокированные и закрытые за неделю */
export function MeetingReview() {
  const { data, manage, teamPeople, team } = usePrototype();
  // Выключенные с открытыми задачами тоже разбираются: их задачи надо передать
  const gone = [...new Set(data.teamTasks.filter((t) => t.owner !== "all" && !t.archived && (t.status === "in-progress" || t.status === "clarify") && !teamPeople.some((p) => p.slug === t.owner)).map((t) => t.owner))];
  // Руководителя выбранной команды не разбираем: встречу ведёт он сам
  const leader = teamOf(team.id)?.leader;
  const order = [...teamPeople.filter((p) => p.slug !== leader && p.role !== "OWNER").map((p) => p.slug), ...gone];
  const params = useSearchParams();
  const [index, setIndex] = useState(() => Math.max(0, order.indexOf(params.get("person") as PersonSlug)));
  if (!order.length) return <p className="rounded-xl bg-surface px-5 py-4 text-body text-muted">В команде пока некого разбирать: добавьте участников в разделе «Структура».</p>;
  // После переключения команды очередь короче: остаёмся в её пределах
  const current = Math.min(index, order.length - 1);
  const slug = order[current]!;
  const person = personOf(slug);
  const own = (t: Task) => (t.owner === slug || t.owner === "all") && !t.archived;

  const blocks: { key: string; title: string; empty: string; tasks: Task[] }[] = [
    { key: "critical", title: "Критичные", empty: "Критичных задач нет", tasks: data.teamTasks.filter((t) => own(t) && t.priority === "critical" && (t.status === "in-progress" || t.status === "clarify")) },
    { key: "overdue", title: "Просроченные", empty: "Просроченных нет", tasks: data.teamTasks.filter((t) => own(t) && isOverdue(t, data.today)) },
    { key: "blocked", title: "Заблокированные", empty: "Заблокированных нет", tasks: data.teamTasks.filter((t) => own(t) && t.state === "blocked" && (t.status === "in-progress" || t.status === "clarify")) },
    { key: "closed", title: "Закрыто за неделю", empty: "За неделю ничего не закрыто", tasks: data.teamTasks.filter((t) => own(t) && isClosedThisWeek(t, data.today)) },
  ];

  const attention = (s: PersonSlug) =>
    data.teamTasks.filter((t) => (t.owner === s || t.owner === "all") && (isOverdue(t, data.today) || (t.state === "blocked" && t.status === "in-progress"))).length;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <ol className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Очередь лидеров">
          {order.map((s, i) => {
            const n = attention(s);
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={i === current ? "step" : undefined}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 text-small transition-colors",
                    i === current ? "bg-navy font-semibold text-white" : "bg-white text-ink ring-1 ring-line hover:ring-navy-600/40",
                  )}
                >
                  {personOf(s).shortName}
                  {n ? (
                    <span className={cn("rounded-full px-1.5 text-tiny tabular-nums", i === current ? "bg-white/15" : "bg-danger-soft text-danger-ink")}>{n}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-small text-muted">Встреча {formatLong(data.today)}. Цифра у имени: просроченные и заблокированные.</p>
      </div>

      <section aria-labelledby="review-person" className="rounded-xl ring-1 ring-line">
        <header className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="review-person" className="text-headline-sm font-semibold text-ink">{person.fullName}</h2>
            <p className="text-small text-muted">{person.zone}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {manage ? (
              <Button size="sm" onClick={() => openNewTask({ source: "meeting", sourceNote: `Встреча ${formatShort(data.today)}` })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Задача со встречи
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setIndex(Math.max(0, current - 1))} disabled={current === 0} aria-label="Предыдущий лидер">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setIndex(Math.min(order.length - 1, current + 1))} disabled={current === order.length - 1}>
              Следующий
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className="grid divide-y divide-line lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          {[blocks.slice(0, 2), blocks.slice(2)].map((col, ci) => (
            <div key={ci} className="divide-y divide-line">
              {col.map((b) => (
                <ReviewBlock key={b.key} title={b.title} empty={b.empty} tasks={b.tasks} danger={b.key === "overdue" || b.key === "blocked"} />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewBlock({ title, empty, tasks, danger }: { title: string; empty: string; tasks: Task[]; danger?: boolean }) {
  const { data } = usePrototype();
  const { open } = useOpenTask();
  return (
    <section className="px-5 py-4">
      <h3 className="flex items-center gap-2 text-lead font-semibold text-ink">
        {title}
        <span className={cn("text-small font-normal tabular-nums", danger && tasks.length ? "text-danger-ink" : "text-muted")}>{tasks.length}</span>
      </h3>
      {tasks.length === 0 ? (
        <p className="mt-2 text-small text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-line">
          {tasks.map((t) => (
            <li key={t.number} className="py-2.5">
              <button type="button" onClick={() => open(t.number)} className="text-left text-body font-medium leading-snug text-ink hover:text-blue-700 hover:underline">
                <span className="mr-1.5 font-normal tabular-nums text-muted">{t.number}</span>
                {t.title}
              </button>
              <p className="mt-0.5 text-caption text-muted">{t.state === "blocked" && t.blockedBy ? t.blockedBy : t.state === "at-risk" && t.riskNote ? `Риск. Вернёт в график: ${t.riskNote}` : t.resolution && t.closedAt ? t.resolution : t.where}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-4">
                {t.closedAt ? <StatusBadge status={t.status} /> : <StatusSelect task={t} />}
                {!t.closedAt ? <StateSelect task={t} /> : null}
                {!t.closedAt ? <PrioritySelect task={t} /> : null}
                <span className="text-caption tabular-nums text-muted">
                  {t.closedAt ? `закрыта ${formatShort(t.closedAt)}` : `срок ${formatShort(t.due)}`}
                </span>
                {isOverdue(t, data.today) ? <OverdueNote days={overdueDays(t, data.today)} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
