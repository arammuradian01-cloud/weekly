"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { saveNumbersAccessAction } from "@/app/(app)/settings/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { SearchPicker } from "@/components/ui/search-picker";
import { plural } from "@/domain/dates";
import type { NumbersAccessView } from "@/lib/plan/access";

type Group = { units: string[]; people: string[] };

/** Департаменты галочками и люди поиском: один уровень доступа */
function LevelFields({ prefix, value, onChange, view }: { prefix: string; value: Group; onChange: (next: Group) => void; view: NumbersAccessView }) {
  const [pick, setPick] = useState("");
  const names = new Map(view.people.map((p) => [p.slug, p.name]));
  return (
    <div className="flex flex-col gap-4">
      {view.departments.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-small font-medium text-ink">Департаменты целиком</p>
          {view.departments.map((d) => (
            <label key={d.id} className="flex min-h-9 items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={value.units.includes(d.id)}
                onChange={(e) => onChange({ ...value, units: e.target.checked ? [...value.units, d.id] : value.units.filter((id) => id !== d.id) })}
              />
              {d.name}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-small text-muted">Департаменты появятся после загрузки структуры компании.</p>
      )}
      <div className="flex flex-col gap-2">
        <SearchPicker
          id={`${prefix}-person`}
          label="Отдельные люди"
          options={view.people.filter((p) => !value.people.includes(p.slug)).map((p) => ({ value: p.slug, label: p.name, hint: p.hint }))}
          value={pick}
          onChange={(slug) => {
            if (slug) onChange({ ...value, people: [...value.people, slug] });
            setPick("");
          }}
          placeholder="Фамилия или должность"
        />
        {value.people.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Выбранные люди">
            {value.people.map((slug) => (
              <li key={slug} className="inline-flex items-center gap-1 rounded-full bg-field py-0.5 pl-2.5 pr-0.5 text-small text-ink">
                {names.get(slug) ?? slug}
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink"
                  aria-label={`Убрать: ${names.get(slug) ?? slug}`}
                  onClick={() => onChange({ ...value, people: value.people.filter((s) => s !== slug) })}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Доступ к цифрам прогноза (этап 57, решение Арама 21.10: уровень видимости настраивается, весь топ-менеджмент видит
 * основные цифры). Два уровня: все цифры и основные. Кто видит цифры всегда, написано в описании
 */
export function NumbersAccessSection({ initial }: { initial: NumbersAccessView }) {
  const headingId = useId();
  const run = useRunAction();
  const [view, setView] = useState(initial);
  const [full, setFull] = useState<Group>(initial.access.full);
  const [summary, setSummary] = useState<Group>({ units: initial.access.summary.units, people: initial.access.summary.people });
  const [top, setTop] = useState(initial.access.summary.topManagement);
  const [busy, setBusy] = useState(false);
  const people = (n: number) => `${n} ${plural(n, "человек", "человека", "человек")}`;
  return (
    <section id="numbers-access" aria-labelledby={headingId} className="sv-toc-section border-t border-line py-8" data-testid="numbers-access-section">
      <div className="max-w-[72ch]">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Доступ к цифрам
        </h2>
        <p className="mt-1 text-small text-muted">
          Раздел «Прогноз» видят все. Все цифры: прогноз месяца по драйверам, партнёры, сравнение версий, цифры недели, прогноз лидеров и выгрузка. Основные цифры: итог месяца
          по продуктам против бюджета и LBE и цифры недели, без драйверов и корректировок. Все цифры всегда видят владельцы и администраторы, топ-команда, генеральный
          директор и команды продуктов и партнёрского канала из «Прогноза».
        </p>
        <p className="mt-2 text-small text-ink" data-testid="numbers-access-counts">
          Сейчас все цифры видят {people(view.counts.full)}, основные {people(view.counts.summary)}.
        </p>
      </div>
      <form
        className="mt-5 flex max-w-2xl flex-col gap-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const saved = await run(() => saveNumbersAccessAction({ full, summary: { ...summary, topManagement: top } }), "Доступ к цифрам сохранён");
          if (saved) {
            setView(saved);
            setFull(saved.access.full);
            setSummary({ units: saved.access.summary.units, people: saved.access.summary.people });
            setTop(saved.access.summary.topManagement);
          }
          setBusy(false);
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-body font-semibold text-ink">Все цифры</legend>
          <LevelFields prefix="numbers-full" value={full} onChange={setFull} view={view} />
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-body font-semibold text-ink">Основные цифры</legend>
          <label className="flex min-h-9 items-center gap-2 text-body text-ink">
            <input type="checkbox" className="h-4 w-4" checked={top} onChange={(e) => setTop(e.target.checked)} />
            Топ-менеджмент: руководители департаментов и подразделений прямо под генеральным директором
          </label>
          <LevelFields prefix="numbers-summary" value={summary} onChange={setSummary} view={view} />
        </fieldset>
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Сохраняем" : "Сохранить"}
          </Button>
        </div>
      </form>
    </section>
  );
}
