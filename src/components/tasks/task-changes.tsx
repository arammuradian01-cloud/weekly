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
        <ol className="flex flex-col divide-y divide-line sv-card sv-card--soft">
          {shown.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 px-4 py-3">
              <button type="button" onClick={() => openTask.open(c.number)} className="self-start text-left text-body font-medium text-ink hover:underline">
                <span className="mr-1.5 font-normal tabular-nums text-muted">{c.number}</span>
                {c.title}
              </button>
              <p className="text-small text-ink">
                <span className="text-muted">{c.kind === "new" ? "Новая задача" : c.field}: </span>
                {c.before && c.kind !== "new" ? (
                  <>
                    <span className="text-muted line-through decoration-1">{c.before}</span>
                    <span className="text-muted">, теперь </span>
                  </>
                ) : null}
                {c.after}
              </p>
              <p className="text-caption text-muted">
                {c.by}, {when(c.at)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="За неделю в задачах команды ничего не менялось">Здесь появятся новые, закрытые и перенесённые задачи и смена статусов.</EmptyState>
      )}
    </div>
  );
}
