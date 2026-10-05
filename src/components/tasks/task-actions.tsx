"use client";

// Правки задачи с правилами раздела 4 ТЗ: перенос, отмена и «Не выполнена» без причины невозможны,
// для «Выполнена» нужен итог, для «Заблокирована» нужно написать, чем и кто может помочь.

import { createContext, useContext, useState } from "react";
import { usePrototype } from "@/prototype/store";
import { formatLong, type IsoDate } from "@/prototype/dates";
import { priorityOf, stateLabel, statusOf, type PriorityCode, type StateCode, type StatusCode } from "@/prototype/dictionaries";
import { statusNeedsNote } from "@/prototype/rules";
import type { Task } from "@/prototype/types";
import { Modal } from "@/components/ui/overlays";
import { TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type Actions = {
  changeStatus: (task: Task, next: StatusCode) => void;
  changeState: (task: Task, next: StateCode) => void;
  changePriority: (task: Task, next: PriorityCode) => void;
  updateWhere: (task: Task, text: string) => void;
  transfer: (task: Task) => void;
};

type Pending =
  | { kind: "status"; task: Task; next: StatusCode; note: "result" | "reason" }
  | { kind: "blocked"; task: Task }
  | { kind: "transfer"; task: Task };

const ActionsContext = createContext<Actions | null>(null);

export function TaskActionsProvider({ children }: { children: React.ReactNode }) {
  const { updateTask, data, me } = usePrototype();
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [date, setDate] = useState<IsoDate>("");
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPending(null);
    setText("");
    setError(null);
  };

  const applyStatus = (task: Task, next: StatusCode, note?: string) => {
    const closed = next === "done" || next === "failed" || next === "cancelled";
    updateTask(
      task.number,
      { status: next, resolution: note ?? task.resolution, closedAt: closed ? data.today : undefined },
      { field: "Статус", before: statusOf(task.status).label, after: note ? `${statusOf(next).label}. ${note}` : statusOf(next).label },
      `Задача ${task.number}: ${statusOf(next).label.toLowerCase()}`,
    );
  };

  const actions: Actions = {
    changeStatus: (task, next) => {
      const note = statusNeedsNote(next);
      if (note) {
        setPending({ kind: "status", task, next, note });
        return;
      }
      applyStatus(task, next);
    },
    changeState: (task, next) => {
      if (next === "blocked") {
        setText(task.blockedBy ?? "");
        setPending({ kind: "blocked", task });
        return;
      }
      updateTask(task.number, { state: next, blockedBy: undefined }, { field: "Состояние", before: stateLabel(task.state), after: stateLabel(next) });
    },
    changePriority: (task, next) =>
      updateTask(task.number, { priority: next }, { field: "Приоритет", before: priorityOf(task.priority).label, after: priorityOf(next).label }),
    updateWhere: (task, value) =>
      updateTask(task.number, { where: value, whereUpdatedAt: data.today }, { field: "Где сейчас", before: task.where, after: value }),
    transfer: (task) => {
      setDate(task.due);
      setPending({ kind: "transfer", task });
    },
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    if (pending.kind === "transfer") {
      if (!date || date === pending.task.due) return setError("Выберите новый срок");
      if (!text.trim()) return setError("Без причины перенести нельзя");
      const t = pending.task;
      updateTask(
        t.number,
        { due: date, transfers: [...t.transfers, { from: t.due, to: date, by: me.slug, reason: text.trim(), at: data.today }] },
        { field: "Срок", before: formatLong(t.due), after: `${formatLong(date)}. Причина: ${text.trim()}` },
        `Срок задачи ${t.number} перенесён`,
      );
      return close();
    }
    if (!text.trim()) {
      return setError(
        pending.kind === "blocked"
          ? "Напишите, чем заблокирована задача и кто может помочь"
          : pending.note === "result"
            ? "Нужен короткий итог или ссылка на результат"
            : "Без причины так закрыть задачу нельзя",
      );
    }
    if (pending.kind === "blocked") {
      updateTask(
        pending.task.number,
        { state: "blocked", blockedBy: text.trim() },
        { field: "Состояние", before: stateLabel(pending.task.state), after: `Заблокирована. ${text.trim()}` },
      );
    } else {
      applyStatus(pending.task, pending.next, text.trim());
    }
    close();
  };

  const title =
    pending?.kind === "transfer"
      ? `Перенести срок задачи ${pending.task.number}`
      : pending?.kind === "blocked"
        ? `Задача ${pending.task.number} заблокирована`
        : pending
          ? `Задача ${pending.task.number}: ${statusOf(pending.next).label.toLowerCase()}`
          : "";

  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <Modal open={pending !== null} onOpenChange={(o) => !o && close()} title={title} description={pending?.task.title}>
        {pending ? (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {pending.kind === "transfer" ? (
              <>
                <TextInput
                  label="Новый срок"
                  id="tr-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  hint={`Сейчас ${formatLong(pending.task.due)}. Исходный срок ${formatLong(pending.task.originalDue)} сохранится`}
                />
                <TextArea label="Причина переноса" id="tr-reason" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
              </>
            ) : (
              <TextArea
                label={pending.kind === "blocked" ? "Чем заблокирована и кто может помочь" : pending.note === "result" ? "Итог или ссылка на результат" : "Причина"}
                id="st-note"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
              />
            )}
            {error ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger-ink">
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={close}>
                Отмена
              </Button>
              <Button type="submit">{pending.kind === "transfer" ? "Перенести" : "Сохранить"}</Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </ActionsContext.Provider>
  );
}

export function useTaskActions(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useTaskActions вне TaskActionsProvider");
  return ctx;
}
