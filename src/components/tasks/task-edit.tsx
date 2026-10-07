"use client";

// Правка задачи целиком: название, результат, направление и источник меняет тот, кто поставил задачу;
// ответственного меняют владелец и администратор; соисполнителей ещё и ответственный (разделы 2 и 4 ТЗ).

import { useEffect, useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { PEOPLE, personOf } from "@/domain/people";
import { teamOf, teamPeople } from "@/domain/teams";
import { dictOptions, type DirectionCode, type SourceCode } from "@/domain/dictionaries";
import type { Owner, PersonSlug, Task } from "@/domain/types";
import { addLinkAction, assignOwnerAction, editTaskAction, removeLinkAction, setCoExecutorsAction, type TaskActionResult } from "@/app/(app)/tasks/actions";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useTaskPermissions } from "./task-fields";

export function TaskEditModal({ task, open, onOpenChange }: { task: Task; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { applyTaskResult } = usePrototype();
  const can = useTaskPermissions(task);
  const [title, setTitle] = useState(task.title);
  const [outcome, setOutcome] = useState(task.outcome);
  const [direction, setDirection] = useState<DirectionCode>(task.direction);
  const [source, setSource] = useState<SourceCode>(task.source.kind);
  const [sourceNote, setSourceNote] = useState(task.source.note);
  const [owner, setOwner] = useState<Owner>(task.owner);
  const [co, setCo] = useState<PersonSlug[]>(task.coExecutors);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setOutcome(task.outcome);
    setDirection(task.direction);
    setSource(task.source.kind);
    setSourceNote(task.source.note);
    setOwner(task.owner);
    setCo(task.coExecutors);
    setError(null);
  }, [open, task]);

  const fieldsChanged =
    title.trim() !== task.title || outcome.trim() !== task.outcome || direction !== task.direction || source !== task.source.kind || sourceNote.trim() !== task.source.note;
  const ownerChanged = owner !== task.owner;
  const coChanged = [...co].sort().join() !== [...task.coExecutors].sort().join();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!fieldsChanged && !ownerChanged && !coChanged) return onOpenChange(false);
    if (!title.trim()) return setError("Напишите задачу одной мыслью");
    if (title.trim().length > 120) return setError("Название длиннее 120 знаков: оставьте одну мысль");
    if (!outcome.trim()) return setError("Опишите результат: по чему понять, что задача сделана");
    setBusy(true);
    setError(null);
    // Каждая часть правки отдельное действие со своими правами: показываем первую ошибку и не идём дальше
    const steps: [boolean, () => Promise<TaskActionResult>, string][] = [
      [can.edit && fieldsChanged, () => editTaskAction(task.number, { title, outcome, direction, source, sourceNote }), `Задача ${task.number} изменена`],
      [can.owner && ownerChanged, () => assignOwnerAction(task.number, owner), `Ответственный задачи ${task.number} изменён`],
      [can.coExecutors && coChanged, () => setCoExecutorsAction(task.number, co.filter((s) => s !== owner)), `Соисполнители задачи ${task.number} изменены`],
    ];
    try {
      for (const [needed, call, toast] of steps) {
        if (!needed) continue;
        const result = await call();
        if (!result.ok) {
          setError(result.error);
          setBusy(false);
          return;
        }
        applyTaskResult(result, toast);
      }
    } catch {
      setError("Нет связи с сервером: попробуйте ещё раз");
      setBusy(false);
      return;
    }
    setBusy(false);
    onOpenChange(false);
  };

  // Выбор из людей команды задачи (этап 14). Команды нет в снимке: все включённые люди
  const target = teamOf(task.team);
  const pool = target ? PEOPLE.filter((p) => teamPeople(target).includes(p.slug)) : PEOPLE;
  const people = pool.map((p) => ({ value: p.slug, label: p.fullName }));
  // Нынешний ответственный или соисполнитель вне списка остаётся в форме: иначе выбор незаметно сменится или его не снять
  const outside = (slug: string) => !pool.some((p) => p.slug === slug);
  const label = (slug: string) => `${personOf(slug).fullName}${PEOPLE.some((p) => p.slug === slug) ? "" : " (выключен)"}`;
  if (task.owner !== "all" && outside(task.owner)) people.push({ value: task.owner, label: label(task.owner) });
  const coChoices = [...pool, ...task.coExecutors.filter(outside).map(personOf)].filter((p) => p.slug !== owner);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Изменить задачу ${task.number}`} description="Каждая правка попадёт в историю задачи">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {can.edit ? (
          <>
            <TextInput label="Задача" id="te-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} hint={`${title.trim().length} из 120 знаков`} />
            <TextArea label="Что нужно сделать" id="te-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} hint="По чему понять, что задача сделана" />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Направление" id="te-dir" value={direction} onChange={(e) => setDirection(e.target.value as DirectionCode)} options={dictOptions("DIRECTION", direction)} />
              <SelectField label="Источник" id="te-src" value={source} onChange={(e) => setSource(e.target.value as SourceCode)} options={dictOptions("TASK_SOURCE", source)} />
              <TextInput label="Подробнее об источнике" id="te-src-note" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} className="sm:col-span-2" />
            </div>
          </>
        ) : null}
        {can.owner ? (
          <SelectField label="Ответственный" id="te-owner" value={owner} onChange={(e) => setOwner(e.target.value as Owner)} options={[...people, { value: "all", label: "Все лидеры" }]} />
        ) : null}
        {can.coExecutors ? (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">Соисполнители</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {coChoices.map((p) => (
                <label key={p.slug} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-1 text-body text-ink hover:bg-field">
                  <input
                    type="checkbox"
                    checked={co.includes(p.slug)}
                    onChange={(e) => setCo((prev) => (e.target.checked ? [...prev, p.slug] : prev.filter((s) => s !== p.slug)))}
                    className="h-4 w-4 accent-blue-700"
                  />
                  {label(p.slug)}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-small text-danger-ink">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Ссылки на артефакты: добавляет и убирает любой участник задачи */
export function TaskLinks({ task }: { task: Task }) {
  const { runTask } = usePrototype();
  const can = useTaskPermissions(task);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    const ok = await runTask(() => addLinkAction(task.number, { url: url.trim(), title: title.trim() || undefined }), "Ссылка добавлена");
    if (ok) {
      setUrl("");
      setTitle("");
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {task.links.length ? (
        <ul className="flex flex-col gap-1">
          {task.links.map((l) => (
            <li key={l.id ?? l.url} className="flex items-center gap-1">
              <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-blue-700 hover:underline">
                <span className="truncate">{l.title}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              </a>
              {can.links && l.id ? (
                <button
                  type="button"
                  onClick={() => void runTask(() => removeLinkAction(task.number, l.id!), "Ссылка убрана")}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-field hover:text-ink"
                  aria-label={`Убрать ссылку ${l.title}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-muted">Пока нет</span>
      )}
      {can.links ? (
        adding ? (
          <form onSubmit={add} className="flex flex-col gap-2">
            <TextInput label="Адрес" id={`link-url-${task.number}`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoFocus />
            <TextInput label="Название" id={`link-title-${task.number}`} value={title} onChange={(e) => setTitle(e.target.value)} hint="Если пусто, подставим адрес сайта" />
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={!url.trim()}>
                Добавить
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setAdding(false)}>
                Отмена
              </Button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-1.5 self-start rounded-md text-small font-medium text-blue-700 hover:underline">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить ссылку
          </button>
        )
      ) : null}
    </div>
  );
}
