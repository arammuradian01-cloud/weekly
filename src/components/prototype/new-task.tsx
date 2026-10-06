"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { PEOPLE } from "@/domain/people";
import { addDays } from "@/domain/dates";
import { dictOptions, PRIORITIES, SOURCES, type DirectionCode, type PriorityCode, type SourceCode } from "@/domain/dictionaries";
import type { Owner } from "@/domain/types";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const OPEN_EVENT = "weekly:new-task";
/** Задачу поставили по записи weekly: форма записи показывает её номер, человек остаётся на экране сдачи */
export const TASK_FROM_ENTRY_EVENT = "weekly:task-from-entry";

/** Кнопка «Новая задача» из любого места открывает один и тот же диалог */
type Prefill = { title?: string; outcome?: string; source?: SourceCode; sourceNote?: string; weeklyEntryId?: string };

export function openNewTask(prefill?: Prefill) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: prefill }));
}

export function NewTaskButton({ size = "md" }: { size?: "md" | "sm" }) {
  return (
    <Button size={size} onClick={() => openNewTask()} aria-keyshortcuts="N">
      <Plus className="h-4 w-4" aria-hidden="true" />
      Новая задача
    </Button>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/**
 * Горячие клавиши (раздел 7 ТЗ): N новая задача, / поиск.
 * Диалог создания задачи живёт здесь один на всё приложение.
 */
/** «Встреча», если её не скрыли в справочнике, иначе первый видимый источник */
const defaultSource = (): SourceCode => (SOURCES.some((s) => s.code === "meeting") ? "meeting" : (SOURCES[0]?.code ?? "meeting"));

export function GlobalHotkeys() {
  const { data, me, manage, observer, createTask } = usePrototype();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [owner, setOwner] = useState<Owner>(me.slug);
  const [direction, setDirection] = useState<DirectionCode>(me.direction);
  const [priority, setPriority] = useState<PriorityCode>("medium");
  const [due, setDue] = useState(addDays(data.today, 7));
  const [source, setSource] = useState<SourceCode>(defaultSource());
  const [sourceNote, setSourceNote] = useState("");
  const [weeklyEntryId, setWeeklyEntryId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as Prefill | undefined;
      setWeeklyEntryId(detail?.weeklyEntryId);
      setTitle(detail?.title ?? "");
      setOutcome(detail?.outcome ?? "");
      setSource(detail?.source ?? defaultSource());
      setSourceNote(detail?.sourceNote ?? "");
      setOwner(me.slug);
      setDirection(me.direction);
      setPriority("medium");
      setDue(addDays(data.today, 7));
      setError(null);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!observer && (e.key === "n" || e.key === "N" || e.key === "т" || e.key === "Т")) {
        e.preventDefault();
        openNewTask();
      }
      if (e.key === "/") {
        const search = document.getElementById("global-search") as HTMLInputElement | null;
        if (search) {
          e.preventDefault();
          search.focus();
        }
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [data.today, me.slug, me.direction, observer]);

  // Лидер ставит задачу только себе, другому может только предложить (раздел 2 ТЗ)
  const proposing = !manage && owner !== me.slug;

  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Напишите, что за задача");
    if (title.length > 120) return setError("Название длиннее 120 знаков: оставьте одну мысль");
    if (!outcome.trim()) return setError("Опишите результат: по чему понять, что задача сделана");
    if (!due) return setError("Укажите срок");
    setBusy(true);
    const result = await createTask({
      title: title.trim(),
      outcome: outcome.trim(),
      owner,
      direction,
      priority,
      due,
      source,
      sourceNote: sourceNote.trim() || undefined,
      weeklyEntryId,
    });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    if (weeklyEntryId) {
      window.dispatchEvent(new CustomEvent(TASK_FROM_ENTRY_EVENT, { detail: { entryId: weeklyEntryId, number: result.number } }));
      return;
    }
    router.push(`/tasks?task=${result.number}`);
  };

  const ownerOptions = [
    ...PEOPLE.map((p) => ({ value: p.slug, label: p.slug === me.slug ? `${p.fullName} (я)` : p.fullName })),
    ...(manage ? [{ value: "all", label: "Все лидеры" }] : []),
  ];

  return (
    <Modal open={open} onOpenChange={setOpen} title="Новая задача" description="Одна мысль в названии, понятный результат и срок">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextInput
          label="Задача"
          id="nt-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          autoFocus
          hint={`${title.length} из 120 знаков`}
        />
        <TextArea label="Что нужно сделать" id="nt-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} hint="По чему понять, что задача сделана" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Ответственный" id="nt-owner" value={owner} onChange={(e) => setOwner(e.target.value as Owner)} options={ownerOptions} />
          <SelectField label="Направление" id="nt-dir" value={direction} onChange={(e) => setDirection(e.target.value as DirectionCode)} options={dictOptions("DIRECTION", direction)} />
          <SelectField label="Приоритет" id="nt-pr" value={priority} onChange={(e) => setPriority(e.target.value as PriorityCode)} options={PRIORITIES.map((p) => ({ value: p.code, label: p.label }))} />
          <TextInput label="Срок" id="nt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <SelectField label="Источник" id="nt-src" value={source} onChange={(e) => setSource(e.target.value as SourceCode)} options={dictOptions("TASK_SOURCE", source)} />
          <TextInput label="Подробнее об источнике" id="nt-src-note" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="Например, встреча 6 октября" />
        </div>
        {proposing ? (
          <p className="rounded-lg bg-blue-soft px-3.5 py-2.5 text-small text-blue-700">
            Задача уйдёт со статусом «Предложена». Задачей она станет после подтверждения владельцем или администратором.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-small text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Сохраняю…" : proposing ? "Предложить задачу" : "Поставить задачу"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
