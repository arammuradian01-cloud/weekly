// Подготовка базы перед миграциями при старте контейнера.
// Урок выкладки 08.10.2026: App Platform убивает контейнер по таймауту проверки здоровья, а сессии базы от убитого
// контейнера живут ещё долго и держат блокировки. Следующий контейнер молча ждёт их на первой же миграции,
// снова не проходит проверку, и так по кругу; убитая на полпути миграция остаётся в _prisma_migrations
// незавершённой, после чего prisma migrate deploy отказывается работать (P3009) даже у старого образа.
// Поэтому перед миграциями: снимаем зависшие сессии своего пользователя базы и помечаем брошенные миграции
// откаченными. Важно: Prisma применяет операторы миграции без общей транзакции, брошенная миграция могла оставить
// часть объектов. Поэтому откаченной помечается только миграция, написанная повторяемой (маркер в первой строке
// файла, см. REPEATABLE_MARK), остальные оставляем человеку: prisma migrate resolve
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { databaseUrlFromEnv, pgConnectionConfig } from "./database-url";

/** Маркер повторяемой миграции: первая строка файла migration.sql начинается с него */
export const REPEATABLE_MARK = "-- повторяемая";

/** Session-level advisory lock, который prisma migrate deploy держит на время применения миграций */
export const PRISMA_MIGRATE_LOCK = 72707369;

export type PrepareReport = {
  /** Снятые сессии: pid и почему */
  terminated: { pid: number; reason: string }[];
  /** Миграции, помеченные откаченными */
  rolledBack: string[];
  /** Брошенные миграции, которые нельзя пометить автоматически: нужен prisma migrate resolve */
  manual: string[];
  /** Шаг с миграциями пропущен: соседний контейнер прямо сейчас применяет миграции */
  neighbourMigrating: boolean;
};

export type PrepareOptions = {
  /** Сколько секунд сессия может висеть в транзакции или ждать блокировку, прежде чем её снять */
  staleSeconds?: number;
  /** Написана ли миграция повторяемой (по умолчанию читает маркер из prisma/migrations) */
  repeatable?: (migrationName: string) => boolean;
  /** Пишет ход работы */
  log?: (line: string) => void;
};

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Повторяемость по маркеру в файле миграции образа */
export function repeatableByFile(migrationsDir = join(process.cwd(), "prisma", "migrations")) {
  return (name: string) => {
    try {
      const head = readFileSync(join(migrationsDir, name, "migration.sql"), "utf8").slice(0, 200);
      return head.trimStart().startsWith(REPEATABLE_MARK);
    } catch {
      return false;
    }
  };
}

/** Чистая часть: работает на любом соединении, чтобы её можно было проверить тестом */
export async function prepareDatabase(db: Queryable, options: PrepareOptions = {}): Promise<PrepareReport> {
  const stale = Math.max(0, options.staleSeconds ?? 60);
  const repeatable = options.repeatable ?? repeatableByFile();
  const log = options.log ?? (() => {});
  const report: PrepareReport = { terminated: [], rolledBack: [], manual: [], neighbourMigrating: false };

  // 1. Зависшие сессии своего пользователя дольше порога. Чужих пользователей не трогаем, работающие запросы тоже.
  // Держатели: открытая транзакция без дела, транзакция, в которой сервер ждёт ответа уже убитого клиента,
  // и простаивающая сессия с замком миграций Prisma (deploy убит, а FIN до базы не дошёл).
  // Ожидающие блокировку снимаются только вместе с держателем: живой сосед, который ждёт живую сессию, остаётся
  const { rows: stuck } = await db.query(
    `SELECT a.pid, a.state, a.wait_event_type AS wait,
            extract(epoch FROM now() - coalesce(a.state_change, a.backend_start))::int AS idle_seconds,
            pg_blocking_pids(a.pid) AS blocked_by,
            EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND l.locktype = 'advisory' AND l.classid = 0
                      AND l.objid = $2 AND l.granted) AS migrate_lock
       FROM pg_stat_activity a
      WHERE a.datname = current_database()
        AND a.usename = current_user
        AND a.pid <> pg_backend_pid()
        AND coalesce(a.state_change, a.backend_start) < now() - make_interval(secs => $1)
        AND (
          a.state = 'idle in transaction'
          OR a.wait_event_type = 'Lock'
          OR (a.state = 'active' AND a.wait_event_type = 'Client' AND a.xact_start IS NOT NULL)
          OR (a.state = 'idle' AND EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND l.locktype = 'advisory'
                                             AND l.classid = 0 AND l.objid = $2 AND l.granted))
        )
      ORDER BY a.pid`,
    [stale, PRISMA_MIGRATE_LOCK],
  );
  const holders = stuck.filter((r) => r.wait !== "Lock");
  const waiters = stuck.filter((r) => r.wait === "Lock");
  const killed = new Set<number>();
  const terminate = async (row: Record<string, unknown>, reason: string) => {
    const pid = Number(row.pid);
    const { rows } = await db.query(`SELECT pg_terminate_backend($1, 5000) AS ok`, [pid]);
    if (rows[0]?.ok) {
      killed.add(pid);
      report.terminated.push({ pid, reason });
      log(`Снята зависшая сессия базы ${pid}: ${reason}`);
    }
  };
  for (const row of holders) {
    const reason =
      row.state === "idle in transaction"
        ? `открытая транзакция без дела ${row.idle_seconds} с`
        : row.state === "idle"
          ? `простой с замком миграций ${row.idle_seconds} с`
          : `транзакция без ответа клиента ${row.idle_seconds} с`;
    await terminate(row, reason);
  }
  for (const row of waiters) {
    const blockers = (row.blocked_by as number[] | null) ?? [];
    if (blockers.length === 0 || !blockers.every((pid) => killed.has(Number(pid)))) continue;
    await terminate(row, `ожидание блокировки ${row.idle_seconds} с за снятой сессией`);
  }

  // 2. Брошенные миграции: начаты, не завершены, не откачены, и давно. Пока какая-то своя сессия держит замок
  // миграций Prisma, сосед работает, и этот шаг пропускается. Помечаем только повторяемые миграции
  const { rows: tables } = await db.query(`SELECT to_regclass('public._prisma_migrations') AS t`);
  if (!tables[0]?.t) return report;
  const { rows: locks } = await db.query(
    `SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory' AND l.classid = 0 AND l.objid = $1 AND l.granted
        AND a.datname = current_database() AND a.pid <> pg_backend_pid()`,
    [PRISMA_MIGRATE_LOCK],
  );
  if (locks.length > 0) {
    report.neighbourMigrating = true;
    log("Соседний контейнер применяет миграции, брошенные миграции не трогаем");
    return report;
  }
  const { rows: abandoned } = await db.query(
    `SELECT migration_name AS name FROM _prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL AND started_at < now() - make_interval(secs => $1)
      ORDER BY started_at`,
    [stale],
  );
  for (const row of abandoned) {
    const name = String(row.name);
    if (!repeatable(name)) {
      report.manual.push(name);
      log(`Брошенная миграция ${name} не повторяемая: нужно разобраться руками (prisma migrate resolve)`);
      continue;
    }
    await db.query(
      `UPDATE _prisma_migrations SET rolled_back_at = now()
        WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL`,
      [name],
    );
    report.rolledBack.push(name);
    log(`Брошенная миграция ${name} помечена откаченной, будет применена заново`);
  }
  return report;
}

/** Подключается по DATABASE_URL (или DB_*) и выполняет подготовку. Без адреса базы ничего не делает */
export async function prepareDatabaseFromEnv(options: PrepareOptions = {}): Promise<PrepareReport | null> {
  const url = databaseUrlFromEnv();
  if (!url) return null;
  const client = new Client({ ...pgConnectionConfig(url), connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query(`SET statement_timeout = '15s'`);
    return await prepareDatabase(client, options);
  } finally {
    await client.end();
  }
}
