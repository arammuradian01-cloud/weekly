"use client";

// Чек-лист внутри задачи и повтор задачи (этап 25, модуль М10). Чек-лист ведут те же, кто ведёт «Где сейчас».
// Повтор задаёт тот, кто может править задачу

import { useEffect, useState } from "react";
import { Plus, Repeat, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import type { Task } from "@/domain/types";
import { REPEAT_KINDS, REPEAT_MODES, repeatLabel, type RepeatKindCode, type RepeatModeCode } from "@/lib/tasks/repeat";
import { addChecklistItemAction, editChecklistItemAction, removeChecklistItemAction, setRepeatAction, toggleChecklistItemAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextInput } from "@/components/ui/primitives";
import { isClosed } from "@/domain/rules";
import { cn } from "@/lib/cn";
import { useTaskPermissions } from "./task-fields";

/** «2 из 5» для списков и карточки */
export function checklistProgress(task: Pick<Task, "checklist">): { done: number; total: number } | null {
  const list = task.checklist ?? [];
  if (!list.length) return null;
  return { done: list.filter((c) => c.done).length, total: list.length };
}

export function TaskChecklist({ task, headingLevel = "h3" }: { task: Task; headingLevel?: "h2" | "h3" }) {
  const { runTask, observer } = usePrototype();
  const can = useTaskPermissions(task);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const closed = isClosed(task);
  // Отметка ставится сразу, ответ сервера её подтверждает или возвращает назад
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  useEffect(() => setOptimistic({}), [task.updatedAt, task.checklist]);
  const items = (task.checklist ?? []).map((c) => (c.id in optimistic ? { ...c, done: optimistic[c.id]! } : c));
  const progress = checklistProgress({ checklist: items });
  const canEdit = can.where && !observer && !task.archived && !closed;
  const H = headingLevel;
  if (!items.length && !canEdit) return null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const ok = await runTask(() => addChecklistItemAction(task.number, text.trim()), "Пункт добавлен");
    if (ok) {
      setText("");
      // Форма остаётся: пункты обычно добавляют по несколько
      setAdding(true);
    }
  };

  return (
    <section aria-labelledby={`checklist-${task.number}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <H id={`checklist-${task.number}`} className="text-sm font-medium text-ink">
          Чек-лист {progress ? <span className="font-normal text-muted">{progress.done} из {progress.total}</span> : null}
        </H>
      </div>
      {progress ? (
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Готово пунктов чек-листа">
          <div className={cn("h-full rounded-full", progress.done === progress.total ? "bg-green" : "bg-blue")} style={{ width: `${(100 * progress.done) / progress.total}%` }} />
        </div>
      ) : null}
      <ul className="flex flex-col">
        {items.map((c) => (
          <li key={c.id} className="group flex items-start gap-2 rounded-md py-1 hover:bg-field/70">
            <label className={cn("flex min-h-9 flex-1 cursor-pointer items-start gap-2.5 px-1 text-body", c.done ? "text-muted" : "text-ink", !canEdit && "cursor-default")}>
              <input
                type="checkbox"
                checked={c.done}
                disabled={!canEdit}
                onChange={(e) => {
                  const done = e.target.checked;
                  setOptimistic((prev) => ({ ...prev, [c.id]: done }));
                  void runTask(() => toggleChecklistItemAction(task.number, c.id, done), done ? "Пункт отмечен" : "Отметка снята").then((ok) => {
                    if (!ok) setOptimistic((prev) => ({ ...prev, [c.id]: !done }));
                  });
                }}
                className="mt-2 h-4 w-4 shrink-0 accent-blue-700"
              />
              {editing?.id === c.id ? (
                <form
                  className="flex flex-1 flex-wrap items-center gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const ok = await runTask(() => editChecklistItemAction(task.number, c.id, editing.text.trim()), "Пункт изменён");
                    if (ok) setEditing(null);
                  }}
                >
                  <TextInput label={`Пункт: ${c.text}`} hideLabel id={`cl-edit-${c.id}`} value={editing.text} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} maxLength={200} className="min-w-0 flex-1" autoFocus />
                  <Button size="sm" type="submit">Сохранить</Button>
                  <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(null)}>Отмена</Button>
                </form>
              ) : (
                <span className="py-1.5 leading-snug">
                  <span className={cn(c.done && "line-through decoration-muted/60")}>{c.text}</span>
                  {c.done && c.by ? <span className="ml-2 text-caption text-muted">{compactName(c.by)}</span> : null}
                </span>
              )}
            </label>
            {canEdit && editing?.id !== c.id ? (
              <div className="flex shrink-0 items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100">
                <button type="button" onClick={() => setEditing({ id: c.id, text: c.text })} className="inline-flex h-9 items-center rounded-md px-2 text-caption text-muted hover:bg-field hover:text-ink">
                  Изменить
                </button>
                <button type="button" onClick={() => void runTask(() => removeChecklistItemAction(task.number, c.id), "Пункт убран")} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted hover:bg-field hover:text-ink" aria-label={`Убрать пункт ${c.text}`}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        adding ? (
          <form onSubmit={add} className="mt-1 flex flex-wrap items-end gap-2">
            <TextInput label="Новый пункт" hideLabel id={`cl-new-${task.number}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Что нужно сделать по шагам" maxLength={200} className="min-w-0 flex-1" autoFocus />
            <Button size="sm" type="submit" disabled={!text.trim()}>
              Добавить пункт
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setAdding(false)}>
              Готово
            </Button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-1 inline-flex h-9 items-center gap-1.5 rounded-md text-small font-medium text-blue-700 hover:underline">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить пункт
          </button>
        )
      ) : null}
    </section>
  );
}

/** Повтор задачи в карточке: подпись и окно настройки */
export function TaskRepeat({ task }: { task: Task }) {
  const { runTask, observer } = usePrototype();
  const can = useTaskPermissions(task);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RepeatKindCode>(task.repeat?.kind ?? "weekly");
  const [mode, setMode] = useState<RepeatModeCode>(task.repeat?.mode ?? "on-close");
  const [off, setOff] = useState(false);
  const r = task.repeat;
  const canEdit = (can.edit || can.due) && !observer && !task.archived;
  const openModal = () => {
    setKind(r?.kind ?? "weekly");
    setMode(r?.mode ?? "on-close");
    setOff(false);
    setOpen(true);
  };
  const save = async () => {
    const ok = await runTask(() => setRepeatAction(task.number, off ? null : { kind, mode }), off ? "Повтор выключен" : `Повтор: ${repeatLabel(kind, mode).toLowerCase()}`);
    if (ok) setOpen(false);
  };
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {r?.active ? (
          <span className="inline-flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-muted" aria-hidden="true" />
            {repeatLabel(r.kind, r.mode)}
          </span>
        ) : (
          <span className="text-muted">Нет</span>
        )}
        {canEdit ? (
          <button type="button" onClick={openModal} className="inline-flex h-9 items-center rounded-md text-small font-medium text-blue-700 hover:underline">
            {r?.active ? "Изменить" : "Повторять"}
          </button>
        ) : null}
      </span>
      {r?.of || r?.next ? (
        <span className="mt-0.5 block text-caption text-muted">
          {r.of ? `Повтор задачи ${r.of}` : null}
          {r.of && r.next ? ", " : null}
          {r.next ? `следующая: ${r.next}` : null}
        </span>
      ) : null}
      <Modal open={open} onOpenChange={setOpen} title={`Повтор задачи ${task.number}`} description="Следующая задача серии копирует название, результат, ответственного, направление и чек-лист без отметок. Срок сдвигается на период">
        <div className="flex flex-col gap-4">
          <SelectField label="Как часто" id={`rp-kind-${task.number}`} value={kind} onChange={(e) => setKind(e.target.value as RepeatKindCode)} options={REPEAT_KINDS.map((k) => ({ value: k.code, label: k.label }))} disabled={off} />
          <SelectField label="Когда создаётся следующая" id={`rp-mode-${task.number}`} value={mode} onChange={(e) => setMode(e.target.value as RepeatModeCode)} options={REPEAT_MODES.map((m) => ({ value: m.code, label: m.label }))} hint={REPEAT_MODES.find((m) => m.code === mode)?.hint} disabled={off} />
          {r?.active ? (
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-body text-ink">
              <input type="checkbox" checked={off} onChange={(e) => setOff(e.target.checked)} className="h-4 w-4 accent-blue-700" />
              Больше не повторять
            </label>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void save()}>
              Сохранить
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
