import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { prepareDatabase } from "@/lib/migrate-prepare";

// Подготовка базы перед миграциями: снимает зависшие сессии своего пользователя и помечает брошенные миграции
// откаченными. Порог 0 секунд, чтобы не ждать в тесте

const url = process.env.DATABASE_URL!;
let main: pg.Client;

beforeAll(async () => {
  main = new pg.Client({ connectionString: url });
  await main.connect();
});

afterAll(async () => {
  await main.end();
});

async function pidOf(client: pg.Client) {
  const { rows } = await client.query(`SELECT pg_backend_pid() AS pid`);
  return Number(rows[0].pid);
}

describe("подготовка базы перед миграциями", () => {
  it("снимает сессию с открытой транзакцией без дела и ту, что ждёт блокировку", async () => {
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    holder.on("error", () => {});
    const holderPid = await pidOf(holder);
    await holder.query(`BEGIN`);
    await holder.query(`LOCK TABLE settings IN ACCESS EXCLUSIVE MODE`);
    // Сессия-ожидающий: встаёт в очередь за блокировкой и не возвращается, пока держатель жив
    const waiter = new pg.Client({ connectionString: url });
    await waiter.connect();
    waiter.on("error", () => {});
    const waiterPid = await pidOf(waiter);
    await waiter.query(`BEGIN`);
    const waiting = waiter.query(`LOCK TABLE settings IN ACCESS SHARE MODE`).catch((e: Error) => e);
    await new Promise((r) => setTimeout(r, 300));

    const report = await prepareDatabase(main, { staleSeconds: 0 });
    const pids = report.terminated.map((t) => t.pid).sort();
    expect(pids).toEqual([holderPid, waiterPid].sort());
    expect(report.terminated.find((t) => t.pid === holderPid)?.reason).toMatch(/без дела/);
    expect(report.terminated.find((t) => t.pid === waiterPid)?.reason).toMatch(/блокировки/);

    // Обе сессии сняты: ожидавшая могла успеть получить блокировку после смерти держателя, но живой не осталась
    await waiting;
    await expect(holder.query(`SELECT 1`)).rejects.toThrow();
    await expect(waiter.query(`SELECT 1`)).rejects.toThrow();
    await holder.end().catch(() => {});
    await waiter.end().catch(() => {});

    // Живые сессии без транзакции не трогает: наша основная жива
    const { rows } = await main.query(`SELECT 1 AS one`);
    expect(rows[0].one).toBe(1);
  });

  it("не трогает сессию, которая просто работает", async () => {
    const busy = new pg.Client({ connectionString: url });
    await busy.connect();
    busy.on("error", () => {});
    const busyPid = await pidOf(busy);
    const running = busy.query(`SELECT pg_sleep(1.5)`);
    await new Promise((r) => setTimeout(r, 200));
    const report = await prepareDatabase(main, { staleSeconds: 0 });
    expect(report.terminated.map((t) => t.pid)).not.toContain(busyPid);
    await running;
    await busy.end();
  });

  it("помечает брошенную миграцию откаченной, а свежую и завершённые не трогает", async () => {
    await main.query(
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ('test-abandoned', 'x', '99990101000000_abandoned', now() - interval '10 minutes', NULL, 0),
              ('test-fresh', 'x', '99990102000000_fresh', now(), NULL, 0)`,
    );
    try {
      const report = await prepareDatabase(main, { staleSeconds: 60 });
      expect(report.rolledBack).toEqual(["99990101000000_abandoned"]);
      const { rows } = await main.query(
        `SELECT migration_name AS name, rolled_back_at IS NOT NULL AS rolled
           FROM _prisma_migrations WHERE id IN ('test-abandoned', 'test-fresh') ORDER BY id`,
      );
      expect(rows).toEqual([
        { name: "99990101000000_abandoned", rolled: true },
        { name: "99990102000000_fresh", rolled: false },
      ]);
      const { rows: done } = await main.query(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NOT NULL`);
      expect(done[0].n).toBe(0);
    } finally {
      await main.query(`DELETE FROM _prisma_migrations WHERE id IN ('test-abandoned', 'test-fresh')`);
    }
  });
});
