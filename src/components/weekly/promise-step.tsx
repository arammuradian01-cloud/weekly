"use client";

// Шаг «Что вы обещали на прошлой неделе» в сдаче weekly (этап 22, модуль М6). Планы прошлого weekly: итог и одна
// фраза, невыполненное одной кнопкой в план этого weekly, через неделю оно снова придёт сюда. Задачи со сроком на неделе:
// итог это статус задачи, здесь же её закрывают или переносят срок.

import { useState } from "react";
import { ArrowDownToLine, Pencil } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { formatShort } from "@/domain/dates";
import type { Task, WeekInfo, WeeklyEntry } from "@/domain/types";
import { carryPromiseAction, reviewPromiseAction } from "@/app/(app)/weekly/actions";
import {
  PROMISE_NOTE_MAX,
  PROMISE_RESULTS,
  canCarry,
  promiseNeedsNote,
  promiseNoteHint,
  promiseResultOf,
  taskPromiseOutcome,
  type EntryPromise,
  type PromiseResultCode,
  type TaskPromiseOutcome,
} from "@/lib/weekly/promises";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented, TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/task-badges";
import { StatusSelect, useTaskPermissions } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { cn } from "@/lib/cn";

type Range = { start: string; end: string };

export function PromiseStep({
  week,
  promises,
  setPromises,
  tasks,
  canEdit,
  onCarried,
}: {
  week: WeekInfo;
  promises: EntryPromise[];
  setPromises: (update: (prev: EntryPromise[]) => EntryPromise[]) => void;
  tasks: Task[];
  canEdit: boolean;
  /** Обещание перенесено: новая запись плана появляется в шаге «Главное за неделю» этого weekly */
  onCarried: (entry: WeeklyEntry) => void;
}) {
  const range = { start: week.start, end: week.end };
  if (!promises.length && !tasks.length) {
    return (
      <p className="text-body text-muted">
        Обещаний с прошлой недели нет. Сюда попадают записи «План» и «Что делаем дальше» из прошлого weekly и ваши задачи со сроком на этой неделе.
      </p>
    );
  }
  const replace = (p: EntryPromise) => setPromises((prev) => prev.map((x) => (x.entryId === p.entryId ? p : x)));
  return (
    <div className="flex flex-col gap-6">
      {promises.length ? (
        <section aria-labelledby="promises-plans" className="flex flex-col gap-3">
          <h3 id="promises-plans" className="text-lead font-semibold text-ink">
            Планы прошлой недели <span className="font-normal text-muted">{promises.length}</span>
          </h3>
          <ul className="flex flex-col gap-3">
            {promises.map((p) => (
              <PromiseRow key={p.entryId} promise={p} canEdit={canEdit} onChange={replace} onCarried={onCarried} />
            ))}
          </ul>
        </section>
      ) : null}
      {tasks.length ? (
        <section aria-labelledby="promises-tasks" className="flex flex-col gap-3">
          <h3 id="promises-tasks" className="text-lead font-semibold text-ink">
            Задачи со сроком на неделе <span className="font-normal text-muted">{tasks.length}</span>
          </h3>
          <p className="text-small text-muted">Итог задачи это её статус. Закройте сделанное или перенесите срок с причиной.</p>
          <ul className="divide-y divide-line sv-card sv-card--soft">
            {tasks.map((t) => (
              <PromiseTaskRow key={t.number} task={t} range={range} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ResultBadge({ result }: { result: PromiseResultCode }) {
  const r = promiseResultOf(result);
  return <Badge tone={r.tone}>{r.label}</Badge>;
}

function PromiseRow({
  promise,
  canEdit,
  onChange,
  onCarried,
}: {
  promise: EntryPromise;
  canEdit: boolean;
  onChange: (p: EntryPromise) => void;
  onCarried: (entry: WeeklyEntry) => void;
}) {
  const { notify } = usePrototype();
  const review = promise.review;
  const [editing, setEditing] = useState(!review);
  const [result, setResult] = useState<PromiseResultCode | "">(review?.result ?? "");
  const [note, setNote] = useState(review?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = `promise-${promise.entryId}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!result) return setError("Выберите итог");
    if (promiseNeedsNote(result) && !note.trim()) return setError(`Напишите одной фразой: ${promiseNoteHint(result).toLowerCase()}`);
    setBusy(true);
    setError(null);
    try {
      const r = await reviewPromiseAction(promise.entryId, result, note.trim() || null);
      if (!r.ok) return setError(r.error);
      onChange(r.value);
      setEditing(false);
      notify("Итог сохранён");
    } catch {
      setError("Нет связи с сервером: итог не сохранился");
    } finally {
      setBusy(false);
    }
  };

  const carry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await carryPromiseAction(promise.entryId);
      if (!r.ok) return notify(r.error, "error");
      onChange(r.value.promise);
      onCarried(r.value.entry);
      notify("Перенесено в план");
    } catch {
      notify("Нет связи с сервером: не перенеслось", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-3 sv-card sv-card--soft px-4 py-3">
      <div>
        <p id={`${id}-what`} className="text-body font-medium text-ink">
          {promise.what}
        </p>
        <p className="mt-0.5 text-caption text-muted">{promise.kind === "plan" ? "План" : `Что делаем дальше к записи «${promise.from}»`}</p>
      </div>
      {editing && canEdit ? (
        <form onSubmit={save} className="flex flex-col gap-3" aria-labelledby={`${id}-what`}>
          <Segmented<PromiseResultCode | "">
            label={`Итог: ${promise.what.slice(0, 80)}`}
            value={result}
            onChange={(v) => {
              setResult(v);
              setError(null);
            }}
            options={PROMISE_RESULTS.map((r) => ({ value: r.code, label: r.label }))}
            className="flex-wrap self-start"
          />
          <TextInput
            label={result ? promiseNoteHint(result) : "Одной фразой"}
            id={`${id}-note`}
            value={note}
            maxLength={PROMISE_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            hint={result && !promiseNeedsNote(result) ? "Можно не писать" : undefined}
          />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {review ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setResult(review.result);
                  setNote(review.note ?? "");
                  setError(null);
                  setEditing(false);
                }}
              >
                Отмена
              </Button>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить итог"}
            </Button>
          </div>
        </form>
      ) : review ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <p className="flex flex-wrap items-center gap-2 text-body text-ink">
            <ResultBadge result={review.result} />
            {review.note ? <span>{review.note}</span> : null}
          </p>
          {canEdit ? (
            <div className="flex shrink-0 flex-wrap gap-1">
              {canCarry(review.result) && !review.carried ? (
                <Button size="sm" variant="secondary" onClick={() => void carry()} disabled={busy} aria-label={`Перенести в план: ${promise.what.slice(0, 80)}`}>
                  <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
                  Перенести в план
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Изменить итог: ${promise.what.slice(0, 80)}`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Изменить
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-small text-muted">Итог не поставлен</p>
      )}
      {review?.carried ? <p className="text-caption text-muted">Перенесено в план этого weekly: «{review.carried.what}»</p> : null}
    </li>
  );
}

function outcomeText(o: TaskPromiseOutcome, task: Task, today: string): string {
  if (o.result === "moved") return `Срок перенесён на ${formatShort(task.due)}${o.note ? `: ${o.note}` : ""}`;
  if (o.result === "open") return task.due < today ? "Срок прошёл: закройте задачу или перенесите срок" : "Срок на этой неделе, итога пока нет";
  if (o.result === "overdue") return "Неделя прошла, задача не закрыта: закройте её или перенесите срок";
  return o.note ?? "";
}

/** Итог задачи считается «не сделано»: перенесли, закрыли позже недели или неделя прошла, а задача открыта */
const NOT_DONE_TASK = new Set<TaskPromiseOutcome["result"]>(["moved", "late", "overdue"]);

function PromiseTaskRow({ task, range }: { task: Task; range: Range }) {
  const { open } = useOpenTask();
  const { data } = usePrototype();
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  const o = taskPromiseOutcome(task, range, data.today);
  const settled = o.result === "done" || o.result === "partial" || o.result === "not-done" || o.result === "dropped";
  const closed = settled || o.result === "late";
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3", (o.result === "open" || o.result === "overdue") && "bg-field")}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <button type="button" onClick={() => open(task.number)} className="text-left text-body font-medium leading-snug text-ink hover:text-blue-700 hover:underline">
          <span className="mr-1.5 font-normal tabular-nums text-muted">{task.number}</span>
          {task.title}
        </button>
        <span className={cn("shrink-0 text-caption tabular-nums", (o.result === "open" || o.result === "overdue") && task.due < data.today ? "font-semibold text-danger-ink" : "text-muted")}>срок {formatShort(task.due)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {settled ? <ResultBadge result={o.result as PromiseResultCode} /> : NOT_DONE_TASK.has(o.result) ? <Badge tone="red">Не сделано</Badge> : null}
        {closed ? <StatusBadge status={task.status} /> : <StatusSelect task={task} />}
        {!closed && can.due ? (
          <Button size="sm" variant="ghost" onClick={() => actions.transfer(task)}>
            Перенести срок
          </Button>
        ) : null}
      </div>
      {outcomeText(o, task, data.today) ? <p className="text-small text-muted">{outcomeText(o, task, data.today)}</p> : null}
    </li>
  );
}
