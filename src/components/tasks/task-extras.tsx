"use client";

// Карточка задачи, этап 16: полоса истории статусов, подписка на задачу и «Попросить обновить».

import { useEffect, useState } from "react";
import { Bell, BellOff, MessageSquareMore } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { StatusCode } from "@/domain/dictionaries";
import type { Task } from "@/domain/types";
import { requestUpdateAction, taskExtrasAction, watchTaskAction, type TaskExtras } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { HandOverButton } from "./task-waits";

const TONE: Record<StatusCode, string> = {
  proposed: "bg-mist",
  "in-progress": "bg-blue",
  clarify: "bg-amber",
  done: "bg-green",
  partial: "bg-orange",
  failed: "bg-danger",
  cancelled: "bg-line",
};

/** «12 дн.», «меньше дня» */
function daysText(days: number): string {
  if (days < 1) return "меньше дня";
  return `${Math.round(days)} дн.`;
}

export function TaskExtrasBlock({ task, headingLevel = "h3" }: { task: Task; headingLevel?: "h2" | "h3" }) {
  const { notify, observer } = usePrototype();
  const [extras, setExtras] = useState<TaskExtras | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    taskExtrasAction(task.number)
      .then((r) => alive && r.ok && setExtras(r.extras))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [task.number, task.status, task.updatedAt]);
  if (!extras) return null;
  const H = headingLevel;
  const total = extras.spans.reduce((s, x) => s + x.days, 0) || 1;

  const toggleWatch = async () => {
    setBusy(true);
    const r = await watchTaskAction(task.number, !extras.watching);
    setBusy(false);
    if (!r.ok) return notify(r.error, "error");
    setExtras({ ...extras, watching: r.value.watching });
    notify(r.value.watching ? "Вы следите за задачей: смена статуса и срока придёт в «Мне»" : "Вы больше не следите за задачей");
  };
  const ask = async () => {
    setBusy(true);
    const r = await requestUpdateAction(task.number);
    setBusy(false);
    if (!r.ok) return notify(r.error, "error");
    notify(`Просьба ушла: ${r.value.asked}`);
  };

  return (
    <section aria-labelledby={`spans-${task.number}`} className="flex flex-col gap-3">
      {extras.spans.length ? (
        <div>
          <H id={`spans-${task.number}`} className="text-sm font-medium text-ink">
            Сколько была в каждом статусе
          </H>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-field" aria-hidden="true">
            {extras.spans.map((s) => (
              <span key={s.status} className={cn("h-full", TONE[s.status])} style={{ width: `${Math.max(3, (s.days / total) * 100)}%` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink">
            {extras.spans.map((s) => (
              <li key={s.status} className="inline-flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", TONE[s.status])} aria-hidden="true" />
                {s.label}: {daysText(s.days)}
                {s.current ? <span className="text-muted">(сейчас)</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <H id={`spans-${task.number}`} className="sr-only">
          Подписка на задачу
        </H>
      )}
      {!observer ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={toggleWatch} disabled={busy} aria-pressed={extras.watching}>
            {extras.watching ? <BellOff className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
            {extras.watching ? "Не следить" : "Следить за задачей"}
          </Button>
          <HandOverButton task={task} />
          {extras.canAsk ? (
            <Button size="sm" variant="secondary" onClick={ask} disabled={busy}>
              <MessageSquareMore className="h-4 w-4" aria-hidden="true" />
              Попросить обновить
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
