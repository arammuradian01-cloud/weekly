// Задачи с сервера и свои правки последних секунд (этап 22): ответ сервера, запрошенный до правки, может прийти позже
// неё и откатить на экране только что сохранённое. Чистая функция: её проверяют модульные тесты.

import type { Task } from "./types";

/** Сколько своя правка главнее ответа сервера, если версии не сравнить */
const RECENT_MS = 15_000;

/**
 * Задачи с сервера и свои правки последних секунд. Своя версия остаётся, если она не старше серверной; удалённая
 * задача не возвращается, созданная не пропадает. Старые записи о правках забываются
 */
export function mergeRecent(server: Task[], recent: Map<number, { at: number; task: Task | null }>, now: number): Task[] {
  for (const [n, r] of recent) if (now - r.at > RECENT_MS) recent.delete(n);
  if (!recent.size) return server;
  const seen = new Set<number>();
  const merged: Task[] = [];
  for (const s of server) {
    seen.add(s.number);
    const r = recent.get(s.number);
    if (!r) merged.push(s);
    else if (r.task === null) continue;
    else merged.push(r.task.rev && s.rev && r.task.rev < s.rev ? s : r.task);
  }
  for (const [n, r] of recent) if (r.task && !seen.has(n)) merged.push(r.task);
  return merged;
}

