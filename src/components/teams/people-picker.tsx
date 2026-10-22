"use client";

// Выбор нескольких людей с поиском по всей компании (этап 64): «Добавить участников» и новая команда сразу с людьми.
// Обычный выпадающий список на сотни строк не годится, а SearchPicker выбирает одного. Здесь поиск сверху, найденные
// люди строками с флажками, выбранные плашками над списком: их видно, даже когда поиск ушёл на другие фамилии.

import { useId, useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { teamSearchKey } from "@/lib/org/team-rights";

export type PickOption = {
  slug: string;
  fullName: string;
  position: string | null;
  unit: string | null;
  /** Пометка справа: «другая ветка» */
  note?: string | null;
  /** Почему выбрать нельзя: «уже в команде», «ждёт согласия». Строка видна, флажок выключен */
  blocked?: string | null;
};

const hintOf = (p: PickOption) => [p.position, p.unit].filter(Boolean).join(", ");

export function PeoplePicker({ id, label, people, value, onChange, limit = 30 }: { id: string; label: string; people: PickOption[]; value: string[]; onChange: (next: string[]) => void; limit?: number }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const chosen = useMemo(() => new Set(value), [value]);
  const bySlug = useMemo(() => new Map(people.map((p) => [p.slug, p])), [people]);
  const matched = useMemo(() => {
    const words = teamSearchKey(query).split(" ").filter(Boolean);
    if (!words.length) return people;
    return people.filter((p) => {
      const hay = teamSearchKey(`${p.fullName} ${hintOf(p)}`);
      return words.every((w) => hay.includes(w));
    });
  }, [people, query]);
  const shown = matched.slice(0, limit);
  const more = matched.length - shown.length;
  const toggle = (slug: string, on: boolean) => onChange(on ? [...value, slug] : value.filter((s) => s !== slug));

  return (
    <div className="flex flex-col gap-3">
      <div className="sv-field">
        <label htmlFor={id} className="sv-label">
          {label}
        </label>
        <input
          id={id}
          type="search"
          className="sv-control w-full"
          autoComplete="off"
          spellCheck={false}
          placeholder="Фамилия, должность или подразделение"
          value={query}
          aria-controls={listId}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {value.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-small text-muted" aria-live="polite">
            Выбрано: {value.length}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Выбранные люди">
            {value.map((slug) => {
              const p = bySlug.get(slug);
              const name = p?.fullName ?? slug;
              return (
                <li key={slug} className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-field py-0.5 pl-2.5 pr-0.5 text-caption text-ink">
                  <span className="truncate">{name}</span>
                  {p?.note ? <span className="shrink-0 text-muted">, {p.note}</span> : null}
                  {/* Поле нажатия 44 точки, а плашка остаётся низкой: кнопка выходит за неё отрицательными отступами */}
                  <button type="button" onClick={() => toggle(slug, false)} className="group -my-2.5 -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:text-ink" aria-label={`Убрать из выбора: ${name}`}>
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full group-hover:bg-surface">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto overscroll-contain rounded-control-lg border border-line">
        <ul id={listId} className="m-0 list-none divide-y divide-line p-0" aria-label="Найденные люди">
          {shown.map((p) => {
            const on = chosen.has(p.slug);
            const hint = hintOf(p);
            return (
              <li key={p.slug}>
                <label className={cn("flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-row-hover", on && "bg-row-selected", p.blocked && "cursor-default opacity-70 hover:bg-transparent")}>
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-blue-700" checked={on} disabled={!!p.blocked} onChange={(e) => toggle(p.slug, e.target.checked)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-ink">{p.fullName}</span>
                    {hint ? <span className="block text-small text-muted">{hint}</span> : null}
                  </span>
                  {p.blocked || p.note ? <span className="shrink-0 pt-0.5 text-caption text-muted">{p.blocked ?? p.note}</span> : null}
                </label>
              </li>
            );
          })}
        </ul>
        {!shown.length ? <p className="m-0 px-3 py-3 text-small text-muted">Никого не нашли: проверьте написание</p> : null}
        {more > 0 ? <p className="m-0 border-t border-line px-3 py-2 text-small text-muted">Ещё {more}: уточните запрос</p> : null}
      </div>
    </div>
  );
}
