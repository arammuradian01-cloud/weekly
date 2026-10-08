// Подготовка базы перед миграциями при старте контейнера.
// Урок выкладки 08.10.2026: App Platform убивает контейнер по таймауту проверки здоровья, а сессии базы от убитого
// контейнера живут ещё долго и держат блокировки. Следующий контейнер молча ждёт их на первой же миграции,
// снова не проходит проверку, и так по кругу; убитая на полпути миграция остаётся в _prisma_migrations
// незавершённой, после чего prisma migrate deploy отказывается работать (P3009) даже у старого образа.
// Поэтому перед миграциями: снимаем зависшие сессии своего пользователя базы и помечаем брошенные миграции
// откаченными (на PostgreSQL каждая миграция идёт одной транзакцией, брошенная ничего не оставила).
import { Client } from "pg";
import { databaseUrlFromEnv, pgConnectionConfig } from "./database-url";

export type PrepareReport = {
  /** Снятые сессии: pid и почему */
  terminated: { pid: number; reason: string }[];
  /** Миграции, помеченные откаченными */
  rolledBack: string[];
};

export type PrepareOptions = {
  /** Сколько секунд сессия может висеть в транзакции или ждать блокировку, прежде чем её снять */
  staleSeconds?: number;
  /** Пишет ход работы (по умолчанию console.log) */
  log?: (line: string) => void;
};

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Чистая часть: работает на любом соединении, чтобы её можно было проверить тестом */
export async function prepareDatabase(db: Queryable, options: PrepareOptions = {}): Promise<PrepareReport> {
  const stale = Math.max(0, options.staleSeconds ?? 60);
  const log = options.log ?? (() => {});
  const report: PrepareReport = { terminated: [], rolledBack: [] };

  // 1. Зависшие сессии своего пользователя дольше порога: открытая транзакция без дела, ожидание блокировки
  // или транзакция, в которой сервер ждёт ответа от уже убитого клиента. Чужих пользователей не трогаем,
  // работающие запросы тоже: их ждём
  const { rows: stuck } = await db.query(
    `SELECT pid, state, wait_event_type AS wait,
            extract(epoch FROM now() - coalesce(state_change, backend_start))::int AS idle_seconds
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = current_user
        AND pid <> pg_backend_pid()
        AND coalesce(state_change, backend_start) < now() - make_interval(secs => $1)
        AND (
          state = 'idle in transaction'
          OR wait_event_type = 'Lock'
          OR (state = 'active' AND wait_event_type = 'Client' AND xact_start IS NOT NULL)
        )
      ORDER BY pid`,
    [stale],
  );
  for (const row of stuck) {
    const pid = Number(row.pid);
    const reason =
      row.state === "idle in transaction"
        ? `открытая транзакция без дела ${row.idle_seconds} с`
        : row.wait === "Lock"
          ? `ожидание блокировки ${row.idle_seconds} с`
          : `транзакция без ответа клиента ${row.idle_seconds} с`;
    const { rows } = await db.query(`SELECT pg_terminate_backend($1) AS ok`, [pid]);
    if (rows[0]?.ok) {
      report.terminated.push({ pid, reason });
      log(`Снята зависшая сессия базы ${pid}: ${reason}`);
    }
  }

  // 2. Брошенные миграции: начаты, не завершены, не откачены, и это было давно (не параллельный живой контейнер)
  const { rows: tables } = await db.query(`SELECT to_regclass('public._prisma_migrations') AS t`);
  if (tables[0]?.t) {
    const { rows: abandoned } = await db.query(
      `UPDATE _prisma_migrations
          SET rolled_back_at = now()
        WHERE finished_at IS NULL
          AND rolled_back_at IS NULL
          AND started_at < now() - make_interval(secs => $1)
        RETURNING migration_name`,
      [stale],
    );
    for (const row of abandoned) {
      report.rolledBack.push(String(row.migration_name));
      log(`Брошенная миграция ${row.migration_name} помечена откаченной, будет применена заново`);
    }
  }

  return report;
}

/** Подключается по DATABASE_URL (или DB_*) и выполняет подготовку. Без адреса базы ничего не делает */
export async function prepareDatabaseFromEnv(options: PrepareOptions = {}): Promise<PrepareReport | null> {
  const url = databaseUrlFromEnv();
  if (!url) return null;
  const client = new Client(pgConnectionConfig(url));
  await client.connect();
  try {
    return await prepareDatabase(client, options);
  } finally {
    await client.end();
  }
}
