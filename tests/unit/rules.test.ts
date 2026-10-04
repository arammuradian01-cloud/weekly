import { describe, expect, it } from "vitest";
import { managementPasswordKind, managementRoleFor } from "@/lib/roles";
import { hashPassword, validateNewPassword, verifyPassword } from "@/lib/passwords";
import { backupFileName, filesToDelete, needsMonthly } from "@/lib/backup-rotation";
import { clientIp } from "@/lib/client-ip";

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
