// Проверка здоровья и её след в базе (этап 86).
//
// /api/health и раньше отвечал, жива ли база, но ответ никуда не записывался: по нему нельзя было сказать, когда
// проверка проходила последний раз. Теперь удачная и неудачная проверки отмечаются в настройках, и страница
// «Состояние» показывает время последней удачной проверки. Это та же проверка, которую раз в несколько минут
// вызывает внешний пинг из GitHub (.github/workflows/ping.yml) и проверка состояния App Platform.
//
// Записи в базу редкие: удачная проверка отмечается не чаще раза в минуту (проверка ходит часто, а запись нужна
// только для времени), неудачная — каждый раз.

import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";

export const HEALTH_OK_KEY = "health.lastOkAt";
export const HEALTH_FAIL_KEY = "health.lastFailAt";
/** Удачную проверку отмечаем не чаще раза в минуту */
export const HEALTH_WRITE_MS = 60_000;

/** Когда в этом процессе последний раз отмечали удачную проверку */
let markedAt = 0;

export type HealthResult = { ok: boolean; db: boolean };

/** Жива ли база. Отмечает проверку в настройках; отметка не мешает ответу, если сама не удалась */
export async function checkHealth(now = new Date()): Promise<HealthResult> {
  let ok = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    ok = true;
  } catch {
    ok = false;
  }
  try {
    if (ok) {
      if (now.getTime() - markedAt >= HEALTH_WRITE_MS) {
        markedAt = now.getTime();
        await setSetting(HEALTH_OK_KEY, now.toISOString());
      }
    } else {
      // База не ответила: отметить неудачу обычно тоже не получится, поэтому ошибку глотаем
      await setSetting(HEALTH_FAIL_KEY, now.toISOString());
    }
  } catch {
    // Отметка не записалась: ответ проверки от этого не меняется
  }
  return { ok, db: ok };
}

export type HealthMarks = { lastOkAt: string | null; lastFailAt: string | null };

/** Время последней удачной и последней неудачной проверки для страницы «Состояние» */
export async function healthMarks(): Promise<HealthMarks> {
  const [lastOkAt, lastFailAt] = await Promise.all([getSetting<string | null>(HEALTH_OK_KEY, null), getSetting<string | null>(HEALTH_FAIL_KEY, null)]);
  return {
    lastOkAt: typeof lastOkAt === "string" ? lastOkAt : null,
    lastFailAt: typeof lastFailAt === "string" ? lastFailAt : null,
  };
}
