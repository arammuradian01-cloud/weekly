"use client";

// Выбор из длинного списка с поиском (этап 53): люди всей компании, позже цели (этап 55), команды и подразделения
// (этап 74). Обычный выпадающий список на сотни строк не годится: в нём не найти человека, особенно с телефона. Поле
// с подсказками по образцу combobox из WAI-ARIA: стрелки двигают выбор, Enter выбирает, Escape закрывает список.

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { searchKey } from "@/domain/search-key";

export type PickerOption = {
  value: string;
  label: string;
  /** Вторая строка: должность и подразделение, код цели */
  hint?: string | null;
  /** Короткая пометка справа: «другая ветка» */
  note?: string | null;
};

/** Строка для поиска: регистр и ё не важны */
export { searchKey };

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
  autoFocus,
  required = false,
  menu = "float",
  labelHidden = false,
  disabled = false,
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
  /** Поле получает фокус сразу и показывает список: открыли выбор кнопкой «Выбрать цель» */
  autoFocus?: boolean;
  /**
   * Пустым поле не бывает (этап 74): ответственный, команда, подразделение. Очищенное поле при уходе возвращает
   * прежний выбор, второй Escape поле не очищает
   */
  required?: boolean;
  /**
   * Где список: поверх страницы (float) или в потоке под полем (static). В окне с прокруткой список поверх уходит под
   * край окна, в потоке окно растёт и список виден целиком (этап 74)
   */
  menu?: "float" | "static";
  /** Подпись только для экранного диктора: поле в строке таблицы или карточки */
  labelHidden?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const listInput = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState("");
  // Человек начал печатать: до этого список показывает все варианты, даже если в поле стоит выбранный (этап 55)
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Пока человек не печатал, выбранный вариант первым: Enter сразу после фокуса оставляет выбор как был, даже если
  // он дальше первой двадцатки
  const matched = useMemo(
    () => (typed ? options.filter((o) => matchOption(o, query)) : selected ? [selected, ...options.filter((o) => o.value !== selected.value)] : options),
    [options, query, typed, selected],
  );
  const shown = matched.slice(0, limit);
  const more = matched.length - shown.length;
  const text = open || !selected ? query : selected.label;
  // Активный пункт всегда в видимой части списка: стрелками можно уйти ниже края
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[id="${listId}-${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, listId]);
  // Список в потоке открылся у нижнего края окна: окно докручивается, чтобы первые варианты были видны
  useEffect(() => {
    if (open && menu === "static") listRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, menu]);

  const pick = (o: PickerOption) => {
    onChange(o.value);
    setQuery("");
    setTyped(false);
    setOpen(false);
  };
  const reopen = () => {
    setQuery(selected?.label ?? "");
    setTyped(false);
    setOpen(true);
    setActive(0);
  };

  return (
    <div className={cn("sv-field relative", className)}>
      <label htmlFor={id} className={labelHidden ? "sr-only" : "sv-label"}>
        {label}
      </label>
      <input
        ref={listInput}
        id={id}
        className="sv-control w-full"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={required || undefined}
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        // Выбранное значение для проверок и автотестов: в поле видна подпись, а не код
        data-value={value}
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onFocus={(e) => {
          // Выбранное остаётся в поле: повторный фокус не стирает текст. Список показывает все варианты, выбранный
          // подсвечен: чтобы сменить выбор, не нужно сначала стирать поле. Текст выделен: первая буква заменяет его
          if (selected) {
            const input = e.currentTarget;
            requestAnimationFrame(() => {
              if (document.activeElement === input) input.select();
            });
          }
          reopen();
        }}
        // Поле уже в фокусе, а список закрыт (выбрали мышью): щелчок открывает его снова
        onMouseDown={() => {
          if (!open && document.activeElement === listInput.current) reopen();
        }}
        onBlur={() => {
          // Напечатали и ушли, ничего не выбрав: в поле не остаётся текста, который выглядит как выбор. Поле снова
          // показывает выбор, который в силе: прежний или пустой, если поле очистили
          setOpen(false);
          setTyped(false);
          setQuery("");
        }}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setTyped(true);
          setOpen(true);
          setActive(0);
          // Этап 74: набранный текст выбор не меняет, пока не выбран вариант, брошенный ввод возвращает прежний выбор.
          // Очищенное поле снимает выбор сразу, если поле может быть пустым
          if (!next.trim() && value && !required) onChange("");
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) reopen();
            else setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && open && shown[active]) {
            e.preventDefault();
            pick(shown[active]!);
          } else if (e.key === "Enter" && open && typed) {
            // Ничего не нашлось: Enter не отправляет форму с текстом, который ничего не выбрал
            e.preventDefault();
          } else if (e.key === "Escape") {
            // Первый Escape закрывает список и отменяет набранный текст, второй очищает необязательное поле
            if (open) {
              setOpen(false);
              setQuery("");
              setTyped(false);
            } else if (!required) {
              setQuery("");
              setTyped(false);
              if (value) onChange("");
            }
          }
        }}
      />
      {hint ? (
        <p id={`${id}-hint`} className="sv-field__hint">
          {hint}
        </p>
      ) : null}
      {open ? (
        <div ref={listRef} className={cn("sv-menu m-0", menu === "static" && "sv-menu--static mt-1")}>
          <ul id={listId} role="listbox" aria-label={label} className="m-0 list-none p-0">
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
                className={cn("sv-menu__item items-start justify-between", i === active && "is-active", o.value === value && "font-semibold")}
              >
                <span className="min-w-0">
                  <span className="block text-body text-ink">{o.label}</span>
                  {o.hint ? <span className="block text-small text-muted">{o.hint}</span> : null}
                </span>
                {o.note ? <span className="shrink-0 text-caption text-muted">{o.note}</span> : null}
              </li>
            ))}
          </ul>
          {!shown.length ? <p className="sv-menu__group m-0">{emptyText}</p> : null}
          {more > 0 ? <p className="sv-menu__group m-0">Ещё {more}: уточните запрос</p> : null}
        </div>
      ) : null}
      {/* Сколько нашлось: экранный диктор читает это при вводе */}
      <span className="sr-only" aria-live="polite">
        {open ? (matched.length ? `Найдено: ${matched.length}` : emptyText) : ""}
      </span>
    </div>
  );
}
