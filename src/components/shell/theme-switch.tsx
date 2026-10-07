"use client";

// Тема оформления (этап 18): светлая, тёмная или как в системе. Выбор хранится в cookie на этом устройстве
// и применяется сразу, без перезагрузки; при «как в системе» следим за настройкой устройства

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
      <p className="px-3 text-caption text-muted">Тема</p>
      <div role="radiogroup" aria-label="Тема оформления" className="mx-3 grid grid-cols-3 gap-1 rounded-control bg-field p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={choice === o.value}
            onClick={() => pick(o.value)}
            className={cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-md text-caption font-semibold transition-colors", choice === o.value ? "bg-surface text-ink shadow-segment" : "text-muted hover:text-ink")}
          >
            <o.icon className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{o.label}</span>
            <span className="sr-only sm:hidden">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
