import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decryptArchive, encryptArchive, fileHash, type Manifest } from "../../scripts/lib/remote-backup/archive";
import { backupConfig, restoreTarget } from "../../scripts/lib/remote-backup/config";
import { compareDigests } from "../../scripts/lib/remote-backup/postgres";
import { monthlyPeriod, ownedKeys } from "../../scripts/lib/remote-backup/core";

describe("аутентифицированная резервная копия", () => {
  let dir: string;
  let manifest: Manifest;
  const key = randomBytes(32);
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "weekly-archive-test-"));
    // Несколько блоков потока; содержимое не является рабочей выгрузкой.
    await writeFile(join(dir, "source"), Buffer.concat([Buffer.from("SYNTHETIC TEST DATA"), randomBytes(256_000)]));
    manifest = { version: 1, createdAt: "2026-11-06T12:00:00.000Z", database: "synthetic_test", purpose: "daily",
      dumpSha256: await fileHash(join(dir, "source")), tables: [{ schema: "public", table: "example", rows: 2, sha256: "a".repeat(64) }] };
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));
  const archive = () => join(dir, "copy.wbk");
  const output = () => join(dir, "restored");
  const encrypt = () => encryptArchive(join(dir, "source"), archive(), manifest, key);
  it("возвращает все байты и паспорт, не оставляет открытый промежуточный файл", async () => {
    await encrypt();
    expect((await readFile(archive())).includes(Buffer.from("SYNTHETIC TEST DATA"))).toBe(false);
    expect((await stat(archive())).mode & 0o777).toBe(0o600);
    expect(await decryptArchive(archive(), output(), key)).toEqual(manifest);
    expect(await fileHash(output())).toBe(manifest.dumpSha256);
    expect(await readdir(dir)).not.toContain("restored.payload");
  });
  it.each(["key", "header", "ciphertext", "tag", "truncate"])("отклоняет повреждение %s до выдачи pg_restore", async (kind) => {
    await encrypt();
    let bytes = await readFile(archive());
    if (kind === "header") bytes[10] ^= 1;
    if (kind === "ciphertext") bytes[100] ^= 1;
    if (kind === "tag") bytes[bytes.length - 1] ^= 1;
    if (kind === "truncate") bytes = bytes.subarray(0, 10);
    await writeFile(archive(), bytes);
    await expect(decryptArchive(archive(), output(), kind === "key" ? randomBytes(32) : key)).rejects.toThrow();
    expect(await readdir(dir)).toEqual(expect.not.arrayContaining(["restored", "restored.payload"]));
  });
  it("отклоняет неверный паспорт и хеш даже при правильном ключе", async () => {
    manifest.dumpSha256 = "0".repeat(64);
    await encrypt();
    await expect(decryptArchive(archive(), output(), key)).rejects.toThrow("Контрольная сумма");
    expect(await readdir(dir)).not.toContain("restored");
    await rm(archive());
    manifest.tables = [];
    await encrypt();
    await expect(decryptArchive(archive(), output(), key)).rejects.toThrow("паспорт");
  });
  it("не перезаписывает и не удаляет существующий файл назначения", async () => {
    await encrypt();
    await writeFile(output(), "keep");
    await expect(decryptArchive(archive(), output(), key)).rejects.toThrow();
    expect(await readFile(output(), "utf8")).toBe("keep");
  });
});

describe("ограничения внешних копий", () => {
  const env = { DATABASE_URL: "postgresql://test@source/synthetic_test", BACKUP_S3_ENDPOINT: "https://s3.example.test",
    BACKUP_S3_REGION: "test", BACKUP_S3_BUCKET: "weekly-test", BACKUP_S3_PREFIX: "weekly-test",
    BACKUP_S3_ACCESS_KEY_ID: "test", BACKUP_S3_SECRET_ACCESS_KEY: "test", BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
  it("требует полного набора настроек, HTTPS, собственного префикса и 256-битного ключа", () => {
    expect(backupConfig(env).keepDaily).toBe(30);
    for (const field of Object.keys(env).filter((name) => name !== "DATABASE_URL")) {
      expect(() => backupConfig({ ...env, [field]: "" })).toThrow();
    }
    for (const value of ["http://s3.example.test", "https://s3.example.test/path", "https://user:pass@s3.example.test"]) {
      expect(() => backupConfig({ ...env, BACKUP_S3_ENDPOINT: value })).toThrow();
    }
    for (const value of ["../other", "weekly/", "weekly//other", "/"]) expect(() => backupConfig({ ...env, BACKUP_S3_PREFIX: value })).toThrow();
    for (const value of ["0", "-1", "1.5", "", "NaN"]) expect(() => backupConfig({ ...env, BACKUP_KEEP_DAILY: value })).toThrow();
    expect(() => backupConfig({ ...env, BACKUP_ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toThrow();
  });
  it("не восстанавливает на рабочем сервере или без явного выделения сервера", () => {
    expect(() => restoreTarget(env.DATABASE_URL, { BACKUP_RESTORE_DATABASE_URL: "postgresql://test@source:5432/another", BACKUP_RESTORE_ISOLATED: "true" })).toThrow("отдельный сервер");
    expect(() => restoreTarget(env.DATABASE_URL, { BACKUP_RESTORE_DATABASE_URL: "postgresql://test@target/postgres" })).toThrow("Подтвердите");
    expect(restoreTarget(env.DATABASE_URL, { BACKUP_RESTORE_DATABASE_URL: "postgresql://test@target/postgres", BACKUP_RESTORE_ISOLATED: "true" })).toContain("target");
  });
  it("не считает соседние префиксы и неизвестные файлы своей историей", () => {
    const name = "weekly-2026-11-06T12-00-00-000Z-12345678-1234-1234-1234-123456789abc.wbk";
    expect(ownedKeys([`one/daily/${name}`, `one/daily/nested/${name}`, `other/daily/${name}`, "one/daily/foreign.dump"], "one/daily/")).toEqual([`one/daily/${name}`]);
    expect(monthlyPeriod(new Date("2026-10-31T22:00:00Z"))).toBe("2026-11");
  });
  it("сверяет содержимое, число строк и полный набор таблиц", () => {
    const expected = [{ schema: "public", table: "example", rows: 2, sha256: "a".repeat(64) }];
    expect(() => compareDigests(expected, expected)).not.toThrow();
    expect(() => compareDigests(expected, [])).toThrow();
    expect(() => compareDigests(expected, [{ ...expected[0], rows: 1 }])).toThrow();
    expect(() => compareDigests(expected, [{ ...expected[0], sha256: "b".repeat(64) }])).toThrow();
  });
});
