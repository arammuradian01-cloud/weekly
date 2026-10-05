"use client";

// Правки задачи с правилами раздела 4 ТЗ: перенос, отмена и «Не выполнена» без причины невозможны,
// для «Выполнена» нужен итог, для «Заблокирована» нужно написать, чем и кто может помочь.
// С этапа 3 правки уходят на сервер: он проверяет те же правила и права ещё раз.

import { createContext, useContext, useState } from "react";
import { usePrototype } from "@/prototype/store";
import { formatLong, type IsoDate } from "@/prototype/dates";
import { priorityOf, stateLabel, statusOf, type PriorityCode, type StateCode, type StatusCode } from "@/prototype/dictionaries";
import { statusNeedsNote } from "@/lib/tasks/rules";
import type { Task } from "@/prototype/types";
import {
  changePriorityAction,
  changeStateAction,
  changeStatusAction,
  transferDueAction,
  updateWhereAction,
  type TaskActionResult,
} from "@/app/(app)/tasks/actions";
import { Modal } from "@/components/ui/overlays";
import { TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

type Actions = {
  changeStatus: (task: Task, next: StatusCode) => void;
  changeState: (task: Task, next: StateCode) => void;
  changePriority: (task: Task, next: PriorityCode) => void;
  updateWhere: (task: Task, text: string) => Promise<boolean>;
  transfer: (task: Task) => void;
};

type Pending =
  | { kind: "status"; task: Task; next: StatusCode; note: "result" | "reason" }
  | { kind: "blocked"; task: Task }
  | { kind: "transfer"; task: Task };

const ActionsContext = createContext<Actions | null>(null);

export function TaskActionsProvider({ children }: { children: React.ReactNode }) {
  const { runTask, applyTaskResult } = usePrototype();
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const [date, setDate] = useState<IsoDate>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setPending(null);
    setText("");
    setError(null);
    setBusy(false);
  };

  const statusToast = (task: Task, next: StatusCode) =>
    task.status === "proposed" && next === "in-progress" ? `Задача ${task.number} принята в работу` : `Задача ${task.number}: ${statusOf(next).label.toLowerCase()}`;

  const actions: Actions = {
    changeStatus: (task, next) => {
      const note = statusNeedsNote(next);
      if (note) {
        setText("");
        setPending({ kind: "status", task, next, note });
        return;
      }
      void runTask(() => changeStatusAction(task.number, next), statusToast(task, next));
    },
    changeState: (task, next) => {
      if (next === "blocked") {
        setText(task.blockedBy ?? "");
        setPending({ kind: "blocked", task });
        return;
      }
      void runTask(() => changeStateAction(task.number, next), `Состояние: ${stateLabel(next).toLowerCase()}`);
    },
    changePriority: (task, next) => void runTask(() => changePriorityAction(task.number, next), `Приоритет: ${priorityOf(next).label.toLowerCase()}`),
    updateWhere: (task, value) => runTask(() => updateWhereAction(task.number, value), "«Где сейчас» обновлено"),
    transfer: (task) => {
      setDate(task.due);
      setText("");
      setPending({ kind: "transfer", task });
    },
  };

  /** Ошибку правила показываем в самом окне, чтобы не потерять написанное */
  const finish = async (call: () => Promise<TaskActionResult>, toastText: string) => {
    setBusy(true);
    try {
      const result = await call();
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      applyTaskResult(result, toastText);
      close();
    } catch {
      setError("Нет связи с сервером: попробуйте ещё раз");
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending || busy) return;
    if (pending.kind === "transfer") {
      if (!date || date === pending.task.due) return setError("Выберите новый срок");
      if (!text.trim()) return setError("Без причины перенести нельзя");
      const t = pending.task;
      return void finish(() => transferDueAction(t.number, date, text.trim()), `Срок задачи ${t.number} перенесён на ${formatLong(date)}`);
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
      const t = pending.task;
      return void finish(() => changeStateAction(t.number, "blocked", text.trim()), `Задача ${t.number} заблокирована`);
    }
    const { task, next } = pending;
    void finish(() => changeStatusAction(task.number, next, text.trim()), statusToast(task, next));
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
                  hint={
                    pending.task.transfers[0]?.from === null
                      ? `Сейчас ${formatLong(pending.task.due)}. Исходный срок в таблице не записан`
                      : `Сейчас ${formatLong(pending.task.due)}. Исходный срок ${formatLong(pending.task.originalDue)} сохранится`
                  }
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
              <Button type="submit" disabled={busy}>
                {busy ? "Сохраняю…" : pending.kind === "transfer" ? "Перенести" : "Сохранить"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </ActionsContext.Provider>
  );
}

/** Действия для образца компонентов: ничего не сохраняют, только показывают, как выглядит отклик */
export function DemoTaskActions({ children }: { children: React.ReactNode }) {
  const { notify } = usePrototype();
  const say = () => notify("Это образец: на настоящих задачах здесь сохраняется правка");
  const actions: Actions = {
    changeStatus: say,
    changeState: say,
    changePriority: say,
    updateWhere: async () => {
      say();
      return true;
    },
    transfer: say,
  };
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}

export function useTaskActions(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useTaskActions вне TaskActionsProvider");
  return ctx;
}
