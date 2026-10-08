"use client";

import { useId, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { submitRatingAction } from "@/app/(app)/meeting-rating/actions";
import type { RateTeam } from "@/lib/meeting-rating/service";
import { REMOVE_MAX } from "@/lib/meeting-rating/rules";
import { Button } from "@/components/ui/button";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { cn } from "@/lib/cn";

const SCORES: { value: number; hint: string }[] = [
  { value: 1, hint: "бесполезны" },
  { value: 2, hint: "скорее бесполезны" },
  { value: 3, hint: "средне" },
  { value: 4, hint: "полезны" },
  { value: 5, hint: "очень полезны" },
];

/** Ответ за месяц по одной команде: оценка от 1 до 5 и что убрать. После отправки поменять нельзя */
export function RateForm({ month, monthLabel, team }: { month: string; monthLabel: string; team: RateTeam }) {
  const run = useRunAction();
  const [score, setScore] = useState<number | null>(null);
  const [remove, setRemove] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(team.voted);
  const id = useId();
  const title = team.name;

  if (done) {
    return (
      <div className="sv-card sv-card--soft flex items-start gap-3 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success-ink" aria-hidden="true" />
        <p className="text-body text-ink">
          <span className="font-medium">«{title}»</span>: ответ за {monthLabel} учтён. Спасибо
        </p>
      </div>
    );
  }

  return (
    <form
      className="sv-card flex flex-col gap-4 p-4"
      aria-labelledby={`${id}-t`}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || score === null) return;
        setBusy(true);
        const ok = await run(() => submitRatingAction(team.id, month, score, remove), "Ответ учтён. Спасибо");
        setBusy(false);
        if (ok !== null) setDone(true);
      }}
    >
      <div>
        <h3 id={`${id}-t`} className="text-body font-semibold text-ink">
          {title}
        </h3>
        {team.leaderName ? <p className="text-small text-muted">Встречи ведёт {team.leaderName}</p> : null}
      </div>
      <fieldset disabled={busy} className="flex flex-col gap-2">
        <legend className="mb-2 text-small font-medium text-ink">Насколько полезны встречи команды за {monthLabel}</legend>
        <div className="sv-segment max-w-full flex-wrap self-start">
          {SCORES.map((s) => (
            <label
              key={s.value}
              className={cn(
                "sv-segment__item min-h-11 min-w-11 cursor-pointer has-[:focus-visible]:[outline:var(--focus-outline)]",
                score === s.value && "is-active",
              )}
            >
              <input
                type="radio"
                name={`${id}-score`}
                value={s.value}
                checked={score === s.value}
                onChange={() => setScore(s.value)}
                aria-label={`${s.value}, ${s.hint}`}
                className="sr-only"
              />
              <span aria-hidden="true">{s.value}</span>
            </label>
          ))}
        </div>
        <p className="text-caption text-muted">1: бесполезны, 5: очень полезны</p>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-remove`} className="text-small font-medium text-ink">
          Что убрать из встреч
        </label>
        <textarea
          id={`${id}-remove`}
          className="sv-control"
          rows={2}
          maxLength={REMOVE_MAX}
          value={remove}
          disabled={busy}
          onChange={(e) => setRemove(e.target.value)}
          aria-describedby={`${id}-remove-hint`}
        />
        <p id={`${id}-remove-hint`} className="text-caption text-muted">
          Одна-две фразы, можно оставить пустым. Комментарий покажется, только если ответили хотя бы трое
        </p>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={busy || score === null}>
          Отправить анонимно
        </Button>
      </div>
    </form>
  );
}
