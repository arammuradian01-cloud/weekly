"use client";

// Просьбы в карточке задачи (этап 21): кого и о чём попросили по задаче, кнопка «Попросить коллегу».

import { useEffect, useState } from "react";
import type { RequestView } from "@/domain/requests";
import type { Task } from "@/domain/types";
import { isClosed } from "@/lib/tasks/rules";
import { taskRequestsAction } from "@/app/(app)/requests/actions";
import { RequestRow } from "./request-list";
import { AskColleagueButton, REQUESTS_CHANGED } from "./request-dialog";

export function TaskRequests({ task, headingLevel = "h3" }: { task: Task; headingLevel?: "h2" | "h3" }) {
  const [items, setItems] = useState<RequestView[] | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener(REQUESTS_CHANGED, again);
    return () => window.removeEventListener(REQUESTS_CHANGED, again);
  }, []);
  useEffect(() => {
    let alive = true;
    taskRequestsAction(task.number)
      .then((r) => alive && r.ok && setItems(r.value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [task.number, task.updatedAt, tick]);
  const H = headingLevel;
  const closed = isClosed(task);
  return (
    <section aria-labelledby={`requests-${task.number}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H id={`requests-${task.number}`} className="text-sm font-medium text-ink">
          Просьбы по задаче{items?.length ? ` ${items.length}` : ""}
        </H>
        {!closed && !task.archived ? <AskColleagueButton size="sm" prefill={{ task: { number: task.number, title: task.title } }} /> : null}
      </div>
      {items?.length ? (
        <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft">
          {items.map((r) => (
            <RequestRow key={r.number} request={r} mode="any" />
          ))}
        </ul>
      ) : (
        <p className="text-small text-muted">Если задача ждёт кого-то, попросите его здесь: просьба придёт ему в «Мне», ответ и срок будут видны в карточке.</p>
      )}
    </section>
  );
}
