"use client";

// Верхняя панель по дизайн-системе (navigation/TopBar.jsx): команда, неделя, поиск, «Новая задача».
// В шапке отчётная неделя: за неё сейчас пишут weekly. Экраны, где неделю можно листать, держат свой переключатель.
// Этап 59: неделя текстом без рамки (она не нажимается), «Новая задача» контурной кнопкой: главная зелёная кнопка
// на экране одна, у страницы

import { Plus, Search } from "lucide-react";
import { addDays, toCalendar, weekOf, weekTitle } from "@/domain/dates";
import { openCommandPalette } from "./command-palette";
import { openNewTask } from "@/components/prototype/new-task";
import { TeamSwitcher } from "./team-switcher";


function ddmm(iso: string) {
  const d = toCalendar(iso);
  return `${String(d.day).padStart(2, "0")}.${String(d.month).padStart(2, "0")}`;
}

/**
 * Отчётная неделя в шапке, текстом «Неделя 43, отчётная», как на экранах с переключателем недели. Даты недели в
 * подсказке. Листать недели можно на экранах, где это имеет смысл (Weekly, встреча, отчёт, прогноз)
 */
export function ReportingWeek({ reportingKey }: { reportingKey: string }) {
  const dates = `${ddmm(reportingKey)}-${ddmm(addDays(reportingKey, 6))}`;
  return (
    <span className="sv-topbar__week" title={`${dates}: за эту неделю сейчас пишут weekly`} data-testid="topbar-week">
      {weekTitle(weekOf(reportingKey).week, true)}
    </span>
  );
}

/** Кнопка поиска: открывает командную строку (этап 25), «/» и Cmd+K работают с любой страницы */
export function SearchButton({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <button type="button" onClick={() => openCommandPalette()} aria-label="Поиск и действия" aria-keyshortcuts="/ Control+K Meta+K" className="sv-icon-btn">
        <Search className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
      </button>
    );
  }
  return (
    <button type="button" className="sv-topbar__search" onClick={() => openCommandPalette()} aria-keyshortcuts="/ Control+K Meta+K">
      <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} aria-hidden="true" />
      <span>Поиск и действия</span>
      <kbd className="sv-kbd" aria-hidden="true">
        ⌘K
      </kbd>
    </button>
  );
}

export function TopBar({ reportingKey, managementUntil, canCreate }: { reportingKey: string; managementUntil: string | null; canCreate: boolean }) {
  return (
    <header className="sv-topbar">
      <TeamSwitcher />
      <ReportingWeek reportingKey={reportingKey} />
      <div className="sv-topbar__spacer" />
      {managementUntil ? <span className="sv-badge sv-badge--accent hidden xl:inline-flex">Режим управления до {managementUntil}</span> : null}
      <SearchButton />
      {canCreate ? (
        <button type="button" className="sv-btn sv-btn--outline sv-btn--sm sv-topbar__new" onClick={() => openNewTask()} aria-keyshortcuts="N" aria-label="Новая задача">
          <Plus className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
          <span>Новая задача</span>
        </button>
      ) : null}
    </header>
  );
}
