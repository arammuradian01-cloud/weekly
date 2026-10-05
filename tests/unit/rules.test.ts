import { describe, expect, it } from "vitest";
import { managementPasswordKind, managementRoleFor } from "@/lib/roles";
import { hashPassword, validateNewPassword, verifyPassword } from "@/lib/passwords";
import { backupFileName, filesToDelete, needsMonthly } from "@/lib/backup-rotation";
import { clientIp } from "@/lib/client-ip";
import { databaseUrlFromEnv, pgConnectionConfig, sessionSecretFromEnv } from "@/lib/database-url";

describe("роли и пароли управления", () => {
  it("режим управления есть только у владельца и администраторов", () => {
    expect(managementRoleFor("OWNER")).toBe("OWNER");
    expect(managementRoleFor("ADMIN")).toBe("ADMIN");
    expect(managementRoleFor("LEADER")).toBeNull();
    expect(managementRoleFor("OBSERVER")).toBeNull();
  });

  it("у владельца и администраторов разные пароли", () => {
    expect(managementPasswordKind("OWNER")).toBe("owner");
    expect(managementPasswordKind("ADMIN")).toBe("admin");
  });
});

describe("пароли", () => {
  it("1234 и короткие пароли не принимаются", () => {
    expect(validateNewPassword("1234")).not.toBeNull();
    expect(validateNewPassword("short-pass")).not.toBeNull();
    expect(validateNewPassword(" leading-space-pass")).not.toBeNull();
    expect(validateNewPassword("длинный-пароль-команды")).toBeNull();
  });

  it("хэш проверяется, а без хэша вход невозможен", async () => {
    const hash = await hashPassword("длинный-пароль-команды");
    expect(await verifyPassword("длинный-пароль-команды", hash)).toBe(true);
    expect(await verifyPassword("другой-пароль-команды", hash)).toBe(false);
    expect(await verifyPassword("любой-пароль", null)).toBe(false);
  });
});

describe("резервные копии", () => {
  it("имя файла по московскому времени", () => {
    expect(backupFileName(new Date("2026-10-04T00:00:00Z"))).toBe("weekly-2026-10-04_0300.dump");
  });

  it("оставляет 30 самых свежих и не трогает чужие файлы", () => {
    const files = Array.from({ length: 33 }, (_, i) => `weekly-2026-09-${String(i + 1).padStart(2, "0")}_0300.dump`);
    files.push("notes.txt");
    const del = filesToDelete(files, 30);
    expect(del).toEqual(["weekly-2026-09-01_0300.dump", "weekly-2026-09-02_0300.dump", "weekly-2026-09-03_0300.dump"]);
  });

  it("копия месяца делается один раз в месяц", () => {
    expect(needsMonthly([], "weekly-2026-10-04_0300.dump")).toBe(true);
    expect(needsMonthly(["weekly-2026-10-01_0300.dump"], "weekly-2026-10-04_0300.dump")).toBe(false);
    expect(needsMonthly(["weekly-2026-09-01_0300.dump"], "weekly-2026-10-04_0300.dump")).toBe(true);
  });
});

describe("адрес клиента для блокировки", () => {
  const h = new Headers({ "x-forwarded-for": "203.0.113.5, 198.51.100.7" });
  it("без своего прокси заголовку не верим, иначе блокировку обойдут подменой", () => {
    expect(clientIp(h, false)).toBe("local");
  });
  it("за прокси берём адрес, который дописал последний доверенный узел", () => {
    expect(clientIp(h, true, 1)).toBe("198.51.100.7");
    expect(clientIp(h, true, 2)).toBe("203.0.113.5");
  });
  it("подделанный клиентом первый адрес не помогает обойти блокировку", () => {
    const forged = new Headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.7" });
    expect(clientIp(forged, true, 1)).toBe("198.51.100.7");
  });
  it("без X-Forwarded-For берём X-Real-IP", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.9" }), true)).toBe("198.51.100.9");
  });
});

describe("подключение к базе", () => {
  const CA = new URL("../../certs/timeweb-managed-ca.crt", import.meta.url).pathname;

  it("без sslmode шифрование не включаем", () => {
    expect(pgConnectionConfig("postgresql://u:p@h:5432/db", {})).toEqual({ connectionString: "postgresql://u:p@h:5432/db" });
  });
  it("sslmode=require шифрует без проверки сертификата и убирает параметры Prisma из строки", () => {
    const c = pgConnectionConfig("postgresql://u:p@h:5432/db?sslmode=require&sslaccept=accept_invalid_certs", {});
    expect(c).toEqual({ connectionString: "postgresql://u:p@h:5432/db", ssl: { rejectUnauthorized: false } });
  });
  it("verify-full включает проверку сертификата", () => {
    expect(pgConnectionConfig("postgresql://u:p@h:5432/db?sslmode=verify-full", {}).ssl).toEqual({ rejectUnauthorized: true });
  });
  it("с корневым сертификатом провайдера проверка полная", () => {
    const ssl = pgConnectionConfig("postgresql://u:p@h:5432/db?sslmode=require", { DB_SSL_ROOT_CERT: CA }).ssl;
    expect(ssl?.rejectUnauthorized).toBe(true);
    expect(ssl?.ca).toContain("BEGIN CERTIFICATE");
  });
  it("DATABASE_URL важнее частей", () => {
    expect(databaseUrlFromEnv({ DATABASE_URL: "postgresql://a@b/c", DB_HOST: "x", DB_PASSWORD: "y" })).toBe("postgresql://a@b/c");
  });
  it("из частей собирается адрес с закодированным паролем и шифрованием", () => {
    const url = databaseUrlFromEnv({ DB_HOST: "db.example.net", DB_USER: "gen_user", DB_NAME: "default_db", DB_PASSWORD: "a@b:c/d%e#f?g" });
    expect(url).toBe("postgresql://gen_user:a%40b%3Ac%2Fd%25e%23f%3Fg@db.example.net:5432/default_db?sslmode=require&sslaccept=accept_invalid_certs");
    expect(decodeURIComponent(new URL(url!).password)).toBe("a@b:c/d%e#f?g");
  });
  it("без пароля или хоста адреса нет, DB_SSL=disable убирает шифрование", () => {
    expect(databaseUrlFromEnv({ DB_HOST: "h" })).toBeUndefined();
    expect(databaseUrlFromEnv({ DB_HOST: "h", DB_PASSWORD: "p", DB_SSL: "disable" })).toBe("postgresql://postgres:p@h:5432/postgres");
  });
  it("ключ сессий: из окружения, иначе из пароля базы, иначе пусто", () => {
    expect(sessionSecretFromEnv({ SESSION_SECRET: "s".repeat(40), DB_HOST: "h", DB_PASSWORD: "p" })).toBe("s".repeat(40));
    const derived = sessionSecretFromEnv({ DB_HOST: "h", DB_PASSWORD: "пароль базы" });
    expect(derived.length).toBeGreaterThanOrEqual(32);
    expect(sessionSecretFromEnv({ DB_HOST: "other", DB_PASSWORD: "пароль базы" })).toBe(derived);
    expect(sessionSecretFromEnv({ DB_HOST: "h", DB_PASSWORD: "другой" })).not.toBe(derived);
    expect(sessionSecretFromEnv({ DATABASE_URL: "postgresql://me@localhost:5432/weekly" })).toBe("");
  });
});

describe("код первичной настройки", () => {
  it("16 знаков в четырёх группах, без похожих символов, каждый раз новый", async () => {
    const { generateSetupCode } = await import("@/lib/setup-status");
    const a = generateSetupCode();
    expect(a).toMatch(/^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){3}$/);
    expect(generateSetupCode()).not.toBe(a);
  });
  it("регистр, пробелы и дефисы не меняют хэш", async () => {
    const { hashSetupCode } = await import("@/lib/setup-status");
    expect(hashSetupCode(" k7m2 qx9r-t4hb8nwc ")).toBe(hashSetupCode("K7M2-QX9R-T4HB-8NWC"));
    expect(hashSetupCode("K7M2-QX9R-T4HB-8NWD")).not.toBe(hashSetupCode("K7M2-QX9R-T4HB-8NWC"));
  });
});
