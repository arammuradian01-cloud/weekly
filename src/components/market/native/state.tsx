"use client";

// Состояние новой версии раздела «Рынок» в адресе страницы (этап 79): вид, сравнение, показатель и месяцы живут в
// /market?v=2&tab=...&cmp=mom, чтобы ссылкой можно было поделиться. Имена те же, что у старой версии. Вид меняется
// без запроса к серверу (history.replaceState, Next знает о таком обновлении адреса); срез регионов меняет ответ
// сервера и идёт переходом страницы, при этом прежний экран остаётся на месте приглушённым.

import { createContext, useContext, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

function writeParam(key: string, value: string | null) {
  const q = new URLSearchParams(window.location.search);
  if (value === null) q.delete(key);
  else q.set(key, value);
  const s = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${s ? `?${s}` : ""}`);
}

/** Параметр из списка допустимых: значение по умолчанию в адрес не пишется */
export function useUrlChoice<T extends string>(key: string, initial: string | undefined, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial && (allowed as readonly string[]).includes(initial) ? (initial as T) : fallback);
  const set = (v: T) => {
    setValue(v);
    writeParam(key, v === fallback ? null : v);
  };
  return [allowed.includes(value) ? value : fallback, set];
}

/** Свободный параметр (месяц): проверяет вызывающий */
export function useUrlValue(key: string, initial: string | undefined): [string | null, (v: string | null) => void] {
  const [value, setValue] = useState<string | null>(initial ?? null);
  const set = (v: string | null) => {
    setValue(v);
    writeParam(key, v);
  };
  return [value, set];
}

type Nav = { pending: boolean; go: (patch: Record<string, string | null>) => void };
const NavContext = createContext<Nav>({ pending: false, go: () => {} });

/** Переход с новым ответом сервера (срез регионов): остальные параметры адреса сохраняются */
export function MarketNav({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    start(() => router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false }));
  };
  return <NavContext.Provider value={{ pending, go }}>{children}</NavContext.Provider>;
}

export const useMarketNav = () => useContext(NavContext);

/** Содержимое вкладки: пока сервер считает новый срез, прежние цифры видны приглушёнными */
export function Busy({ children }: { children: React.ReactNode }) {
  const { pending } = useMarketNav();
  return (
    <div className={cn("mk", pending && "mk-busy")} aria-busy={pending || undefined}>
      {children}
    </div>
  );
}

export type SegOption<T extends string> = { value: T; label: string; disabled?: boolean };

/** Переключатель дизайн-системы (sv-segment) с выключенными вариантами */
export function Seg<T extends string>({ options, value, onChange, label, testId }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void; label: string; testId?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="sv-segment max-w-full flex-wrap" data-testid={testId}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} disabled={o.disabled} onClick={() => onChange(o.value)} className={cn("sv-segment__item", active && "is-active")}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
