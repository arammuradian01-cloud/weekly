"use client";

import { useState } from "react";
import { ListPlus } from "lucide-react";
import { BLOCKS, DIRECTIONS, ENTRY_TYPES, type BlockCode, type DirectionCode, type EntryTypeCode } from "@/prototype/dictionaries";
import type { WeeklyEntry } from "@/prototype/types";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { openNewTask } from "@/components/prototype/new-task";

const WHAT_MAX = 150;
const DETAILS_MAX = 1000;

/** Форма записи weekly: поля из раздела 3 ТЗ. Обязательны только блок, тип и «что произошло» */
export function EntryForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: WeeklyEntry;
  onSave: (entry: WeeklyEntry) => void;
  onCancel: () => void;
}) {
  const [e, setE] = useState<WeeklyEntry>(initial);
  const [needHelp, setNeedHelp] = useState(!!initial.help);
  const [link, setLink] = useState(initial.links[0]?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof WeeklyEntry>(key: K, value: WeeklyEntry[K]) => setE((prev) => ({ ...prev, [key]: value }));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!e.what.trim()) return setError("Напишите одной фразой, что произошло");
    if (e.what.length > WHAT_MAX) return setError(`«Что произошло» длиннее ${WHAT_MAX} знаков: сократите до одной фразы`);
    if ((e.details ?? "").length > DETAILS_MAX) return setError(`«Подробнее» длиннее ${DETAILS_MAX} знаков`);
    if (needHelp && !(e.help ?? "").trim()) return setError("Напишите, какая помощь нужна и от кого");
    onSave({
      ...e,
      what: e.what.trim(),
      fact: e.fact?.trim() || undefined,
      impact: e.impact?.trim() || undefined,
      help: needHelp ? e.help?.trim() : undefined,
      links: link.trim() ? [{ title: "Ссылка", url: link.trim() }] : [],
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl bg-surface p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Направление" id={`${e.id}-dir`} value={e.direction} onChange={(ev) => set("direction", ev.target.value as DirectionCode)} options={DIRECTIONS.map((d) => ({ value: d.code, label: d.label }))} />
        <SelectField label="Блок" id={`${e.id}-block`} value={e.block} onChange={(ev) => set("block", ev.target.value as BlockCode)} options={BLOCKS.map((b) => ({ value: b.code, label: b.label }))} />
        <SelectField label="Тип" id={`${e.id}-type`} value={e.type} onChange={(ev) => set("type", ev.target.value as EntryTypeCode)} options={ENTRY_TYPES.map((t) => ({ value: t.code, label: t.label }))} />
      </div>
      <TextArea label="Что произошло" id={`${e.id}-what`} value={e.what} onChange={(ev) => set("what", ev.target.value)} rows={2} counter={{ value: e.what.length, max: WHAT_MAX }} autoFocus />
      <TextArea label="Подробнее" id={`${e.id}-details`} value={e.details ?? ""} onChange={(ev) => set("details", ev.target.value)} counter={{ value: (e.details ?? "").length, max: DETAILS_MAX }} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextArea label="Влияние на бизнес" id={`${e.id}-impact`} value={e.impact ?? ""} onChange={(ev) => set("impact", ev.target.value)} rows={2} hint="Словами: что это меняет для выручки, маржи или клиентов" />
        <TextArea label="Цифра или факт" id={`${e.id}-fact`} value={e.fact ?? ""} onChange={(ev) => set("fact", ev.target.value)} rows={2} hint="Одна цифра или факт, на который опирается запись" />
      </div>
      <div className="flex flex-col gap-2">
        <TextArea label="Что делаем дальше" id={`${e.id}-next`} value={e.next ?? ""} onChange={(ev) => set("next", ev.target.value)} rows={2} />
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!(e.next ?? "").trim()}
            onClick={() => openNewTask({ title: (e.next ?? "").slice(0, 120), outcome: e.what, source: "weekly", sourceNote: "Запись weekly" })}
          >
            <ListPlus className="h-4 w-4" aria-hidden="true" />
            Сделать задачей
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-[15px] text-ink">
          <input type="checkbox" checked={needHelp} onChange={(ev) => setNeedHelp(ev.target.checked)} className="h-4 w-4 accent-[#0073a8]" />
          Нужна помощь
        </label>
        {needHelp ? <TextInput label="Какая помощь и от кого" id={`${e.id}-help`} value={e.help ?? ""} onChange={(ev) => set("help", ev.target.value)} /> : null}
      </div>
      <TextInput label="Ссылка на артефакт" id={`${e.id}-link`} type="url" value={link} onChange={(ev) => setLink(ev.target.value)} placeholder="https://" />
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-[14px] text-danger-ink">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit">Сохранить запись</Button>
      </div>
    </form>
  );
}
