// Этап 73б: у одной задачи один автоматический пункт повестки. Чистые правила без базы: их проверяют unit-тесты, а
// пересборка повестки применяет их к тому, что уже стоит во встрече.

import type { AgendaKind } from "@/generated/prisma/enums";

/** Автоматические пункты о задаче по силе: поручение, блокер или риск, критичная или просроченная, предложение без ответа */
export const TASK_ITEM_RANK: Partial<Record<AgendaKind, number>> = { FOLLOW_UP: 0, TASK_STATE: 1, TASK_ATTENTION: 2, PROPOSAL: 3 };

/**
 * Пункт-кандидат о задаче. note: заметка самого пункта (причина блокера или риска). mark: короткая пометка, которую
 * пункт оставляет в заметке другого пункта той же задачи, если сам не попадает в повестку
 */
export type TaskDraft = { kind: AgendaKind; autoKey: string; taskId?: string; note?: string | null; mark?: string };

const isTaskItem = (d: TaskDraft) => Boolean(d.taskId) && TASK_ITEM_RANK[d.kind] !== undefined;
const rank = (d: TaskDraft) => TASK_ITEM_RANK[d.kind] ?? 99;
const sentence = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** Заметка оставшегося пункта: его причина и пометки отброшенных, каждая отдельным предложением */
export function mergedNote(own: string | null | undefined, marks: string[]): string | null {
  const parts = [own, ...marks].map((p) => (p ?? "").trim()).filter(Boolean);
  if (!parts.length) return null;
  if (!marks.length) return own ?? null;
  return parts.map(sentence).join(" ");
}

/**
 * Одна задача, один автоматический пункт. Остаётся пункт, который уже стоит в повестке (пересборка во время встречи не
 * подменяет обсуждаемый пункт), иначе самый сильный из не убранных ведущим: убранное поручение не гасит блокер или риск
 * той же задачи. Причины и пометки отброшенных пунктов переходят в заметку оставшегося. Убранные ведущим пункты проходят
 * как есть: пересборка их пропускает и не удаляет. Вопросы обсуждения и пункты без задачи не трогаются.
 * existing: пункты встречи по автоматическому ключу, removed у убранных ведущим
 */
export function oneItemPerTask<T extends TaskDraft>(drafts: T[], existing: ReadonlyMap<string, { removed: boolean }>): T[] {
  const groups = new Map<string, T[]>();
  for (const d of drafts) {
    if (!isTaskItem(d)) continue;
    const group = groups.get(d.taskId!) ?? [];
    group.push(d);
    groups.set(d.taskId!, group);
  }
  const keep = new Map<T, T>();
  for (const group of groups.values()) {
    const ranked = [...group].sort((x, y) => rank(x) - rank(y));
    const removed = (d: T) => existing.get(d.autoKey)?.removed === true;
    for (const d of ranked) if (removed(d)) keep.set(d, d);
    const open = ranked.filter((d) => !removed(d));
    const survivor = open.find((d) => existing.has(d.autoKey)) ?? open[0];
    if (!survivor) continue;
    const marks = open.filter((d) => d !== survivor).flatMap((d) => (d.mark ? [d.mark] : []));
    keep.set(survivor, marks.length ? { ...survivor, note: mergedNote(survivor.note, marks) } : survivor);
  }
  return drafts.flatMap((d) => (!isTaskItem(d) ? [d] : keep.has(d) ? [keep.get(d)!] : []));
}
