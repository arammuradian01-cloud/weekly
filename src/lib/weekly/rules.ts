// Правила weekly из разделов 2 и 3 ТЗ. Чистые функции: ими пользуются сервер и экраны.

import type { PersonSlug, WeekInfo, WeekKey, WeeklyEntry } from "@/prototype/types";
import type { Viewer } from "@/lib/tasks/rules";

export const WEEKLY_LIMITS = { headline: 150, what: 150, details: 1000, impact: 500, fact: 300, next: 500, help: 300, linkTitle: 120, url: 500 };

/**
 * Кто правит weekly недели: свой weekly пишет каждый, кроме наблюдателя, пока неделя открыта
 * и не позже отчётной. Чужой weekly и закрытую неделю правят только владелец и администраторы
 */
export function canEditWeekly(week: Pick<WeekInfo, "key" | "closed">, reportingKey: WeekKey, viewer: Viewer, author: PersonSlug | null): boolean {
  if (viewer.observer) return false;
  if (viewer.management) return true;
  if (week.closed || week.key > reportingKey) return false;
  return author === viewer.slug;
}

/** Сдан вовремя или с опозданием: сравниваем момент сдачи со сроком недели */
export function submitState(now: Date, deadline: Date): "submitted" | "late" {
  return now.getTime() <= deadline.getTime() ? "submitted" : "late";
}

export type CeoSections = { main: string; risks: string; next: string };

/** Длинное тире и стрелки в отчёте CEO заменяются на дефис автоматически (раздел 3 ТЗ и правило текстов Арама) */
export function cleanDash(text: string): string {
  return text.replace(/[—–→⟶⇒]/g, "-");
}

/**
 * Черновик отчёта CEO из записей с флажком «В отчёт CEO»: результаты и события в «Главное»,
 * риски в «Риски», «Что дальше» и планы в «Что дальше». Подпись автора в скобках
 */
export function buildCeoSections(entries: WeeklyEntry[], nameOf: (slug: PersonSlug | null) => string): CeoSections {
  const flagged = entries.filter((e) => e.ceo);
  const line = (e: WeeklyEntry) => {
    const extra = e.fact ?? e.impact;
    return `- ${e.what.replace(/\.$/, "")}${extra ? `. ${extra.replace(/\.$/, "")}` : ""} (${nameOf(e.author)})`;
  };
  return {
    main: cleanDash(flagged.filter((e) => e.type === "result" || e.type === "event").map(line).join("\n")),
    risks: cleanDash(flagged.filter((e) => e.type === "risk").map(line).join("\n")),
    next: cleanDash(
      flagged
        .filter((e) => e.next || e.type === "plan")
        .map((e) => `- ${e.next ?? e.what} (${nameOf(e.author)})`)
        .join("\n"),
    ),
  };
}

/** Что произошло: первая фраза текста. Длинную режем по слову до 150 знаков, полный текст уходит в «Подробнее» */
export function splitWhat(text: string): { what: string; details?: string } {
  const value = text.trim();
  const first = /^(.+?[.!?])(\s|$)/s.exec(value)?.[1] ?? value;
  if (first.length <= WEEKLY_LIMITS.what) {
    const rest = value.slice(first.length).trim();
    return { what: first, details: rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : undefined };
  }
  const cut = first.slice(0, WEEKLY_LIMITS.what - 1);
  const atSpace = cut.lastIndexOf(" ");
  return { what: `${(atSpace > 80 ? cut.slice(0, atSpace) : cut).replace(/[,;:\s]+$/, "")}…`, details: value };
}
