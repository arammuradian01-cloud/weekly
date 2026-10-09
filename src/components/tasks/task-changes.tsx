"use client";

// «Изменилось за неделю» (этап 16): что поменялось в задачах команды за семь дней, по журналу.
// У каждой правки кто и когда поменял, было и стало.

import { useState } from "react";
import type { ChangeKind, TaskChange } from "@/lib/tasks/changes";
import { Chip } from "@/components/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import { useOpenTask } from "./task-drawer";

const KINDS: { kind: ChangeKind; label: string }[] = [
  { kind: "new", label: "Новые" },
  { kind: "closed", label: "Закрытые" },
  { kind: "due", label: "Перенесённые" },
  { kind: "status", label: "Сменили статус" },
  { kind: "owner", label: "Сменили ответственного" },
  { kind: "team", label: "Перешли в другую команду" },
];

function when(iso: string): string {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "short" }).format(at);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(at);
  return `${day}, ${time}`;
}

export function TaskChanges({ since, changes }: { since: string; changes: TaskChange[] }) {
  const [kind, setKind] = useState<ChangeKind | null>(null);
  const openTask = useOpenTask();
  const shown = kind ? changes.filter((c) => c.kind === kind) : changes;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-small text-muted">С {when(since)} по сегодня, по журналу правок</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Какие изменения показать">
        <Chip active={kind === null} onClick={() => setKind(null)} count={changes.length}>
          Все
        </Chip>
        {KINDS.map((k) => {
          const n = changes.filter((c) => c.kind === k.kind).length;
          return n ? (
            <Chip key={k.kind} active={kind === k.kind} onClick={() => setKind(kind === k.kind ? null : k.kind)} count={n}>
              {k.label}
            </Chip>
          ) : null;
        })}
      </div>
      {shown.length ? (
        // Этап 36: журнал как у корректировок прогноза: когда слева, задача, было и стало, кто
        <ol className="sv-log sv-card sv-card--soft" data-testid="task-changes">
          {shown.map((c) => (
            <li key={c.id} className="sv-log__item">
              <span className="sv-log__when">{when(c.at)}</span>
              <div className="sv-log__what">
                <button type="button" onClick={() => openTask.open(c.number)} className="sv-log__title self-start text-left hover:underline">
                  <span className="mr-1.5 font-normal tabular-nums text-muted">{c.number}</span>
                  {c.title}
                </button>
                <span className="sv-log__change">
                  <span className="text-muted">{c.kind === "new" ? "Новая задача" : c.field}:</span>
                  {c.before && c.kind !== "new" ? (
                    <del className="text-muted decoration-1">
                      <span className="sr-only">было </span>
                      {c.before}
                    </del>
                  ) : null}
                  <ins className="font-semibold text-ink no-underline">
                    {c.before && c.kind !== "new" ? <span className="sr-only">стало </span> : null}
                    {c.after}
                  </ins>
                </span>
                <span className="text-caption text-text-secondary">{c.by}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="За неделю в задачах команды ничего не менялось">Здесь появятся новые, закрытые и перенесённые задачи и смена статусов.</EmptyState>
      )}
    </div>
  );
}
