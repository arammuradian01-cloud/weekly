"use client";

// Тема оформления (этап 18): светлая, тёмная или как в системе. Выбор хранится в cookie на этом устройстве
// и применяется сразу, без перезагрузки; при «как в системе» следим за настройкой устройства.
// Этап 68: в меню профиля (288 px) три кнопки в строку по 70 px, и «Как в системе» вылезала за край кнопки.
// Теперь плитки: иконка сверху, подпись под ней в две строки при нужде, подпись видна и на телефоне

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

export type ThemeChoice = "light" | "dark" | "system";

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Светлая", icon: Sun },
  { value: "dark", label: "Тёмная", icon: Moon },
  { value: "system", label: "Как в системе", icon: Monitor },
];

export function readTheme(): ThemeChoice {
  if (typeof document === "undefined") return "system";
  const m = /(?:^|; )theme=(light|dark|system)/.exec(document.cookie);
  return (m?.[1] as ThemeChoice | undefined) ?? "system";
}

export function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme-choice", choice);
}

export function ThemeSwitch({ className }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => setChoice(readTheme()), []);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => readTheme() === "system" && applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const pick = (value: ThemeChoice) => {
    setChoice(value);
    document.cookie = `theme=${value}; path=/; max-age=31536000; samesite=lax`;
    applyTheme(value);
  };
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <p className="px-2.5 text-caption font-semibold text-text-secondary">Тема</p>
      <div role="radiogroup" aria-label="Тема оформления" className="sv-segment sv-segment--block sv-segment--tiles mx-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={choice === o.value}
            onClick={() => pick(o.value)}
            className={cn("sv-segment__item", choice === o.value && "is-active")}
          >
            <o.icon className="h-4.5 w-4.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            <span>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Быстрый переключатель темы в профиле бокового меню (дизайн-система: луна и солнце рядом с именем) */
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.getAttribute("data-theme") === "dark"), []);
  const toggle = () => {
    const next: ThemeChoice = dark ? "light" : "dark";
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    applyTheme(next);
    setDark(!dark);
  };
  const label = dark ? "Светлая тема" : "Тёмная тема";
  const Icon = dark ? Sun : Moon;
  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className={cn("sv-icon-btn sv-icon-btn--sm sv-icon-btn--inverse shrink-0", className)}>
      <Icon className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}
