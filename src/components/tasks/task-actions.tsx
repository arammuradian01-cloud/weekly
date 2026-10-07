"use client";

// Правки задачи с правилами раздела 4 ТЗ: перенос, отмена и «Не выполнена» без причины невозможны,
// для «Выполнена» нужен итог. С этапа 21 «Заблокирована» требует ссылку: задачу, которую эта ждёт, или человека
// (тогда ему уходит просьба), а «Есть риск» требует фразу, что вернёт задачу в график.
// С этапа 3 правки уходят на сервер: он проверяет те же правила и права ещё раз.

import { createContext, useContext, useRef, useState } from "react";
import { usePrototype } from "@/domain/store";
import { formatLong, type IsoDate } from "@/domain/dates";
import { priorityOf, stateLabel, statusOf, type PriorityCode, type StateCode, type StatusCode } from "@/domain/dictionaries";
import { statusNeedsNote } from "@/lib/tasks/rules";
import type { Task } from "@/domain/types";
import {
  blockOnPersonAction,
  taskLinksAction,
  changePriorityAction,
  changeStateAction,
  changeStatusAction,
  transferDueAction,
  updateWhereAction,
  type TaskActionResult,
} from "@/app/(app)/tasks/actions";
import { Modal } from "@/components/ui/overlays";
import { Segmented, TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { addDays } from "@/domain/dates";
import { DueField, PersonSelect } from "@/components/requests/request-parts";
import { REQUESTS_CHANGED } from "@/components/requests/request-dialog";

type WaitMode = "task" | "person" | "existing";

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
  | { kind: "risk"; task: Task }
  | { kind: "transfer"; task: Task };

const ActionsContext = createContext<Actions | null>(null);

export function TaskActionsProvider({ children }: { children: React.ReactNode }) {
  const { runTask, applyTaskResult, data, me } = usePrototype();
  const [pending, setPending] = useState<Pending | null>(null);
  // «Заблокирована»: чего ждёт задача (этап 21)
  const [mode, setMode] = useState<WaitMode>("task");
  const [waitTask, setWaitTask] = useState("");
  const [person, setPerson] = useState("");
  const [ask, setAsk] = useState("");
  const [askDue, setAskDue] = useState<IsoDate>("");
  /** Задача уже чего-то ждёт (открытая задача или просьба): подпись с сервера */
  const [existing, setExisting] = useState<string | null>(null);
  const waitTaskRef = useRef("");
  waitTaskRef.current = waitTask;
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
        const linked = (task.waitsFor ?? []).some((w) => !w.closed);
        setText(task.state === "blocked" ? (task.blockedBy ?? "") : "");
        setMode(linked ? "existing" : "task");
        setExisting(linked ? `Ждёт задачу ${(task.waitsFor ?? []).find((w) => !w.closed)!.number}` : null);
        // Открытая просьба по задаче тоже ссылка: спрашиваем сервер, окно уже открыто
        void taskLinksAction(task.number)
          .then((r) => {
            if (!r.ok || !r.value.existing) return;
            setExisting(r.value.existing);
            setMode((m) => (m === "task" && !waitTaskRef.current ? "existing" : m));
          })
          .catch(() => undefined);
        setWaitTask("");
        setPerson("");
        setAsk("");
        setAskDue(addDays(data.today, 2));
        setPending({ kind: "blocked", task });
        return;
      }
      if (next === "at-risk") {
        setText(task.riskNote ?? "");
        setPending({ kind: "risk", task });
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
    if (pending.kind === "blocked") {
      const t = pending.task;
      const note = text.trim() || undefined;
      if (mode === "task") {
        const n = Number(waitTask.replace(/\D/g, ""));
        if (!n) return setError("Укажите номер задачи, которую ждёт эта");
        return void finish(() => changeStateAction(t.number, "blocked", note, n), `Задача ${t.number} ждёт задачу ${n}`);
      }
      if (mode === "person") {
        if (!person) return setError("Выберите, кого ждёт задача");
        if (!ask.trim()) return setError("Напишите, что нужно от человека: это уйдёт ему просьбой");
        return void finish(async () => {
          const r = await blockOnPersonAction(t.number, { to: person, text: ask, due: askDue, note: note ?? null });
          if (r.ok) window.dispatchEvent(new Event(REQUESTS_CHANGED));
          return r;
        }, `Задача ${t.number} заблокирована, просьба ушла`);
      }
      return void finish(() => changeStateAction(t.number, "blocked", note), `Задача ${t.number} заблокирована`);
    }
    if (!text.trim()) {
      return setError(
        pending.kind === "risk" ? "Напишите одной фразой, что вернёт задачу в график" : pending.note === "result" ? "Нужен короткий итог или ссылка на результат" : "Без причины так закрыть задачу нельзя",
      );
    }
    if (pending.kind === "risk") {
      const t = pending.task;
      return void finish(() => changeStateAction(t.number, "at-risk", text.trim()), `Задача ${t.number}: есть риск`);
    }
    const { task, next } = pending;
    void finish(() => changeStatusAction(task.number, next, text.trim()), statusToast(task, next));
  };

  const title =
    pending?.kind === "transfer"
      ? `Перенести срок задачи ${pending.task.number}`
      : pending?.kind === "blocked"
        ? `Задача ${pending.task.number} заблокирована`
        : pending?.kind === "risk"
          ? `Задача ${pending.task.number}: есть риск`
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
            ) : pending.kind === "blocked" ? (
              <>
                <Segmented
                  label="Чего ждёт задача"
                  value={mode}
                  onChange={setMode}
                  options={[
                    ...(existing ? [{ value: "existing" as const, label: "Связь уже есть" }] : []),
                    { value: "task" as const, label: "Ждёт задачу" },
                    { value: "person" as const, label: "Ждёт человека" },
                  ]}
                  className="flex-wrap self-start"
                />
                {mode === "task" ? (
                  <TextInput label="Номер задачи, которую ждёт эта" id="st-wait" inputMode="numeric" value={waitTask} onChange={(e) => setWaitTask(e.target.value)} autoFocus />
                ) : mode === "person" ? (
                  <>
                    <PersonSelect id="st-person" label="Кого ждёт" value={person} onChange={setPerson} exclude={me.slug} />
                    <TextArea label="Что нужно от человека" id="st-ask" value={ask} onChange={(e) => setAsk(e.target.value)} hint="Уйдёт ему просьбой в «Мне»: он примет её со сроком или ответит отказом" />
                    <DueField id="st-ask-due" label="К какому сроку" value={askDue} onChange={setAskDue} today={data.today} />
                  </>
                ) : (
                  <p className="text-small text-muted">Задача уже ждёт: {existing}. Можно оставить эту ссылку и дописать пояснение.</p>
                )}
                <TextArea label="Пояснение, если нужно" id="st-note" value={text} onChange={(e) => setText(e.target.value)} />
              </>
            ) : (
              <TextArea
                label={pending.kind === "risk" ? "Что вернёт задачу в график" : pending.note === "result" ? "Итог или ссылка на результат" : "Причина"}
                id="st-note"
                value={text}
                onChange={(e) => setText(e.target.value)}
                hint={pending.kind === "risk" ? "Одна фраза: например, «Договоримся с партнёром о данных до пятницы»" : undefined}
                autoFocus
              />
            )}
            {error ? (
              <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-small text-danger-ink">
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
