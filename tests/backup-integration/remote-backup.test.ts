import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { PgBoss } from "pg-boss";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRemoteBackup, verifyRemoteBackup, extractRemoteBackup, confirmedKeys } from "../../scripts/lib/remote-backup/core";
import { clientFor, identifier } from "../../scripts/lib/remote-backup/postgres";
import { migrationBackupNeeded } from "../../scripts/lib/remote-backup/migrations";
import type { BackupConfig } from "../../scripts/lib/remote-backup/config";
import type { BackupStore } from "../../scripts/lib/remote-backup/storage";
import { prepareDatabase } from "../../src/lib/migrate-prepare";
import { decryptArchive, encryptArchive } from "../../scripts/lib/remote-backup/archive";

// Эти адреса задаются только явно. Нет fallback на DATABASE_URL и нет доступа к рабочим копиям.
const sourceAdmin = process.env.BACKUP_TEST_SOURCE_URL;
const targetAdmin = process.env.BACKUP_TEST_TARGET_URL;
if (!sourceAdmin || !targetAdmin) throw new Error("Нужны два отдельных тестовых сервера: BACKUP_TEST_SOURCE_URL и BACKUP_TEST_TARGET_URL");
for (const url of [sourceAdmin, targetAdmin]) {
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Тесты резервирования разрешены только на локальных серверах");
}
const database = `weekly_backup_test_${randomUUID().replaceAll("-", "")}`;
const source = new URL(sourceAdmin);
source.pathname = `/${database}`;
const admin = clientFor(sourceAdmin);
const target = clientFor(targetAdmin, true);
const client = clientFor(source.toString());
let created = false;
let scratch: string;
const config: BackupConfig = { databaseUrl: source.toString(), endpoint: "https://s3.example.test", region: "test", bucket: "weekly-test", prefix: "weekly-test",
  accessKeyId: "test", secretAccessKey: "test", encryptionKey: randomBytes(32), keepDaily: 2, keepMonthly: 2, keepMigration: 2 };
class MemoryStore implements BackupStore {
  objects = new Map<string, Buffer>();
  corrupt = false;
  fail = false;
  removed: string[] = [];
  async put(key: string, path: string) { if (this.fail) throw new Error("upload failed"); this.objects.set(key, await readFile(path)); }
  async get(key: string, path: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw new Error("missing");
    await writeFile(path, this.corrupt ? bytes.subarray(0, 10) : bytes, { flag: "wx" });
  }
  async list(prefix: string) { return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort(); }
  async remove(key: string) { this.removed.push(key); this.objects.delete(key); }
}
const store = new MemoryStore();
beforeAll(async () => {
  vi.stubEnv("BACKUP_RESTORE_ISOLATED", "true");
  await admin.connect();
  await target.connect();
  await admin.query(`CREATE DATABASE ${identifier(database)} TEMPLATE template0`);
  created = true;
  await client.connect();
  scratch = await mkdtemp(join(tmpdir(), "weekly-backup-migrations-test-"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await client.end();
  try { if (created) await admin.query(`DROP DATABASE ${identifier(database)} WITH (FORCE)`); }
  finally { await admin.end(); await target.end(); if (scratch) await rm(scratch, { recursive: true, force: true }); }
});
it("защищает непустую базу только при неприменённой миграции", async () => {
  await mkdir(join(scratch, "20261106_test"));
  expect(await migrationBackupNeeded(client, scratch)).toBe(false);
  await client.query(`CREATE TABLE example (id integer PRIMARY KEY, text text, amount numeric, at timestamptz, payload jsonb);
    INSERT INTO example VALUES (1, 'Синтетический пример', 123.456, '2026-11-06T12:00:00Z', '{"ok":true}');
    CREATE SCHEMA extra; CREATE TABLE extra."Quoted table" (value text); INSERT INTO extra."Quoted table" VALUES ('тест');`);
  expect(await migrationBackupNeeded(client, scratch)).toBe(true);
  await client.query(`CREATE TABLE _prisma_migrations (migration_name text, finished_at timestamptz, rolled_back_at timestamptz, started_at timestamptz DEFAULT now());
    INSERT INTO _prisma_migrations (migration_name, finished_at, rolled_back_at) VALUES ('20261106_test', now(), null)`);
  expect(await migrationBackupNeeded(client, scratch)).toBe(false);
  await client.query("UPDATE _prisma_migrations SET rolled_back_at = now()");
  expect(await migrationBackupNeeded(client, scratch)).toBe(true);
});
it("восстанавливает исходный снимок после изменения исходной базы; удаляет только свою временную базу", async () => {
  const before = await target.query("SELECT datname FROM pg_database ORDER BY datname");
  const result = await createRemoteBackup("daily", { config, store, now: new Date("2026-09-01T12:00:00Z") });
  expect(result.tables).toBe(3);
  expect(result.monthlyKey).toContain("/monthly/2026-09/");
  await client.query("UPDATE example SET text = 'Изменено после копии'");
  expect(await verifyRemoteBackup(result.key, { config, store, targetUrl: targetAdmin })).toEqual({ key: result.key, tables: 3 });
  expect((await target.query("SELECT datname FROM pg_database ORDER BY datname")).rows).toEqual(before.rows);
  expect((await client.query("SELECT text FROM example")).rows[0].text).toBe("Изменено после копии");
});
it("не отдаёт повреждённый архив серверу восстановления и сохраняет старые копии при неудачной загрузке", async () => {
  const before = await target.query("SELECT datname FROM pg_database ORDER BY datname");
  const existing = [...store.objects.keys()];
  store.corrupt = true;
  await expect(verifyRemoteBackup(undefined, { config, store, targetUrl: targetAdmin })).rejects.toThrow();
  await expect(createRemoteBackup("daily", { config, store })).rejects.toThrow("не совпала");
  expect([...store.objects.keys()]).toEqual(existing);
  store.corrupt = false;
  store.fail = true;
  await expect(createRemoteBackup("daily", { config, store })).rejects.toThrow("upload failed");
  store.fail = false;
  expect([...store.objects.keys()]).toEqual(existing);
  expect((await target.query("SELECT datname FROM pg_database ORDER BY datname")).rows).toEqual(before.rows);
});
it("отклоняет расхождение строк после настоящего восстановления и всё равно убирает временную базу", async () => {
  const before = await target.query("SELECT datname FROM pg_database ORDER BY datname");
  const key = (await store.list("weekly-test/daily/"))[0];
  const original = store.objects.get(key)!;
  const archive = join(scratch, "original.wbk");
  const dump = join(scratch, "original.dump");
  const changed = join(scratch, "changed.wbk");
  await writeFile(archive, original);
  const manifest = await decryptArchive(archive, dump, config.encryptionKey);
  manifest.tables[0].rows++;
  await encryptArchive(dump, changed, manifest, config.encryptionKey);
  store.objects.set(key, await readFile(changed));
  try {
    await expect(verifyRemoteBackup(key, { config, store, targetUrl: targetAdmin })).rejects.toThrow("не совпало");
    expect((await target.query("SELECT datname FROM pg_database ORDER BY datname")).rows).toEqual(before.rows);
  } finally { store.objects.set(key, original); }
});
it("извлекает копию при недоступной исходной базе и не перезаписывает существующий файл", async () => {
  const key = (await store.list("weekly-test/daily/"))[0];
  const offline = new URL(config.databaseUrl);
  offline.port = "1";
  const output = join(scratch, "recovery.dump");
  expect((await extractRemoteBackup(key, output, { config: { ...config, databaseUrl: offline.toString() }, store })).database).toBe(database);
  const bytes = await readFile(output);
  expect(bytes.subarray(0, 5).toString()).toBe("PGDMP");
  await expect(extractRemoteBackup(key, output, { config, store })).rejects.toThrow();
  expect(await readFile(output)).toEqual(bytes);
});
it("сохраняет ежедневную, месячную и предмиграционную историю отдельно, не удаляет чужие файлы", async () => {
  store.objects.set("weekly-test/daily/manual.dump", Buffer.from("keep"));
  store.objects.set("foreign/copy.wbk", Buffer.from("keep"));
  for (const date of ["2026-10-01", "2026-10-02", "2026-11-01"]) {
    await createRemoteBackup("daily", { config, store, now: new Date(`${date}T12:00:00Z`) });
  }
  const daily = await store.list("weekly-test/daily/");
  expect(confirmedKeys(daily, "weekly-test/daily/")).toHaveLength(2);
  expect(daily).toContain("weekly-test/daily/manual.dump");
  expect(await store.list("weekly-test/monthly/2026-09/")).toHaveLength(0);
  expect((await store.list("weekly-test/monthly/")).filter((key) => key.endsWith(".wbk"))).toHaveLength(2);
  for (const date of ["2026-11-02", "2026-11-03", "2026-11-04"]) await createRemoteBackup("migration", { config, store, now: new Date(date) });
  expect(confirmedKeys(await store.list("weekly-test/migration/"), "weekly-test/migration/")).toHaveLength(2);
  expect(await store.list("weekly-test/daily/")).toEqual(daily);
  expect(store.objects.has("foreign/copy.wbk")).toBe(true);
});
it("не запускает две копии одновременно и не убивает экспортёр снимка перед миграцией", async () => {
  await client.query("SELECT pg_advisory_lock(890104)");
  try { await expect(createRemoteBackup("daily", { config, store })).rejects.toThrow("ещё создаётся"); }
  finally { await client.query("SELECT pg_advisory_unlock(890104)"); }
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SELECT pg_export_snapshot()");
  const observer = clientFor(source.toString());
  try {
    await observer.connect();
    await prepareDatabase(observer, { staleSeconds: 0, repeatable: () => false });
    expect((await client.query("SELECT 1 AS alive")).rows[0].alive).toBe(1);
  } finally { await client.query("ROLLBACK"); await observer.end(); }
});
it.each([false, true])("сохраняет архивы при ошибке PUT отметки (записана: %s), не запускает ротацию", async (saved) => {
  const markerConfig = { ...config, prefix: "marker-test", keepDaily: 1 };
  const memory = new MemoryStore();
  const old = await createRemoteBackup("daily", { config: markerConfig, store: memory, now: new Date("2026-11-01T00:00:00Z") });
  const ambiguous: BackupStore = {
    get: memory.get.bind(memory), list: memory.list.bind(memory), remove: memory.remove.bind(memory),
    put: async (key, path) => {
      if (key.endsWith(".ready")) {
        if (saved) await memory.put(key, path);
        throw new Error("ответ на PUT отметки потерян");
      }
      await memory.put(key, path);
    },
  };
  await expect(createRemoteBackup("daily", { config: markerConfig, store: ambiguous, now: new Date("2026-11-02T00:00:00Z") })).rejects.toThrow("ответ на PUT");
  expect(memory.objects.has(old.key)).toBe(true);
  const keys = await memory.list("marker-test/daily/");
  const newArchive = keys.find((key) => key.endsWith(".wbk") && key !== old.key)!;
  expect(newArchive).toBeTruthy();
  expect(memory.objects.has(`${newArchive}.ready`)).toBe(saved);
  const result = await verifyRemoteBackup(undefined, { config: markerConfig, store: memory, targetUrl: targetAdmin });
  expect(result.key).toBe(saved ? newArchive : old.key);
});
it("отклоняет dbname override до записи в существующую базу сервера восстановления", async () => {
  const before = await target.query("SELECT datname FROM pg_database ORDER BY datname");
  const redirected = new URL(targetAdmin!);
  redirected.searchParams.set("dbname", "postgres");
  await expect(verifyRemoteBackup(undefined, { config, store, targetUrl: redirected.toString() })).rejects.toThrow("параметр адреса");
  expect((await target.query("SELECT datname FROM pg_database ORDER BY datname")).rows).toEqual(before.rows);
});
it("не наследует скрытый маршрут и настройки libpq из окружения", async () => {
  const overrides = { PGHOSTADDR: "127.0.0.2", PGSERVICE: "weekly_nonexistent_service", PGPORT: "1", PGOPTIONS: "-c role=weekly_nonexistent_role" };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  try {
    const isolated = { ...config, prefix: "environment-test" };
    const memory = new MemoryStore();
    const result = await createRemoteBackup("daily", { config: isolated, store: memory });
    expect(await verifyRemoteBackup(undefined, { config: isolated, store: memory, targetUrl: targetAdmin })).toEqual({ key: result.key, tables: result.tables });
  } finally { for (const [key, value] of Object.entries(previous)) vi.stubEnv(key, value); }
});
it("не теряет последнюю подтверждённую копию при потере SQL-lock и сбое пересекающейся загрузки", async () => {
  const raceConfig = { ...config, prefix: "race-test", keepDaily: 1 };
  const memory = new MemoryStore();
  await createRemoteBackup("daily", { config: raceConfig, store: memory, now: new Date("2026-11-01T00:00:00Z") });
  let releaseUpload!: () => void;
  const waitingUpload = new Promise<void>((resolve) => { releaseUpload = resolve; });
  let uploaded!: () => void;
  const waitingUploaded = new Promise<void>((resolve) => { uploaded = resolve; });
  let raced = false;
  let second: Promise<boolean> | undefined;
  const racing: BackupStore = {
    put: memory.put.bind(memory), remove: memory.remove.bind(memory),
    get: async (key, path) => {
      if (key.includes("2026-11-03T")) {
        uploaded();
        await waitingUpload;
        throw new Error("скачивание второй копии не подтвердилось");
      }
      await memory.get(key, path);
    },
    list: async (prefix) => {
      if (prefix === "race-test/daily/" && !raced) {
        raced = true;
        // Прерывается только сессия копирования в случайной синтетической базе этого теста.
        await client.query(`SELECT pg_terminate_backend(l.pid) FROM pg_locks l
          WHERE l.locktype = 'advisory' AND l.classid = 0 AND l.objid = 890104
            AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())`);
        second = createRemoteBackup("daily", { config: raceConfig, store: racing, now: new Date("2026-11-03T00:00:00Z") })
          .then(() => false, () => true);
        await waitingUploaded;
      }
      return memory.list(prefix);
    },
  };
  let first: Awaited<ReturnType<typeof createRemoteBackup>>;
  try {
    first = await createRemoteBackup("daily", { config: raceConfig, store: racing, now: new Date("2026-11-02T00:00:00Z") });
  } finally { releaseUpload(); }
  expect(await second).toBe(true);
  expect(memory.objects.has(first.key)).toBe(true);
  expect(await verifyRemoteBackup(undefined, { config: raceConfig, store: memory, targetUrl: targetAdmin })).toEqual({ key: first.key, tables: first.tables });
});
it("собранный фоновый процесс сохраняет расписание и штатно останавливается; копия включает очередь", async () => {
  // Сценарий обновления: старые очереди уже существуют с прежними пределами.
  const oldWorker = new PgBoss(source.toString());
  oldWorker.on("error", () => {});
  await oldWorker.start();
  try {
    for (const name of ["backup-nightly", "backup-restore-check"]) {
      await oldWorker.createQueue(name, { retryLimit: 0, retryDelay: 0, expireInSeconds: 900 });
    }
  } finally { await oldWorker.stop(); }
  const child = spawn(process.execPath, ["dist/start/scripts/worker.mjs"], { env: {
    ...process.env, DATABASE_URL: source.toString(), BACKUP_ENABLED: "true", BACKUP_RESTORE_ENABLED: "true",
    BACKUP_RESTORE_DATABASE_URL: targetAdmin, BACKUP_RESTORE_ISOLATED: "true",
    BACKUP_S3_ENDPOINT: "https://s3.example.test", BACKUP_S3_REGION: "test", BACKUP_S3_BUCKET: "weekly-test",
    BACKUP_S3_PREFIX: "weekly-test", BACKUP_S3_ACCESS_KEY_ID: "synthetic", BACKUP_S3_SECRET_ACCESS_KEY: "synthetic",
    BACKUP_ENCRYPTION_KEY: config.encryptionKey.toString("base64"), TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "", ALERTS: "off",
  }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Фоновый процесс не подтвердил запуск")), 20_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Фоновый процесс завершился до готовности")); });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        if (output.includes("Внешние копии: ежедневно")) { clearTimeout(timer); resolve(); }
      });
    });
    expect((await client.query("SELECT name, cron, timezone FROM pgboss.schedule ORDER BY name")).rows).toEqual([
      { name: "backup-nightly", cron: "0 3 * * *", timezone: "Europe/Moscow" },
      { name: "backup-restore-check", cron: "0 4 1 * *", timezone: "Europe/Moscow" },
    ]);
    expect((await client.query("SELECT name, retry_limit, retry_delay, expire_seconds FROM pgboss.queue WHERE name IN ('backup-nightly', 'backup-restore-check') ORDER BY name")).rows).toEqual([
      { name: "backup-nightly", retry_limit: 2, retry_delay: 300, expire_seconds: 3600 },
      { name: "backup-restore-check", retry_limit: 2, retry_delay: 300, expire_seconds: 3600 },
    ]);
  } finally {
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try { expect(await exited).toBe(0); } finally { clearTimeout(timer); }
  }
  const result = await createRemoteBackup("daily", { config, store });
  expect(result.tables).toBeGreaterThan(3);
  expect(await verifyRemoteBackup(result.key, { config, store, targetUrl: targetAdmin })).toEqual({ key: result.key, tables: result.tables });
});
