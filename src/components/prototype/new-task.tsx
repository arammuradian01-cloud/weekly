"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { PEOPLE } from "@/prototype/people";
import { addDays } from "@/prototype/dates";
import { DIRECTIONS, PRIORITIES, SOURCES, type DirectionCode, type PriorityCode, type SourceCode } from "@/prototype/dictionaries";
import type { Owner } from "@/prototype/types";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const OPEN_EVENT = "weekly:new-task";

/** Кнопка «Новая задача» из любого места открывает один и тот же диалог */
export function openNewTask(prefill?: { title?: string; outcome?: string; source?: SourceCode; sourceNote?: string }) {
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
export function GlobalHotkeys() {
  const { data, me, manage, createTask } = usePrototype();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [owner, setOwner] = useState<Owner>(me.slug);
  const [direction, setDirection] = useState<DirectionCode>(me.direction);
  const [priority, setPriority] = useState<PriorityCode>("medium");
  const [due, setDue] = useState(addDays(data.today, 7));
  const [source, setSource] = useState<SourceCode>("meeting");
  const [sourceNote, setSourceNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as { title?: string; outcome?: string; source?: SourceCode; sourceNote?: string } | undefined;
      setTitle(detail?.title ?? "");
      setOutcome(detail?.outcome ?? "");
      setSource(detail?.source ?? "meeting");
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
      if (e.key === "n" || e.key === "N" || e.key === "т" || e.key === "Т") {
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
  }, [data.today, me.slug, me.direction]);

  // Лидер ставит задачу только себе, другому может только предложить (раздел 2 ТЗ)
  const proposing = !manage && owner !== me.slug;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Напишите, что за задача");
    if (title.length > 120) return setError("Название длиннее 120 знаков: оставьте одну мысль");
    if (!outcome.trim()) return setError("Опишите результат: по чему понять, что задача сделана");
    const number = createTask({
      title: title.trim(),
      outcome: outcome.trim(),
      owner,
      coExecutors: [],
      direction,
      priority,
      status: proposing ? "proposed" : "in-progress",
      state: "on-track",
      where: proposing ? "Ждёт подтверждения владельца или администратора" : "Только что поставлена",
      whereUpdatedAt: data.today,
      due,
      originalDue: due,
      transfers: [],
      source: { kind: source, note: sourceNote || SOURCES.find((s) => s.code === source)!.label },
      links: [],
    });
    setOpen(false);
    router.push(`/tasks?task=${number}`);
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
          <SelectField label="Направление" id="nt-dir" value={direction} onChange={(e) => setDirection(e.target.value as DirectionCode)} options={DIRECTIONS.map((d) => ({ value: d.code, label: d.label }))} />
          <SelectField label="Приоритет" id="nt-pr" value={priority} onChange={(e) => setPriority(e.target.value as PriorityCode)} options={PRIORITIES.map((p) => ({ value: p.code, label: p.label }))} />
          <TextInput label="Срок" id="nt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <SelectField label="Источник" id="nt-src" value={source} onChange={(e) => setSource(e.target.value as SourceCode)} options={SOURCES.map((s) => ({ value: s.code, label: s.label }))} />
          <TextInput label="Подробнее об источнике" id="nt-src-note" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="Например, встреча 6 октября" />
        </div>
        {proposing ? (
          <p className="rounded-lg bg-blue-soft px-3.5 py-2.5 text-[14px] text-blue-700">
            Задача уйдёт со статусом «Предложена». Задачей она станет после подтверждения владельцем или администратором.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button type="submit">{proposing ? "Предложить задачу" : "Поставить задачу"}</Button>
        </div>
      </form>
    </Modal>
  );
}
