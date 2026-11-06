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
export async function serial<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { maxPending?: number; timeoutMs?: number; /** Общий флаг для вложенных очередей: истекло время любой из них */ guard?: { cancelled: boolean } } = {},
): Promise<T> {
  const maxPending = opts.maxPending ?? MAX_PENDING;
  const count = pending.get(key) ?? 0;
  if (count >= maxPending) throw new QueueBusy();
  pending.set(key, count + 1);
  let started = false;
  let cancelled = false;
  const start = () => {
    if (cancelled || opts.guard?.cancelled) throw new QueueBusy();
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
      // Внешняя очередь уже «началась», когда встала во внутреннюю: флаг не даёт внутренней работе начаться позже
      if (opts.guard) opts.guard.cancelled = true;
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
export function serialAll<T>(keys: string[], fn: () => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const sorted = [...new Set(keys)].sort();
  // Один срок и один флаг на все уровни: человек получил «перегружен», значит работа не начнётся ни на каком уровне
  const guard = { cancelled: false };
  const deadline = Date.now() + (opts.timeoutMs ?? QUEUE_TIMEOUT_MS);
  return sorted.reduceRight<() => Promise<T>>((inner, key) => () => serial(key, inner, { guard, timeoutMs: Math.max(1, deadline - Date.now()) }), fn)();
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

/** Ключ счётчика попыток режима управления по человеку: у каждого владельца и администратора свой */
export const managementKey = (personId: string) => `management:${personId}`;

export type ManagementReserved =
  | { ok: true; attemptId: bigint; remaining: number }
  | { ok: false; scope: "ip" | "person"; until: Date };

/**
 * Попытка включить режим управления общим паролем роли: счёт и по адресу, и по человеку (этап 86).
 *
 * Этап 29 считал попытки только по адресу, поэтому подбор общего пароля владельца с разных адресов (а их у домашнего
 * интернета и мобильной сети много) порога не достигал: на каждом адресе была одна-две попытки. Теперь у каждого
 * владельца и администратора свой счётчик: 5 неверных попыток закрывают ему режим управления на 15 минут, с какого
 * бы адреса они ни пришли. Счёт по адресу остался прежним, он никого не ослабляет.
 *
 * Личный пароль режима управления (решение о личных паролях владельцев) идёт мимо: его сверяет checkCurrentPassword
 * вместе с личным входом, там счётчик по человеку есть с этапа 20а.
 */
export function reserveManagementAttempt(ip: string, personId: string, now: Date): Promise<ManagementReserved> {
  const ipKey = `attempt:MANAGEMENT:${ip}`;
  const personKey = `attempt:${managementKey(personId)}`;
  // Сначала очередь в процессе, потом транзакция: ждущие запросы не держат соединения базы (этап 29)
  return serialAll([ipKey, personKey], () =>
    prisma.$transaction(async (tx): Promise<ManagementReserved> => {
      await lockTimeout(tx);
      await advisoryLock(tx, ipKey);
      await advisoryLock(tx, personKey);
      const history = { kind: "MANAGEMENT" as const, at: { gte: historySince(now) } };
      const select = { at: true, ok: true, blocked: true };
      // Запросы по очереди, а не Promise.all: внутри одной транзакции они всё равно идут по одному соединению
      const byIpRows = await tx.loginAttempt.findMany({ where: { ...history, ip }, select, orderBy: { at: "asc" } });
      const byPersonRows = await tx.loginAttempt.findMany({ where: { ...history, personId }, select, orderBy: { at: "asc" } });
      const blocked = (scope: "ip" | "person", until: Date) =>
        tx.loginAttempt
          .create({ data: { ip, kind: "MANAGEMENT", ok: false, blocked: true, personId, login: managementKey(personId), at: now } })
          .then(() => ({ ok: false, scope, until }) as ManagementReserved);
      const byIp = computeLockState(
        byIpRows.filter((a) => !a.blocked),
        now,
      );
      if (byIp.locked && byIp.lockedUntil) return blocked("ip", byIp.lockedUntil);
      const byPerson = computeLockState(
        byPersonRows.filter((a) => !a.blocked),
        now,
      );
      if (byPerson.locked && byPerson.lockedUntil) return blocked("person", byPerson.lockedUntil);
      const row = await tx.loginAttempt.create({
        data: { ip, kind: "MANAGEMENT", ok: false, personId, login: managementKey(personId), at: now },
        select: { id: true },
      });
      return { ok: true, attemptId: row.id, remaining: Math.min(byIp.remaining, byPerson.remaining) };
    }, ATTEMPT_TX),
  );
}
