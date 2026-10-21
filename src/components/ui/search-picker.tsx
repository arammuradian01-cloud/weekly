"use client";

// Выбор из длинного списка с поиском (этап 53): люди всей компании, позже цели (этап 55). Обычный выпадающий список
// на сотни строк не годится: в нём не найти человека, особенно с телефона. Поле с подсказками по образцу combobox
// из WAI-ARIA: стрелки двигают выбор, Enter выбирает, Escape закрывает список.

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type PickerOption = {
  value: string;
  label: string;
  /** Вторая строка: должность и подразделение, код цели */
  hint?: string | null;
  /** Короткая пометка справа: «другая ветка» */
  note?: string | null;
};

/** Строка для поиска: регистр и ё не важны */
export const searchKey = (text: string) => text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** Подходит ли вариант: каждое слово запроса есть в названии или второй строке */
export function matchOption(option: PickerOption, query: string): boolean {
  const words = searchKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = searchKey(`${option.label} ${option.hint ?? ""}`);
  return words.every((w) => hay.includes(w));
}

export function SearchPicker({
  id,
  label,
  options,
  value,
  onChange,
  placeholder = "Начните вводить",
  hint,
  limit = 20,
  emptyText = "Никого не нашли: проверьте написание",
  className,
}: {
  id: string;
  label: string;
  options: PickerOption[];
  /** Выбранное значение: пустая строка, пока ничего не выбрано */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  limit?: number;
  emptyText?: string;
  className?: string;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const matched = useMemo(() => options.filter((o) => matchOption(o, query)), [options, query]);
  const shown = matched.slice(0, limit);
  const more = matched.length - shown.length;
  const text = open || !selected ? query : selected.label;

  const pick = (o: PickerOption) => {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className={cn("sv-field relative", className)}>
      <label htmlFor={id} className="sv-label">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="sv-control w-full"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        placeholder={placeholder}
        value={text}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {hint ? (
        <p id={`${id}-hint`} className="sv-field__hint">
          {hint}
        </p>
      ) : null}
      {open ? (
        <ul id={listId} role="listbox" aria-label={label} className="sv-menu m-0 list-none">
          {shown.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, а не click: иначе поле теряет фокус и список закрывается раньше выбора
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn("sv-menu__item items-start justify-between", i === active && "is-active")}
            >
              <span className="min-w-0">
                <span className="block text-body text-ink">{o.label}</span>
                {o.hint ? <span className="block text-small text-muted">{o.hint}</span> : null}
              </span>
              {o.note ? <span className="shrink-0 text-caption text-muted">{o.note}</span> : null}
            </li>
          ))}
          {!shown.length ? <li className="sv-menu__group">{emptyText}</li> : null}
          {more > 0 ? <li className="sv-menu__group">Ещё {more}: уточните запрос</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
