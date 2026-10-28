// [Codex] Независимые пароли управления владельцев, без секретов в политике и журнале.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { setSetting } from "@/lib/settings";
import { checkManagementPassword, managementCredential, managementPasswordCurrent, managementPasswordPolicy, setManagementPasswordMode } from "@/lib/login/management-password";
import { loginWithPassword, PERSON_MAX_FAILURES } from "@/lib/login/password";
import type { Actor } from "@/lib/tasks/service";
import { consumeStepUp, hashToken } from "@/lib/login/service";

const prefix = "test-management-password-";
const shared = "Shared owner password 2026";
const personal = "Personal owner password 2026";
const now = new Date("2026-10-23T09:00:00Z");
let sharedHash: string, personalHash: string;
let original: unknown;
const actor = (suffix: string): Actor => ({ personId: prefix + suffix, slug: prefix + suffix, fullName: "Тестовый владелец", role: "OWNER", management: null, via: "PASSWORD", ip: "10.91.0.1" });
const who = (suffix = "b") => prisma.person.findUniqueOrThrow({ where: { id: prefix + suffix } });
const grant = (credential?: string) => ({ role: "OWNER" as const, until: now.getTime() + 3600000, epoch: 1, ...(credential ? { credential } : {}) });

async function clean() {
  await prisma.setting.deleteMany({ where: { key: { startsWith: `auth.management.person.${prefix}` } } });
  await prisma.person.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.loginAttempt.deleteMany({ where: { ip: { startsWith: "10.91." } } });
}
beforeAll(async () => {
  sharedHash = await bcrypt.hash(shared, 4);
  personalHash = await bcrypt.hash(personal, 4);
  original = (await prisma.setting.findUnique({ where: { key: "auth.owner.hash" } }))?.value;
});
beforeEach(async () => {
  await clean();
  await setSetting("auth.owner.hash", sharedHash);
  for (const suffix of ["a", "b"]) {
    await prisma.person.create({ data: { id: prefix + suffix, slug: prefix + suffix, fullName: "Тестовый владелец " + suffix, shortName: suffix, zone: "", role: "OWNER", passwordHash: personalHash, passwordSetAt: now } });
    await prisma.deviceSession.create({ data: { id: prefix + "device-" + suffix, personId: prefix + suffix, method: "PASSWORD", expiresAt: new Date(now.getTime() + 86400000) } });
  }
});
afterAll(async () => {
  await clean();
  if (typeof original === "string") await setSetting("auth.owner.hash", original);
  else await prisma.setting.deleteMany({ where: { key: "auth.owner.hash" } });
  await prisma.$disconnect();
});

describe("персональный пароль управления", () => {
  it("у первого владельца прежний пароль, у второго личный; чужой источник не подходит", async () => {
    await setManagementPasswordMode(prefix + "b", "personal");
    await expect(checkManagementPassword(actor("a"), prefix + "device-a", shared, now)).resolves.toBe("shared/default/");
    await expect(checkManagementPassword(actor("a"), prefix + "device-a", personal, now)).rejects.toThrow(/Неверный пароль/);
    await expect(checkManagementPassword(actor("b"), prefix + "device-b", shared, now)).rejects.toThrow(/пароль неверный/);
    const credential = await checkManagementPassword(actor("b"), prefix + "device-b", personal, now);
    expect(await managementPasswordCurrent(grant(credential), await who(), true)).toBe(true);
    expect(await managementPasswordCurrent(grant(credential), await who("a"), true)).toBe(false);
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "auth.owner.hash" } })).value).toBe(sharedHash);
  });

  it("без личного входа, с чужим, завершённым или просроченным устройством отказ", async () => {
    await setManagementPasswordMode(prefix + "b", "personal");
    await expect(checkManagementPassword({ ...actor("b"), via: "TEAM" }, null, personal, now)).rejects.toThrow(/личным логином/);
    await expect(checkManagementPassword(actor("b"), prefix + "device-a", personal, now)).rejects.toThrow(/вход завершён/);
    await prisma.deviceSession.update({ where: { id: prefix + "device-b" }, data: { revokedAt: now } });
    await expect(checkManagementPassword(actor("b"), prefix + "device-b", personal, now)).rejects.toThrow(/вход завершён/);
    await prisma.deviceSession.update({ where: { id: prefix + "device-b" }, data: { revokedAt: null, expiresAt: now } });
    await expect(checkManagementPassword(actor("b"), prefix + "device-b", personal, now)).rejects.toThrow(/вход завершён/);
  });

  it("сброс личного пароля не возвращает общий пароль и гасит управление", async () => {
    await setManagementPasswordMode(prefix + "b", "personal");
    const credential = await checkManagementPassword(actor("b"), prefix + "device-b", personal, now);
    await prisma.person.update({ where: { id: prefix + "b" }, data: { passwordHash: null, passwordSetAt: null } });
    await expect(checkManagementPassword(actor("b"), prefix + "device-b", shared, now)).rejects.toThrow(/ещё не задан/);
    expect(await managementPasswordCurrent(grant(credential), await who(), true)).toBe(false);
  });

  it("смена личного пароля и переключение режима гасят старый grant, не затрагивая первого владельца", async () => {
    await setManagementPasswordMode(prefix + "b", "personal");
    const credential = await checkManagementPassword(actor("b"), prefix + "device-b", personal, now);
    await prisma.person.update({ where: { id: prefix + "b" }, data: { passwordHash: await bcrypt.hash("Новое секретное слово", 4), passwordSetAt: new Date(now.getTime() + 1000) } });
    expect(await managementPasswordCurrent(grant(credential), await who(), true)).toBe(false);
    const updated = managementCredential(await who(), await managementPasswordPolicy(await who()));
    await setManagementPasswordMode(prefix + "b", "shared");
    expect(await managementPasswordCurrent(grant(updated), await who(), true)).toBe(false);
    expect(await managementPasswordCurrent(grant(), await who(), true)).toBe(false);
    expect(await managementPasswordCurrent(grant(), await who("a"), true)).toBe(true);
    await expect(checkManagementPassword(actor("b"), prefix + "device-b", shared, now)).resolves.toMatch(/^shared\//);
  });

  it("выключенный владелец и сотрудник не получают управление", async () => {
    await setManagementPasswordMode(prefix + "b", "personal");
    await prisma.person.update({ where: { id: prefix + "b" }, data: { active: false } });
    await expect(checkManagementPassword(actor("b"), prefix + "device-b", personal, now)).rejects.toThrow(/Права изменились/);
    await prisma.person.update({ where: { id: prefix + "b" }, data: { active: true, role: "EMPLOYEE" } });
    await expect(checkManagementPassword(actor("b"), prefix + "device-b", personal, now)).rejects.toThrow(/Права изменились/);
    await expect(setManagementPasswordMode(prefix + "b", "personal")).rejects.toThrow(/включённый владелец/);
  });

  it("лимит личного входа и управления общий по человеку даже при смене IP", async () => {
    await setManagementPasswordMode(prefix + "b", "personal");
    for (let i = 0; i < PERSON_MAX_FAILURES; i++) {
      await expect(checkManagementPassword({ ...actor("b"), ip: `10.91.1.${i}` }, prefix + "device-b", "ошибка", new Date(now.getTime() + i))).rejects.toThrow(/пароль неверный/);
    }
    const later = new Date(now.getTime() + 100);
    await expect(checkManagementPassword({ ...actor("b"), ip: "10.91.2.1" }, prefix + "device-b", personal, later)).rejects.toThrow(/Слишком много/);
    expect(await loginWithPassword(prefix + "b", personal, { ip: "10.91.2.2", userAgent: "test" }, later)).toMatchObject({ ok: false, error: expect.stringMatching(/Слишком много/) });
  });

  it("настройка идемпотентна, журнал без секретов, другой владелец не меняется", async () => {
    const result = await setManagementPasswordMode(prefix + "b", "personal");
    expect(result.changed).toBe(true);
    const policy = await managementPasswordPolicy(await who());
    expect((await setManagementPasswordMode(prefix + "b", "personal")).changed).toBe(false);
    expect(await managementPasswordPolicy(await who())).toEqual(policy);
    expect(await managementPasswordPolicy(await who("a"))).toEqual({ mode: "shared", version: "default" });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: prefix + "b", action: "management.password-mode" }, orderBy: { id: "desc" } });
    expect(log).toMatchObject({ before: "shared", after: "personal", source: "SYSTEM" });
    expect(JSON.stringify({ ...log, id: String(log.id) })).not.toContain(personalHash);
    expect(JSON.stringify(policy)).not.toContain(personalHash);
  });

  it("повреждённая настройка: ошибки 500 нет, управления нет, ошибка в журнале сервера; команда восстанавливает", async () => {
    const key = `auth.management.person.${prefix}b`;
    await setSetting(key, { mode: "что-то другое" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await managementPasswordPolicy(await who())).toMatchObject({ mode: "personal", broken: true });
      // Ни прежняя cookie, ни выданная по общему паролю управление не дают, но и не падают
      expect(await managementPasswordCurrent(grant(), await who(), true)).toBe(false);
      expect(await managementPasswordCurrent(grant("shared/default/"), await who(), true)).toBe(false);
      await expect(checkManagementPassword(actor("b"), prefix + "device-b", shared, now)).rejects.toThrow(/повреждена/);
      await expect(checkManagementPassword(actor("b"), prefix + "device-b", personal, now)).rejects.toThrow(/повреждена/);
      expect(logged).toHaveBeenCalled();
      // Другой владелец не задет
      await expect(checkManagementPassword(actor("a"), prefix + "device-a", shared, now)).resolves.toBe("shared/default/");
      // Команда оператора перезаписывает повреждённую настройку, даже если режим тот же
      expect((await setManagementPasswordMode(prefix + "b", "personal")).changed).toBe(true);
      const fixed = await managementPasswordPolicy(await who());
      expect(fixed.broken).toBeUndefined();
      expect(fixed.mode).toBe("personal");
    } finally {
      logged.mockRestore();
    }
  });

  it("старая ссылка администратора после назначения владельцем не открывает управление", async () => {
    const token = "test-promoted-admin-token";
    await prisma.loginLink.create({ data: { tokenHash: hashToken(token), kind: "STEP_UP", personId: prefix + "b", deviceId: prefix + "device-b", expiresAt: new Date(now.getTime() + 60000) } });
    await expect(consumeStepUp(token, actor("b"), prefix + "device-b", now)).rejects.toThrow(/только администраторам/);
    await expect(consumeStepUp(token, { ...actor("b"), role: "ADMIN" }, prefix + "device-b", now)).rejects.toThrow(/Права изменились/);
  });
});
