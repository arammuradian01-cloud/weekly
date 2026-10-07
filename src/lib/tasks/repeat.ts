// Повторяющиеся задачи (этап 25, модуль М10): правила без базы. Еженедельно или ежемесячно, следующая задача
// создаётся при закрытии этой или по расписанию в день её срока

import { addDays, diffDays, type IsoDate } from "@/domain/dates";

export type RepeatKindCode = "weekly" | "monthly";
export type RepeatModeCode = "on-close" | "schedule";

export const REPEAT_KINDS: { code: RepeatKindCode; label: string }[] = [
  { code: "weekly", label: "Еженедельно" },
  { code: "monthly", label: "Ежемесячно" },
];

export const REPEAT_MODES: { code: RepeatModeCode; label: string; hint: string }[] = [
  { code: "on-close", label: "При закрытии", hint: "Следующая появится, когда эту закроют" },
  { code: "schedule", label: "По расписанию", hint: "Следующая появится в день срока этой, даже если она ещё открыта" },
];

export function repeatLabel(kind: RepeatKindCode, mode: RepeatModeCode): string {
  return `${REPEAT_KINDS.find((k) => k.code === kind)?.label ?? kind}, ${(REPEAT_MODES.find((m) => m.code === mode)?.label ?? mode).toLowerCase()}`;
}

/** Та же дата через месяц; 31-е число в коротком месяце становится его последним днём */
export function addMonth(iso: IsoDate): IsoDate {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(d, lastDay));
  return next.toISOString().slice(0, 10) as IsoDate;
}

/**
 * Срок следующей задачи повтора: следующий период после текущего срока, но не раньше завтрашнего дня.
 * Задачу закрыли с опозданием на две недели: пропущенные недели не создаются, следующая ставится вперёд
 */
export function nextRepeatDue(kind: RepeatKindCode, due: IsoDate, today: IsoDate): IsoDate {
  let next = kind === "weekly" ? addDays(due, 7) : addMonth(due);
  let guard = 0;
  while (diffDays(next, today) >= 0 && guard++ < 400) next = kind === "weekly" ? addDays(next, 7) : addMonth(next);
  return next;
}
