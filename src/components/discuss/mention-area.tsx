"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { mentionQuery, mentionSuggestions } from "@/lib/discuss/mentions";
import { cn } from "@/lib/cn";
import { useMentionPeople } from "./mention-text";

const same = (a: string, b: string) => a.toLowerCase().replace(/ё/g, "е") === b.toLowerCase().replace(/ё/g, "е");

const control =
  "w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-body leading-relaxed text-ink placeholder:text-muted/70 hover:border-navy-600/40 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25 disabled:bg-surface disabled:text-muted";

/**
 * Поле с подсказкой упоминаний (этап 20): набираете «@» и начало имени, выбираете человека стрелками и Enter
 * или нажатием. В текст подставляется «@Фамилия Имя», как в списке людей
 */
export function MentionArea({
  id,
  label,
  value,
  onChange,
  rows = 2,
  maxLength,
  placeholder,
  hint,
  onSubmit,
  disabled,
  className,
  autoFocus,
  counter,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
  /** Ctrl+Enter или Cmd+Enter: отправить */
  onSubmit?: () => void;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  counter?: { value: number; max: number };
}) {
  const people = useMentionPeople();
  const ref = useRef<HTMLTextAreaElement>(null);
  // Куда поставить курсор после подстановки имени: сразу после отрисовки, до следующей нажатой клавиши
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (caretAfter.current === null || !el) return;
    el.focus();
    el.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  }, [value]);
  const listId = useId();
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);
  const options = query ? mentionSuggestions(people, query.query) : [];
  // Имя уже набрано целиком: подсказывать нечего, список не закрывает кнопки под полем
  const complete = !!query && options.some((p) => same(p.fullName, query.query.trimEnd()));
  const open = !!query && options.length > 0 && !complete;

  const sync = (text: string, caret: number) => {
    const q = mentionQuery(text, caret);
    setQuery(q);
    setActive(0);
  };

  const pick = (index: number) => {
    const person = options[index];
    const el = ref.current;
    if (!person || !query || !el) return;
    const caret = el.selectionStart ?? value.length;
    const insert = `@${person.fullName} `;
    const next = `${value.slice(0, query.start)}${insert}${value.slice(caret)}`;
    caretAfter.current = query.start + insert.length;
    onChange(next);
    setQuery(null);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {counter ? (
          <span className={cn("text-caption tabular-nums", counter.value > counter.max ? "text-danger-ink" : "text-muted")}>
            {counter.value} из {counter.max}
          </span>
        ) : null}
      </div>
      <div className="relative">
        <textarea
          ref={ref}
          id={id}
          rows={rows}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          className={cn(control, rows <= 2 ? "min-h-16" : "min-h-24")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            sync(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onClick={(e) => sync(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => (a + 1) % options.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => (a - 1 + options.length) % options.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pick(active);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setQuery(null);
                return;
              }
            }
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onSubmit) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Кого упомянуть"
            className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-auto rounded-lg border border-line bg-white p-1 shadow-menu"
          >
            {options.map((p, i) => (
              <li
                key={p.slug}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex min-h-10 cursor-pointer items-center rounded-md px-2.5 text-small text-ink", i === active && "bg-surface")}
              >
                {p.fullName}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {hint ? <p className="text-caption text-muted">{hint}</p> : null}
    </div>
  );
}
