"use client";

// Выбор из длинного списка с поиском (этап 53): люди всей компании, позже цели (этап 55). Обычный выпадающий список
// на сотни строк не годится: в нём не найти человека, особенно с телефона. Поле с подсказками по образцу combobox
// из WAI-ARIA: стрелки двигают выбор, Enter выбирает, Escape закрывает список.

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  autoFocus,
  inline = false,
  clearable = true,
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
   * Список вариантов в потоке под полем, а не поверх (этап 70): в окне с прокруткой (Modal) всплывающий список
   * обрезается краем окна, а в потоке окно растёт и прокручивается вместе с ним
   */
  inline?: boolean;
  /**
   * Можно ли оставить поле пустым (этап 70). Нельзя: печать не снимает выбранное, уход из поля без выбора оставляет
   * прежнее, Escape не очищает. Так «Команда выше»: её меняют, но не убирают
   */
  clearable?: boolean;
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

  // Список в потоке (окно с прокруткой): открылся, и окно прокручивается, чтобы был виден низ списка, но поле ввода
  // не уходило за верхний край. Прокручиваем только само окно, страницу под ним не трогаем
  useEffect(() => {
    if (!open || !inline) return;
    const list = listRef.current;
    const input = listInput.current;
    const box = input?.closest<HTMLElement>('[role="dialog"]');
    if (!list || !input || !box) return;
    const edge = box.getBoundingClientRect();
    const below = list.getBoundingClientRect().bottom - edge.bottom + 8;
    if (below > 0) box.scrollTop += Math.min(below, input.getBoundingClientRect().top - edge.top - 8);
  }, [open, inline]);
  const pick = (o: PickerOption) => {
    onChange(o.value);
    setQuery("");
    setTyped(false);
    setOpen(false);
  };

  const hintBlock = hint ? (
    <p id={`${id}-hint`} className="sv-field__hint">
      {hint}
    </p>
  ) : null;

  return (
    <div className={cn("sv-field relative", className)}>
      <label htmlFor={id} className="sv-label">
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
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        aria-describedby={hint ? `${id}-hint` : undefined}
        placeholder={placeholder}
        value={text}
        autoFocus={autoFocus}
        onFocus={(e) => {
          // Выбранное остаётся в поле: повторный фокус не стирает текст. Список показывает все варианты, выбранный
          // подсвечен: чтобы сменить выбор, не нужно сначала стирать поле. Текст выделен: первая буква заменяет его
          if (selected) {
            setQuery(selected.label);
            const input = e.currentTarget;
            requestAnimationFrame(() => {
              if (document.activeElement === input) input.select();
            });
          }
          setTyped(false);
          setOpen(true);
          setActive(0);
        }}
        // Поле уже в фокусе, а список закрыт (выбрали мышью): щелчок открывает его снова
        onMouseDown={(e) => {
          // В потоке окна закрытие списка предыдущего поля меняет его высоту. Передаём фокус до стандартной
          // обработки щелчка: иначе поле уезжает из-под указателя, и Radix возвращает фокус самому окну.
          if (inline && document.activeElement !== e.currentTarget) {
            e.preventDefault();
            e.currentTarget.focus({ preventScroll: true });
          }
          if (!open && document.activeElement === listInput.current) {
            setTyped(false);
            setOpen(true);
            setActive(0);
          }
        }}
        onBlur={() => {
          setOpen(false);
          setTyped(false);
          // Напечатали и ушли, ничего не выбрав: в поле не остаётся текста, который выглядит как выбор. Поле снова
          // показывает выбранный вариант, если он есть, иначе пусто
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setTyped(true);
          setOpen(true);
          setActive(0);
          if (value && clearable) onChange("");
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
            // Первый Escape закрывает список, второй очищает поле (если его можно оставить пустым)
            if (open) setOpen(false);
            else {
              setQuery("");
              setTyped(false);
              if (value && clearable) onChange("");
            }
          }
        }}
      />
      {inline ? null : hintBlock}
      {open ? (
        <div ref={listRef} className={cn("sv-menu m-0", inline && "sv-menu--static mt-1 max-h-none overflow-visible")}>
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
                className={cn("sv-menu__item items-start justify-between", i === active && "is-active")}
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
      {inline ? hintBlock : null}
      {/* Сколько нашлось: экранный диктор читает это при вводе */}
      <span className="sr-only" aria-live="polite">
        {open ? (matched.length ? `Найдено: ${matched.length}` : emptyText) : ""}
      </span>
    </div>
  );
}
