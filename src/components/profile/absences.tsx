"use client";

import { useState } from "react";
import { CalendarOff, X } from "lucide-react";
import { formatLong } from "@/domain/dates";
import type { AbsenceView } from "@/lib/weekly/service";
import { removeAbsenceAction, setAbsenceAction } from "@/app/(app)/profile/actions";
import { removeAbsenceForAction, setAbsenceForAction } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/primitives";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { substituteText } from "@/components/weekly/absence";
import { cn } from "@/lib/cn";

type WeekOption = { value: string; label: string };

const rangeOf = (a: { number: number; start: string; end: string }) => `неделя ${a.number}, ${formatLong(a.start)} - ${formatLong(a.end)}`;

/**
 * «Нет на неделе»: отпуск или больничный с замещающим (этап 9). Weekly за эту неделю не ждём.
 * Без slug: свой профиль. Со slug: владелец отмечает коллегу в списке людей
 */
export function Absences({
  absences,
  weeks,
  people,
  slug = null,
}: {
  absences: AbsenceView[];
  weeks: WeekOption[];
  people: { value: string; label: string }[];
  slug?: string | null;
}) {
  const run = useRunAction();
  const set = (week: string, substitute: string | null) => (slug ? setAbsenceForAction(slug, week, substitute) : setAbsenceAction(week, substitute));
  const remove = (week: string) => (slug ? removeAbsenceForAction(slug, week) : removeAbsenceAction(week));
  const free = weeks.filter((w) => !absences.some((a) => a.week === w.value));
  const [week, setWeek] = useState(free[0]?.value ?? "");
  const [substitute, setSubstitute] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-4 flex flex-col gap-5">
      {absences.length ? (
        <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft">
          {absences.map((a) => (
            <li key={a.week} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <CalendarOff className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                <div>
                  <p className="text-body font-medium text-ink">{rangeOf(a).replace(/^н/, "Н")}</p>
                  <p className="text-caption text-muted">{substituteText(a.substitute).replace(/^з/, "З").replace(/^б/, "Б")}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Убрать отсутствие: неделя ${a.number}`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await run(() => remove(a.week), slug ? `Неделя ${a.number}: отметка снята` : `Неделя ${a.number}: вы на месте`);
                  setBusy(false);
                }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Убрать
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted">Отсутствий не отмечено.</p>
      )}

      {free.length ? (
        <form
          className={cn("flex flex-col gap-3 sv-card sv-card--soft p-4", !slug && "sm:flex-row sm:items-end")}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!week) return;
            setBusy(true);
            const r = await run(() => set(week, substitute || null), "Отсутствие отмечено");
            setBusy(false);
            if (r) setWeek(free.find((w) => w.value !== week)?.value ?? "");
          }}
        >
          <SelectField label="Неделя" id={slug ? `absence-week-${slug}` : "absence-week"} value={week} onChange={(e) => setWeek(e.target.value)} options={free} className={slug ? undefined : "sm:flex-1"} />
          <SelectField
            label="Кто замещает"
            id={slug ? `absence-substitute-${slug}` : "absence-substitute"}
            value={substitute}
            onChange={(e) => setSubstitute(e.target.value)}
            options={[{ value: "", label: "Без замещающего" }, ...people]}
            className={slug ? undefined : "sm:flex-1"}
          />
          <Button type="submit" disabled={busy || !week}>
            Отметить
          </Button>
        </form>
      ) : null}
    </div>
  );
}
