"use client";

// Общие части экранов просьб (этап 21): метка состояния, выбор срока с быстрыми вариантами, выбор человека.

import { addDays, type IsoDate } from "@/domain/dates";
import { REQUEST_STATUS, type RequestStatusCode } from "@/domain/requests";
import { allPeople } from "@/domain/people";
import type { PersonSlug } from "@/domain/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { SelectField, TextInput } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const TONE: Record<(typeof REQUEST_STATUS)[RequestStatusCode]["tone"], BadgeTone> = { warning: "yellow", info: "blue", success: "green", neutral: "gray" };

export function RequestBadge({ status, stuck, className }: { status: RequestStatusCode; stuck?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap gap-1.5", className)}>
      <Badge tone={TONE[REQUEST_STATUS[status].tone]}>{REQUEST_STATUS[status].label}</Badge>
      {stuck ? <Badge tone="orange">Зависла</Badge> : null}
    </span>
  );
}

/** Ближайшая пятница после сегодняшнего дня */
function nextFriday(today: IsoDate): IsoDate {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  const shift = (5 - day + 7) % 7 || 7;
  return addDays(today, shift);
}

/** Срок: поле даты и быстрые варианты «Завтра», «Пятница», «Через неделю» */
export function DueField({ id, label, value, onChange, today }: { id: string; label: string; value: IsoDate; onChange: (v: IsoDate) => void; today: IsoDate }) {
  const quick: [string, IsoDate][] = [
    ["Завтра", addDays(today, 1)],
    ["Пятница", nextFriday(today)],
    ["Через неделю", addDays(today, 7)],
  ];
  return (
    <div className="flex flex-col gap-2">
      <TextInput label={label} id={id} type="date" min={today} value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Быстрый выбор срока">
        {quick.map(([text, date]) => (
          <button
            key={text}
            type="button"
            onClick={() => onChange(date)}
            aria-pressed={value === date}
            className={cn(
              "inline-flex h-9 items-center rounded-full px-3 text-small font-medium ring-1",
              value === date ? "bg-blue-soft text-blue-700 ring-blue/40" : "bg-white text-ink ring-line hover:bg-surface",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Кого просить: включённые люди департамента, кроме себя и наблюдателей, по алфавиту, с должностью */
export function PersonSelect({ id, label, value, onChange, exclude }: { id: string; label: string; value: string; onChange: (v: PersonSlug) => void; exclude: PersonSlug }) {
  const people = allPeople()
    .filter((p) => p.active && p.role !== "OBSERVER" && p.slug !== exclude)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
  const options = [{ value: "", label: "Выберите человека" }, ...people.map((p) => ({ value: p.slug, label: p.position ? `${p.fullName}, ${p.position}` : `${p.fullName}, ${p.zone}`.replace(/, $/, "") }))];
  return <SelectField label={label} id={id} value={value} onChange={(e) => onChange(e.target.value as PersonSlug)} options={options} />;
}
