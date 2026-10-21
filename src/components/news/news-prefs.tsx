"use client";

// Дайджест новостей в профиле (этап 60): частота и продукты. По умолчанию не присылать (решение Арама 22.10),
// продукты своего направления. Сохраняется только при личном входе

import { useState } from "react";
import { saveNewsPrefsAction } from "@/app/(app)/news/actions";
import { NEWS_FREQUENCIES, NEWS_FREQUENCY_LABELS, type NewsFrequency, type NewsPrefs } from "@/lib/news/prefs";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";

export function NewsPrefsForm({
  initial,
  directions,
  defaults,
  locked,
}: {
  initial: NewsPrefs;
  directions: { code: string; label: string }[];
  /** Продукты по направлению из карточки: так выглядит «по умолчанию» */
  defaults: string[];
  locked: boolean;
}) {
  const run = useRunAction();
  const [frequency, setFrequency] = useState<NewsFrequency>(initial.frequency);
  const [custom, setCustom] = useState(initial.directions !== null);
  const [picked, setPicked] = useState<string[]>(initial.directions ?? defaults);
  const [busy, setBusy] = useState(false);
  const selected = custom ? picked : defaults;
  const changed = frequency !== initial.frequency || custom !== (initial.directions !== null) || (custom && picked.join() !== (initial.directions ?? []).join());
  return (
    <form
      className="mt-4 flex flex-col gap-4"
      data-testid="news-prefs"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || locked) return;
        setBusy(true);
        await run(() => saveNewsPrefsAction({ frequency, directions: custom ? picked : null }), "Настройки дайджеста сохранены");
        setBusy(false);
      }}
    >
      <fieldset disabled={locked || busy} className="flex flex-col gap-2">
        <legend className="text-body font-medium text-ink">Как часто</legend>
        {NEWS_FREQUENCIES.map((f) => (
          <label key={f} className="flex cursor-pointer items-center gap-3">
            <input type="radio" name="news-frequency" value={f} checked={frequency === f} onChange={() => setFrequency(f)} className="h-4 w-4 accent-blue-700" />
            <span className="text-body text-ink">{NEWS_FREQUENCY_LABELS[f]}</span>
          </label>
        ))}
        <p className="text-small text-muted">
          Дайджест приходит утром по Москве в «Мне» и письмом, если почта настроена. Без новостей по вашим продуктам не приходит. Пока вы не выбрали сами: с направлением в карточке раз в
          неделю, без направления не присылать.
        </p>
      </fieldset>
      <fieldset disabled={locked || busy || frequency === "off"} className="flex flex-col gap-2">
        <legend className="text-body font-medium text-ink">Какие продукты</legend>
        <label className="flex cursor-pointer items-center gap-3">
          <input type="radio" name="news-directions-mode" checked={!custom} onChange={() => setCustom(false)} className="h-4 w-4 accent-blue-700" />
          <span className="text-body text-ink">Продукты моего направления: {defaults.map((c) => directions.find((d) => d.code === c)?.label ?? c).join(", ") || "не заданы"}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-3">
          <input type="radio" name="news-directions-mode" checked={custom} onChange={() => setCustom(true)} className="h-4 w-4 accent-blue-700" />
          <span className="text-body text-ink">Выбрать самому</span>
        </label>
        {custom ? (
          <div className="ml-7 flex flex-wrap gap-x-5 gap-y-2" data-testid="news-prefs-directions">
            {directions.map((d) => (
              <label key={d.code} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(d.code)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, d.code] : p.filter((c) => c !== d.code)))}
                  className="h-4 w-4 accent-blue-700"
                />
                <span className="text-body text-ink">{d.label}</span>
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
      {locked ? null : (
        <div>
          <Button size="sm" type="submit" variant="secondary" disabled={!changed || busy} data-testid="news-prefs-save">
            Сохранить
          </Button>
        </div>
      )}
    </form>
  );
}
