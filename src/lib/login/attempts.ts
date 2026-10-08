// Попытки входа под замком (этап 29).
//
// Попытка записывается до сверки пароля, под замком в базе: параллельные запросы видят друг друга и не обходят порог.
// Раньше пачка из двадцати одновременных неверных попыток к одному логину выбирала все соединения базы: каждый запрос
// открывал транзакцию и в ней ждал замка, а остальным не доставалось соединения, и они падали с общей ошибкой вместо
// понятной блокировки. Теперь запросы с одним ключом сначала встают в очередь внутри процесса и только потом
// открывают транзакцию. Замок в базе остаётся: он нужен, если ресурс когда-нибудь запустят в нескольких процессах.

import { prisma } from "@/lib/db";
import { computeLockState, historySince } from "@/lib/rate-limit";
import type { Prisma } from "@/generated/prisma/client";

export type Tx = Prisma.TransactionClient;

/** Запас на ожидание соединения и на саму транзакцию: при нагрузке лучше подождать, чем упасть с общей ошибкой */
export const ATTEMPT_TX = { maxWait: 10_000, timeout: 10_000 } as const;

/** Ответ, если база не ответила вовремя. Одинаковый для любого логина: по нему не узнать, кто есть в ресурсе */
export const BUSY_ERROR = "Вход сейчас перегружен. Попробуйте ещё раз через минуту";

const queues = new Map<string, Promise<unknown>>();

/** Очередь внутри процесса по ключу: следующий запрос с тем же ключом начинается, когда закончился предыдущий */
export async function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  try {
    return await run;
  } finally {
    if (queues.get(key) === tail) queues.delete(key);
  }
}

/** Очередь по нескольким ключам. Ключи берутся всегда в одном порядке, поэтому два запроса не ждут друг друга по кругу */
export function serialAll<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(keys)].sort();
  return sorted.reduceRight<() => Promise<T>>((inner, key) => () => serial(key, inner), fn)();
}

/** Сколько ключей сейчас в очереди: для проверки, что очередь не копится */
export function queuedKeys(): number {
  return queues.size;
}

/** Замок на время транзакции: параллельные попытки по одному ключу идут по очереди и между процессами */
export async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
}

export type IpReserved = { ok: true; attemptId: bigint; remaining: number } | { ok: false; until: Date };

/**
 * Попытка общего входа или входа в режим управления: счёт по адресу, 5 неверных попыток закрывают вход на 15 минут.
 * Попытка пишется неверной до сверки пароля, после верного пароля отмечается успешной (markAttemptOk)
 */
export function reserveIpAttempt(ip: string, kind: "TEAM" | "MANAGEMENT", now: Date): Promise<IpReserved> {
  const key = `attempt:${kind}:${ip}`;
  return serial(key, () =>
    prisma.$transaction(async (tx): Promise<IpReserved> => {
      await advisoryLock(tx, key);
      const attempts = await tx.loginAttempt.findMany({
        where: { ip, kind, at: { gte: historySince(now) } },
        select: { at: true, ok: true, blocked: true },
        orderBy: { at: "asc" },
      });
      const state = computeLockState(
        attempts.filter((a) => !a.blocked),
        now,
      );
      if (state.locked && state.lockedUntil) {
        await tx.loginAttempt.create({ data: { ip, kind, ok: false, blocked: true, at: now } });
        return { ok: false, until: state.lockedUntil };
      }
      const row = await tx.loginAttempt.create({ data: { ip, kind, ok: false, at: now }, select: { id: true } });
      return { ok: true, attemptId: row.id, remaining: state.remaining };
    }, ATTEMPT_TX),
  );
}

export function markAttemptOk(db: Tx | typeof prisma, attemptId: bigint) {
  return db.loginAttempt.update({ where: { id: attemptId }, data: { ok: true } });
}
