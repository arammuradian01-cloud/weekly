"use client";

// «Наверх» (этап 15): руководитель поднимает запись человека своей команды в свой weekly, в команду уровнем выше.
// Запись не копируется: в ленте команды выше она видна под его именем, с автором и его фразой.

import { useState } from "react";
import { ArrowUpFromLine, Check } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import type { PersonSlug, WeeklyEntry } from "@/domain/types";
import { promoteEntryAction, unpromoteEntryAction } from "@/app/(app)/weekly/actions";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useRunWeekly } from "./use-weekly";

const NOTE_MAX = 150;

/** Можно ли мне поднять запись: автор из моей команды или запись уже поднял человек моей команды */
export function canPromote(entry: WeeklyEntry, me: PersonSlug, promoteFrom: PersonSlug[]): boolean {
  if (!entry.author || entry.author === me) return false;
  return promoteFrom.includes(entry.author) || !!entry.promoted?.some((p) => promoteFrom.includes(p.by));
}

/** Кнопка «Наверх» под записью и поле для фразы от себя */
export function PromoteControl({ entry, promoteFrom, closed }: { entry: WeeklyEntry; promoteFrom: PersonSlug[]; closed: boolean }) {
  const { me } = usePrototype();
  const run = useRunWeekly();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = entry.promoted?.find((p) => p.by === me.slug);
  if (closed || (!mine && !canPromote(entry, me.slug, promoteFrom))) return null;

  const promote = async () => {
    setBusy(true);
    const ok = await run(() => promoteEntryAction(entry.id, note.trim() || null), "Запись поднята в ваш weekly");
    setBusy(false);
    if (ok) {
      setOpen(false);
      setNote("");
    }
  };
  const remove = async () => {
    setBusy(true);
    await run(() => unpromoteEntryAction(entry.id), "Запись убрана из вашего weekly");
    setBusy(false);
  };

  if (mine) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-green-soft px-2 text-caption font-medium text-ink">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />В вашем weekly
        </span>
        <button type="button" onClick={remove} disabled={busy} className="min-h-8 rounded-md px-2 text-caption font-medium text-blue-700 hover:bg-surface">
          Убрать
        </button>
      </div>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-8 items-center gap-1.5 self-start rounded-md px-2 text-caption font-medium text-muted ring-1 ring-line hover:text-ink"
      >
        <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden="true" />
        Наверх
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface p-3 sm:flex-row sm:items-end">
      <TextInput
        label="От себя одной фразой, если нужно"
        id={`promote-${entry.id}`}
        value={note}
        maxLength={NOTE_MAX}
        onChange={(e) => setNote(e.target.value)}
        className="sm:flex-1"
        hint="Запись попадёт в ваш weekly в команде выше, с автором и ссылкой. Переписывать её не нужно"
      />
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
          Отмена
        </Button>
        <Button size="sm" onClick={promote} disabled={busy}>
          Поднять в мой weekly
        </Button>
      </div>
    </div>
  );
}

/** Подпись под записью: кто уже поднял её наверх */
export function PromotedNote({ entry, className }: { entry: WeeklyEntry; className?: string }) {
  const { me } = usePrototype();
  // Свою отметку человек видит на кнопке «В вашем weekly», здесь только чужие
  const list = (entry.promoted ?? []).filter((p) => p.by !== me.slug);
  if (!list.length) return null;
  return <p className={cn("text-caption text-muted", className)}>Подняли наверх: {list.map((p) => compactName(p.by)).join(", ")}</p>;
}
