// Блокировка подбора пароля: 5 неверных попыток с одного адреса закрывают вход на 15 минут (раздел 6 ТЗ).

export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_MS = 15 * 60 * 1000;

export type Attempt = { at: Date; ok: boolean };

export type LockState = {
  locked: boolean;
  /** Когда снова можно пробовать, если вход закрыт */
  lockedUntil: Date | null;
  /** Сколько неверных попыток осталось до блокировки */
  remaining: number;
};

/**
 * Считает состояние по истории попыток одного адреса.
 * Попытки во время блокировки не продлевают её. Успешный вход обнуляет счёт.
 */
export function computeLockState(attempts: Attempt[], now: Date): LockState {
  const sorted = [...attempts].sort((a, b) => a.at.getTime() - b.at.getTime());
  let failures: number[] = [];
  let lockUntil = 0;

  for (const attempt of sorted) {
    const t = attempt.at.getTime();
    if (t < lockUntil) continue;
    if (attempt.ok) {
      failures = [];
      continue;
    }
    failures = failures.filter((f) => f > t - FAILURE_WINDOW_MS);
    failures.push(t);
    if (failures.length >= MAX_FAILURES) {
      lockUntil = t + LOCK_MS;
      failures = [];
    }
  }

  const nowMs = now.getTime();
  if (nowMs < lockUntil) {
    return { locked: true, lockedUntil: new Date(lockUntil), remaining: 0 };
  }
  const recent = failures.filter((f) => f > nowMs - FAILURE_WINDOW_MS).length;
  return { locked: false, lockedUntil: null, remaining: MAX_FAILURES - recent };
}

/** С какого момента нужна история, чтобы посчитать состояние */
export function historySince(now: Date): Date {
  return new Date(now.getTime() - FAILURE_WINDOW_MS - LOCK_MS);
}
