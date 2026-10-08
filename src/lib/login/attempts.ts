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

/** Ждущих запросов с одним ключом не больше этого: дальше сразу «перегружен», память не растёт */
export const MAX_PENDING = 50;
/**
 * Сколько запрос ждёт своей очереди и ответа базы, прежде чем ответить «перегружен». С запасом: в пачке запросов
 * сверка паролей занимает процессор, и очередь движется медленнее. Зависший замок в базе ловит lock_timeout раньше
 */
export const QUEUE_TIMEOUT_MS = 30_000;

/** Очередь переполнена или запрос ждал слишком долго */
export class QueueBusy extends Error {
  constructor() {
    super(BUSY_ERROR);
  }
}

const queues = new Map<string, Promise<unknown>>();
const pending = new Map<string, number>();

/**
 * Очередь внутри процесса по ключу: следующий запрос с тем же ключом начинается, когда закончился предыдущий.
 * Запрос, который не дождался очереди за timeoutMs, не выполняется вовсе: человек уже получил «перегружен»
 */
export async function serial<T>(key: string, fn: () => Promise<T>, opts: { maxPending?: number; timeoutMs?: number } = {}): Promise<T> {
  const maxPending = opts.maxPending ?? MAX_PENDING;
  const count = pending.get(key) ?? 0;
  if (count >= maxPending) throw new QueueBusy();
  pending.set(key, count + 1);
  let started = false;
  let cancelled = false;
  const start = () => {
    if (cancelled) throw new QueueBusy();
    started = true;
    return fn();
  };
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(start, start);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    const left = (pending.get(key) ?? 1) - 1;
    if (left > 0) pending.set(key, left);
    else pending.delete(key);
    if (queues.get(key) === tail) queues.delete(key);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!started) cancelled = true;
      reject(new QueueBusy());
    }, opts.timeoutMs ?? QUEUE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Очередь по нескольким ключам. Ключи берутся всегда в одном порядке, поэтому два запроса не ждут друг друга по кругу */
export function serialAll<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(keys)].sort();
  return sorted.reduceRight<() => Promise<T>>((inner, key) => () => serial(key, inner), fn)();
}

/** Сколько ключей сейчас в очереди: для проверки, что очередь не копится */
export function queuedKeys(): number {
  return queues.size + pending.size;
}

/** Ожидание замка в базе не дольше 5 секунд: зависший замок не держит вход бесконечно */
export async function lockTimeout(tx: Tx): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
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
      await lockTimeout(tx);
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
