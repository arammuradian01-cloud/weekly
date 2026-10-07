"use client";

import { Search } from "lucide-react";
import { openCommandPalette } from "@/components/shell/command-palette";

/**
 * Поиск из шапки (этап 25): открывает командную строку с поиском по всему и действиями.
 * «/» и Cmd+K открывают её с любой страницы. На телефоне это кнопка-иконка
 */
export function HeaderSearch({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <button type="button" onClick={() => openCommandPalette()} aria-label="Поиск и действия" aria-keyshortcuts="/ Control+K Meta+K" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink hover:bg-surface">
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openCommandPalette()}
      aria-keyshortcuts="/ Control+K Meta+K"
      className="relative hidden h-10 w-full max-w-[320px] items-center rounded-lg border border-line bg-surface pl-9 pr-12 text-left text-body text-muted hover:border-steel hover:bg-white focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25 md:flex"
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      Поиск и действия
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-white px-1.5 text-tiny text-muted" aria-hidden="true">
        ⌘K
      </kbd>
    </button>
  );
}
