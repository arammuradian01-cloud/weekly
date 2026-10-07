"use client";

import { useState } from "react";
import { saveMailPrefsAction } from "@/app/(app)/profile/actions";
import { PREF_LABELS, type MailPrefKey, type MailPrefs } from "@/lib/letters/schedule";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";

const ORDER: MailPrefKey[] = ["tasks", "mentions", "reactions", "reminders", "digest"];

/** Какие письма приходят (этап 20): каждый тип можно выключить. Сохраняется только при личном входе */
export function MailPrefsForm({ initial, locked }: { initial: MailPrefs; locked: boolean }) {
  const run = useRunAction();
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState(false);
  const changed = ORDER.some((k) => prefs[k] !== initial[k]);
  return (
    <form
      className="mt-4 flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || locked) return;
        setBusy(true);
        await run(() => saveMailPrefsAction(prefs), "Настройки писем сохранены");
        setBusy(false);
      }}
    >
      <fieldset disabled={locked || busy} className="flex flex-col gap-3">
        <legend className="sr-only">Какие письма присылать</legend>
        {ORDER.map((key) => (
          <label key={key} className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={prefs[key]}
              onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })}
              className="mt-1 h-4 w-4 shrink-0 accent-blue-700"
            />
            <span>
              <span className="block text-body font-medium text-ink">{PREF_LABELS[key].title}</span>
              <span className="block text-small text-muted">{PREF_LABELS[key].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {locked ? null : (
        <div>
          <Button size="sm" type="submit" variant="secondary" disabled={!changed || busy}>
            Сохранить
          </Button>
        </div>
      )}
    </form>
  );
}
