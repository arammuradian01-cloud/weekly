import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PRISMA_MIGRATE_LOCK, prepareDatabase, repeatableByFile } from "@/lib/migrate-prepare";

// Подготовка базы перед миграциями: снимает зависшие сессии своего пользователя и помечает брошенные повторяемые
// миграции откаченными. Порог 0 секунд, чтобы не ждать в тесте

const url = process.env.DATABASE_URL!;
let main: pg.Client;

beforeAll(async () => {
  main = new pg.Client({ connectionString: url });
  await main.connect();
});

afterAll(async () => {
  await main.end();
});

async function session() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  client.on("error", () => {});
  const { rows } = await client.query(`SELECT pg_backend_pid() AS pid`);
  return { client, pid: Number(rows[0].pid) };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dead = (client: pg.Client) => expect(client.query(`SELECT 1`)).rejects.toThrow();

describe("зависшие сессии", () => {
  it("снимает держателя с открытой транзакцией и того, кто ждёт его блокировку", async () => {
    const holder = await session();
    await holder.client.query(`BEGIN`);
    await holder.client.query(`LOCK TABLE settings IN ACCESS EXCLUSIVE MODE`);
    const waiter = await session();
    await waiter.client.query(`BEGIN`);
    const waiting = waiter.client.query(`LOCK TABLE settings IN ACCESS SHARE MODE`).catch(() => undefined);
    await pause(300);

    const report = await prepareDatabase(main, { staleSeconds: 0, repeatable: () => true });
    const pids = report.terminated.map((t) => t.pid);
    expect(pids).toEqual(expect.arrayContaining([holder.pid, waiter.pid]));
    expect(report.terminated.find((t) => t.pid === holder.pid)?.reason).toMatch(/без дела/);
    expect(report.terminated.find((t) => t.pid === waiter.pid)?.reason).toMatch(/за снятой сессией/);
    await waiting;
    await dead(holder.client);
    await dead(waiter.client);
    const { rows } = await main.query(`SELECT 1 AS one`);
    expect(rows[0].one).toBe(1);
  });

  it("не трогает того, кто ждёт живую сессию, и сессии без транзакции: LISTEN, простой, работающий запрос", async () => {
    // Живой держатель: работает (pg_sleep внутри транзакции), не зависший
    const busy = await session();
    await busy.client.query(`BEGIN`);
    await busy.client.query(`LOCK TABLE settings IN ACCESS EXCLUSIVE MODE`);
    const running = busy.client.query(`SELECT pg_sleep(1.5)`);
    const waiter = await session();
    await waiter.client.query(`BEGIN`);
    const waiting = waiter.client.query(`LOCK TABLE settings IN ACCESS SHARE MODE`);
    const listener = await session();
    await listener.client.query(`LISTEN weekly_live`);
    const idle = await session();
    await pause(300);

    const report = await prepareDatabase(main, { staleSeconds: 0, repeatable: () => true });
    const pids = report.terminated.map((t) => t.pid);
    for (const s of [busy, waiter, listener, idle]) expect(pids).not.toContain(s.pid);
    await running;
    await busy.client.query(`COMMIT`);
    await waiting;
    for (const s of [busy, waiter, listener, idle]) await s.client.end();
  });

  it("снимает простаивающую сессию с замком миграций Prisma", async () => {
    const ghost = await session();
    await ghost.client.query(`SELECT pg_advisory_lock($1)`, [PRISMA_MIGRATE_LOCK]);
    await pause(100);
    const report = await prepareDatabase(main, { staleSeconds: 0, repeatable: () => true });
    expect(report.terminated.find((t) => t.pid === ghost.pid)?.reason).toMatch(/замком миграций/);
    await dead(ghost.client);
  });
});

describe("брошенные миграции", () => {
  const insert = (id: string, name: string, age: string) =>
    main.query(
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, 'x', $2, now() - $3::interval, NULL, 0)`,
      [id, name, age],
    );
  const cleanup = () => main.query(`DELETE FROM _prisma_migrations WHERE id LIKE 'test-%'`);

  it("повторяемую помечает откаченной, свежую, завершённые и не повторяемую не трогает", async () => {
    await insert("test-abandoned", "99990101000000_abandoned", "10 minutes");
    await insert("test-fresh", "99990102000000_fresh", "0 seconds");
    await insert("test-plain", "99990103000000_plain", "10 minutes");
    try {
      const report = await prepareDatabase(main, { staleSeconds: 60, repeatable: (name) => name.endsWith("_abandoned") });
      expect(report.rolledBack).toEqual(["99990101000000_abandoned"]);
      expect(report.manual).toEqual(["99990103000000_plain"]);
      const { rows } = await main.query(
        `SELECT migration_name AS name, rolled_back_at IS NOT NULL AS rolled FROM _prisma_migrations WHERE id LIKE 'test-%' ORDER BY id`,
      );
      expect(rows).toEqual([
        { name: "99990101000000_abandoned", rolled: true },
        { name: "99990102000000_fresh", rolled: false },
        { name: "99990103000000_plain", rolled: false },
      ]);
      const { rows: done } = await main.query(
        `SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NOT NULL`,
      );
      expect(done[0].n).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("пока сосед держит замок миграций, брошенные не трогает", async () => {
    const neighbour = await session();
    await neighbour.client.query(`SELECT pg_advisory_lock($1)`, [PRISMA_MIGRATE_LOCK]);
    await insert("test-abandoned", "99990101000000_abandoned", "10 minutes");
    try {
      // Порог 60 с: живой сосед не считается зависшим
      const report = await prepareDatabase(main, { staleSeconds: 60, repeatable: () => true });
      expect(report.neighbourMigrating).toBe(true);
      expect(report.rolledBack).toEqual([]);
      const { rows } = await main.query(`SELECT rolled_back_at FROM _prisma_migrations WHERE id = 'test-abandoned'`);
      expect(rows[0].rolled_back_at).toBeNull();
    } finally {
      await cleanup();
      await neighbour.client.end();
    }
  });

  it("повторяемость читается по маркеру в первой строке файла миграции", () => {
    const repeatable = repeatableByFile();
    expect(repeatable("20261011150000_promises")).toBe(true);
    expect(repeatable("20261011140000_task_dependencies")).toBe(false);
    expect(repeatable("нет_такой")).toBe(false);
  });
});
