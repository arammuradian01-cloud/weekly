"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { saveMarketSettingsAction } from "@/app/(app)/settings/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/search-picker";
import { plural } from "@/domain/dates";
import type { MarketSettingsView } from "@/lib/market/access";

/**
 * Рынок КАСКО и ОСАГО (этап 62, решение Арама 22.10): раздел открыт отдельным людям, рынок разбираем на встрече в
 * начале каждого месяца. Владелец выбирает людей с доступом и команды, у которых на первой встрече месяца первым
 * пунктом встаёт разбор рынка. Владельцы видят раздел всегда; по общему логину раздела нет ни у кого
 */
export function MarketSettingsSection({ initial }: { initial: MarketSettingsView }) {
  const headingId = useId();
  const run = useRunAction();
  const [view, setView] = useState(initial);
  const [people, setPeople] = useState<string[]>(initial.people);
  const [teamIds, setTeamIds] = useState<string[]>(initial.teamIds);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const names = new Map(view.options.map((p) => [p.slug, p.name]));
  const stale = view.stale.people + view.stale.teams;
  return (
    <section id="market" aria-labelledby={headingId} className="sv-toc-section border-t border-line py-8" data-testid="market-settings">
      <div className="max-w-[72ch]">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Рынок КАСКО и ОСАГО
        </h2>
        <p className="mt-1 text-small text-muted">
          Раздел «Рынок» открыт отдельным людям: владельцы видят его всегда, остальные по списку ниже. Только при личном входе, по общему логину раздела нет. Пакет рынка
          загружает владелец на странице раздела.
        </p>
        <p className="mt-2 text-small text-ink" data-testid="market-settings-count">
          Сейчас раздел видят {view.count} {plural(view.count, "человек", "человека", "человек")}, из них владельцев {view.owners}.
        </p>
        {stale ? (
          <p className="mt-2 text-small font-medium text-danger-ink" role="status" data-testid="market-settings-stale">
            В настройке есть люди или команды, которых больше нет или они выключены: {stale}. Им раздел и разбор на встрече не работают. Проверьте списки ниже и сохраните.
          </p>
        ) : null}
      </div>
      <form
        className="mt-5 flex max-w-2xl flex-col gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const saved = await run(() => saveMarketSettingsAction({ people, teamIds }), "Настройка рынка сохранена");
          if (saved) {
            setView(saved);
            setPeople(saved.people);
            setTeamIds(saved.teamIds);
          }
          setBusy(false);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body font-semibold text-ink">Кто видит раздел</legend>
          <SearchPicker
            id="market-person"
            label="Люди с доступом"
            options={view.options.filter((p) => !people.includes(p.slug)).map((p) => ({ value: p.slug, label: p.name, hint: p.hint }))}
            value={pick}
            onChange={(slug) => {
              if (slug) setPeople([...people, slug]);
              setPick("");
            }}
            placeholder="Фамилия или должность"
          />
          {people.length ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Люди с доступом к рынку" data-testid="market-settings-people">
              {people.map((slug) => (
                <li key={slug} className="inline-flex items-center gap-1 rounded-full bg-field py-0.5 pl-2.5 pr-0.5 text-small text-ink">
                  {names.get(slug) ?? slug}
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
                    aria-label={`Убрать доступ: ${names.get(slug) ?? slug}`}
                    onClick={() => setPeople(people.filter((s) => s !== slug))}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted">Пока только владельцы.</p>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body font-semibold text-ink">Разбор на встрече</legend>
          <p className="text-small text-muted">На первой встрече команды в месяце первым пунктом встаёт «Рынок КАСКО и ОСАГО: итоги прошлого месяца», когда пакет рынка загружен.</p>
          {view.teams.map((t) => (
            <label key={t.id} className="flex min-h-9 items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={teamIds.includes(t.id)}
                onChange={(e) => setTeamIds(e.target.checked ? [...teamIds, t.id] : teamIds.filter((id) => id !== t.id))}
              />
              {t.name}
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" disabled={busy} data-testid="market-settings-save">
            {busy ? "Сохраняем" : "Сохранить"}
          </Button>
        </div>
      </form>
    </section>
  );
}
