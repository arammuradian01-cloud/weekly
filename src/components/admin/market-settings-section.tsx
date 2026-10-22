"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { saveMarketSettingsAction } from "@/app/(app)/settings/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/search-picker";
import { usePrototype } from "@/domain/store";
import type { MarketSettingsView } from "@/lib/market/access";
import { isDirty, LEAVE_TEXT, listDiff, marketCountText, marketSavedText, unsavedText, type ListDiff } from "@/lib/market/draft";
import { useLeaveGuard } from "./use-leave-guard";

type Saving = "people" | "teams" | "all" | null;

/**
 * Строка «Не сохранено» под списком (этап 72): что изменится, «Сохранить» и «Отменить». Кнопки обычного размера,
 * 44 px, на телефоне строка переносится, кнопки остаются под текстом
 */
function UnsavedBar({ diff, testId, saveLabel, saving, disabled, onSave, onCancel }: { diff: ListDiff; testId: string; saveLabel: string; saving: boolean; disabled: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="sv-alert sv-alert--warning mt-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" data-testid={testId}>
      <p className="m-0 font-medium" data-testid={`${testId}-text`}>
        {unsavedText(diff)}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="dark" onClick={onSave} disabled={disabled} loading={saving} data-testid={`${testId}-save`}>
          {saveLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={disabled} data-testid={`${testId}-cancel`}>
          Отменить
        </Button>
      </div>
    </div>
  );
}

/**
 * Рынок КАСКО и ОСАГО (этап 62, решение Арама 22.10): рынок разбираем на встрече в начале каждого месяца. Владелец
 * выбирает людей с доступом и команды, у которых на первой встрече месяца первым пунктом встаёт разбор рынка.
 * Этап 72 (решение Арама 23.10): владельцы, режим управления и вход по общему логину видят раздел всегда, при личном
 * входе без режима управления остальные по списку. Правки списков видны сразу под ними строкой «Не сохранено» со своей кнопкой, уход со страницы
 * с несохранёнными правками переспрашивается
 */
export function MarketSettingsSection({ initial, teamLogin = true }: { initial: MarketSettingsView; teamLogin?: boolean }) {
  const headingId = useId();
  const run = useRunAction();
  const { notify } = usePrototype();
  const [view, setView] = useState(initial);
  const [people, setPeople] = useState<string[]>(initial.people);
  const [teamIds, setTeamIds] = useState<string[]>(initial.teamIds);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState<Saving>(null);
  const names = new Map(view.options.map((p) => [p.slug, p.name]));
  const stale = view.stale.people + view.stale.teams;
  const peopleDiff = listDiff(people, view.people);
  const teamsDiff = listDiff(teamIds, view.teamIds);
  const peopleDirty = isDirty(peopleDiff);
  const teamsDirty = isDirty(teamsDiff);
  useLeaveGuard(peopleDirty || teamsDirty, LEAVE_TEXT);

  /** Сохраняет выбранные списки; несохранённый черновик другого списка остаётся как есть */
  const save = async (what: Exclude<Saving, null>) => {
    setSaving(what);
    const input = what === "people" ? { people } : what === "teams" ? { teamIds } : { people, teamIds };
    const saved = await run(() => saveMarketSettingsAction(input));
    if (saved) {
      setView(saved);
      if (what !== "teams") setPeople(saved.people);
      if (what !== "people") setTeamIds(saved.teamIds);
      notify(what === "teams" ? "Разбор рынка на встречах сохранён" : what === "people" || peopleDirty ? marketSavedText(saved.count) : "Настройка рынка сохранена");
    }
    setSaving(null);
  };

  return (
    <section id="market" aria-labelledby={headingId} className="sv-toc-section border-t border-line py-8" data-testid="market-settings">
      <div className="max-w-[72ch]">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Рынок КАСКО и ОСАГО
        </h2>
        <p className="mt-1 text-small text-muted">
          Владельцы, все в режиме управления и все, кто входит по общему логину, видят раздел «Рынок» всегда. При личном входе без режима управления
          остальные видят его, если они в списке ниже. Пакет рынка загружает владелец при личном входе на странице раздела.
        </p>
        <p className="mt-2 text-small text-ink" data-testid="market-settings-count">
          {marketCountText(view.count, view.owners, teamLogin)}
        </p>
        {stale ? (
          <p className="mt-2 text-small font-medium text-danger-ink" role="status" data-testid="market-settings-stale">
            В настройке есть люди или команды, которых больше нет или они выключены: {stale}. Им раздел и разбор на встрече не работают. Проверьте списки ниже и сохраните.
          </p>
        ) : null}
      </div>
      <form
        className="mt-5 flex max-w-2xl flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save("all");
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body font-semibold text-ink">Кто видит раздел при личном входе</legend>
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
          <div aria-live="polite">
            {peopleDirty ? (
              <UnsavedBar
                diff={peopleDiff}
                testId="market-people-unsaved"
                saveLabel="Сохранить доступ"
                saving={saving === "people"}
                disabled={saving !== null}
                onSave={() => void save("people")}
                onCancel={() => {
                  setPeople(view.people);
                  setPick("");
                }}
              />
            ) : null}
          </div>
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
          <div aria-live="polite">
            {teamsDirty ? (
              <UnsavedBar
                diff={teamsDiff}
                testId="market-teams-unsaved"
                saveLabel="Сохранить разбор"
                saving={saving === "teams"}
                disabled={saving !== null}
                onSave={() => void save("teams")}
                onCancel={() => setTeamIds(view.teamIds)}
              />
            ) : null}
          </div>
        </fieldset>
        <div>
          <Button type="submit" disabled={saving !== null} data-testid="market-settings-save">
            {saving === "all" ? "Сохраняем" : "Сохранить"}
          </Button>
        </div>
      </form>
    </section>
  );
}
