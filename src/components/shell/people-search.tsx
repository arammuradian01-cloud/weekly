"use client";

// Поиск человека по ФИО, должности и подразделению: выбор «Смотреть как» (этап 63), «Сменить профиль» у владельца и
// экран «Выберите себя» общего логина (этап 71). Сразу видны первые 100 человек по алфавиту, остальных находит поиск:
// людей в структуре несколько сотен. Строки в одну колонку, длинные ФИО и должности переносятся, на 360 px без
// прокрутки вбок.

import { Search } from "lucide-react";
import { matchOption } from "@/components/ui/search-picker";
import { plural } from "@/domain/dates";
import { cn } from "@/lib/cn";

/** Строка выбора: ФИО, должность и подразделение по структуре, по желанию подпись роли. Кадровых полей нет */
export type SearchPerson = { id: string; fullName: string; position: string | null; unit: string | null; badge?: string | null };

/** Сколько строк показывать сразу: остальных находит поиск */
export const PEOPLE_SHOWN = 100;
export const PEOPLE_SEARCH_LABEL = "Поиск по ФИО, должности или подразделению";

export const personHint = (p: SearchPerson) => [p.position, p.unit].filter(Boolean).join(", ");

/** Подходит ли человек под набранное: все слова есть в ФИО, должности или подразделении, без учёта регистра и «ё» */
export const personMatches = (p: SearchPerson, query: string) => matchOption({ value: p.id, label: p.fullName, hint: personHint(p) }, query);

/** Найденные по запросу, первые PEOPLE_SHOWN из них и сколько ещё не показано */
export function filterPeople<T extends SearchPerson>(people: T[] | null, query: string): { matched: T[]; shown: T[]; more: number } {
  const matched = (people ?? []).filter((p) => personMatches(p, query));
  const shown = matched.slice(0, PEOPLE_SHOWN);
  return { matched, shown, more: matched.length - shown.length };
}

/** Поле поиска с лупой. onEnter: Enter выбирает первого из найденных */
export function PeopleSearchField({
  id,
  value,
  onChange,
  onEnter,
  className,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: (typed: string) => void;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {PEOPLE_SEARCH_LABEL}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          id={id}
          type="search"
          className="sv-control w-full pl-10"
          placeholder="ФИО, должность или подразделение"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !onEnter) return;
            e.preventDefault();
            onEnter(e.currentTarget.value);
          }}
        />
      </div>
    </div>
  );
}

/**
 * Список людей под поиском: сколько нашлось, строки, «никого не нашли», «ещё N: уточните поиск». Строка нажимается
 * (onPick) или отправляет форму (submitName: имя поля с номером человека)
 */
export function PeopleSearchList<T extends SearchPerson>({
  people,
  query,
  allText,
  listLabel,
  pending = false,
  busyId = null,
  busyText = "Открываем…",
  currentId = null,
  onPick,
  submitName,
}: {
  people: T[];
  query: string;
  /** Подпись над полным списком, пока поиск пуст: «Все люди компании: 240» */
  allText: (count: number) => string;
  listLabel: string;
  pending?: boolean;
  busyId?: string | null;
  busyText?: string;
  /** Кто выбран сейчас: строка отмечена */
  currentId?: string | null;
  onPick?: (person: T) => void;
  submitName?: string;
}) {
  const { matched, shown, more } = filterPeople(people, query);
  return (
    <>
      <p className="sv-cmdk__group" aria-live="polite">
        {query.trim() ? `Нашлось ${matched.length} ${plural(matched.length, "человек", "человека", "человек")}` : allText(people.length)}
      </p>
      {shown.length ? (
        <ul aria-label={listLabel} className="m-0 list-none p-0">
          {shown.map((p) => {
            const hint = personHint(p);
            const busy = pending && busyId === p.id;
            const current = currentId === p.id;
            return (
              <li key={p.id}>
                <button
                  type={submitName ? "submit" : "button"}
                  name={submitName}
                  value={submitName ? p.id : undefined}
                  className={cn("sv-cmdk__item !items-start", (busy || current) && "is-active")}
                  disabled={pending}
                  aria-busy={busy || undefined}
                  aria-current={current || undefined}
                  onClick={onPick ? () => onPick(p) : undefined}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-body font-medium text-ink">{p.fullName}</span>
                    {hint ? <span className="block break-words text-small text-muted">{hint}</span> : null}
                  </span>
                  {busy ? <span className="shrink-0 text-caption text-muted">{busyText}</span> : current ? <span className="shrink-0 text-caption text-muted">Сейчас</span> : p.badge ? <span className="shrink-0 text-caption text-muted">{p.badge}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-3 py-4 text-small text-muted">Никого не нашли: проверьте написание</p>
      )}
      {more > 0 ? <p className="px-3 py-2 text-caption text-muted">Ещё {more}: уточните поиск</p> : null}
    </>
  );
}
