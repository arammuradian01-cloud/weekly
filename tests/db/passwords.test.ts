// Личные логины и пароли (этап 20а): пароль по ссылке, вход по логину или почте, подбор, сброс, смена, ссылки всем.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as login from "@/lib/login/service";
import * as pw from "@/lib/login/password";

const owner = async () => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "INVITE" as const });
const device = { ip: "10.0.0.7", userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1" };
const t0 = new Date("2026-10-07T09:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const GOOD = "Летний отпуск 2026!";
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

async function reset() {
  await prisma.deviceSession.deleteMany();
  await prisma.loginLink.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.person.updateMany({ data: { email: null, passwordHash: null, passwordSetAt: null, active: true } });
  await prisma.person.updateMany({ where: { slug: { in: ["analyst", "ceo"] } }, data: { active: false } });
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

/** Ссылка от владельца и пароль по ней */
async function withPassword(slug: string, password = GOOD, at = t0) {
  const invite = await login.issueInvite(await owner(), slug, at);
  return pw.setPasswordByLink(invite.token, password, password, device, at);
}

describe("пароль по ссылке", () => {
  it("человек сам задаёт пароль по ссылке и сразу входит; ссылка тратится", async () => {
    const invite = await login.issueInvite(await owner(), "reva", t0);
    const peek = await login.peekLink(invite.token, t0);
    expect(peek).toMatchObject({ status: "ok", kind: "INVITE", login: "reva", hasPassword: false });
    const { session, person } = await pw.setPasswordByLink(invite.token, GOOD, GOOD, device, t0);
    expect(person.slug).toBe("reva");
    expect(session.method).toBe("INVITE");
    const row = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row.passwordHash).not.toContain(GOOD);
    expect((await login.peekLink(invite.token, t0)).status).toBe("used");
    await expectRule(pw.setPasswordByLink(invite.token, GOOD, GOOD, device, t0), /уже использована/);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.password.set", entityId: "reva" }, orderBy: { id: "desc" } });
    expect(log.field).toBe("Пароль задан");
  });

  it("слабый пароль не принимается, ссылка при этом не тратится", async () => {
    const invite = await login.issueInvite(await owner(), "reva", t0);
    await expectRule(pw.setPasswordByLink(invite.token, "короткий", "короткий", device, t0), /не короче 10/);
    await expectRule(pw.setPasswordByLink(invite.token, "12345678901", "12345678901", device, t0), /только из цифр/);
    await expectRule(pw.setPasswordByLink(invite.token, "Тарас любит кофе", "Тарас любит кофе", device, t0), /имя или фамилию/);
    await expectRule(pw.setPasswordByLink(invite.token, "reva-и-кофе-2026", "reva-и-кофе-2026", device, t0), /логин/);
    await expectRule(pw.setPasswordByLink(invite.token, "qwerty12345", "qwerty12345", device, t0), /Слишком простой/);
    await expectRule(pw.setPasswordByLink(invite.token, GOOD, `${GOOD}x`, device, t0), /не совпадают/);
    expect((await login.peekLink(invite.token, t0)).status).toBe("ok");
  });

  it("новая ссылка при заданном пароле меняет его и завершает прежние входы", async () => {
    const first = await withPassword("reva");
    const again = await login.issueInvite(await owner(), "reva", later(60_000));
    expect((await login.peekLink(again.token, later(60_000))).hasPassword).toBe(true);
    await pw.setPasswordByLink(again.token, "Осенний марафон 42", "Осенний марафон 42", device, later(60_000));
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: first.session.id } })).revokedBy).toBe("password");
    expect((await pw.loginWithPassword("reva", GOOD, device, later(120_000))).ok).toBe(false);
    expect((await pw.loginWithPassword("reva", "Осенний марафон 42", device, later(120_000))).ok).toBe(true);
  });
});

describe("вход по логину и паролю", () => {
  it("логин: короткое имя или почта, регистр не важен; устройство на 30 дней", async () => {
    await withPassword("reva");
    await prisma.person.update({ where: { slug: "reva" }, data: { email: "reva@sravni.ru" } });
    const before = (await prisma.auditLog.findFirst({ orderBy: { id: "desc" }, select: { id: true } }))?.id ?? 0;
    const a = await pw.loginWithPassword("Reva", GOOD, device, later(1000));
    expect(a.ok).toBe(true);
    const b = await pw.loginWithPassword("REVA@sravni.ru", GOOD, device, later(2000));
    expect(b.ok).toBe(true);
    if (!a.ok) return;
    const session = await prisma.deviceSession.findUniqueOrThrow({ where: { id: a.sessionId } });
    expect(session.method).toBe("PASSWORD");
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBe(login.DEVICE_TTL_MS);
    expect(await login.loadDevice(a.sessionId, later(3000))).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "auth.login", entityId: "reva", via: "PASSWORD", id: { gt: before } } })).toBe(2);
  });

  it("неверный логин и неверный пароль дают один ответ; без пароля и выключенный не входят", async () => {
    await withPassword("reva");
    expect(await pw.loginWithPassword("reva", "не тот пароль", device, later(1000))).toEqual({ ok: false, error: "Неверный логин или пароль" });
    expect(await pw.loginWithPassword("nobody", GOOD, device, later(1000))).toEqual({ ok: false, error: "Неверный логин или пароль" });
    // У Логиновой пароля нет
    expect(await pw.loginWithPassword("loginova", GOOD, device, later(1000))).toEqual({ ok: false, error: "Неверный логин или пароль" });
    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    expect(await pw.loginWithPassword("reva", GOOD, device, later(2000))).toEqual({ ok: false, error: "Неверный логин или пароль" });
    expect(await prisma.deviceSession.count({ where: { method: "PASSWORD" } })).toBe(0);
  });

  it("5 неверных попыток к одному логину закрывают его на 15 минут, даже с разных адресов; другим это не мешает", async () => {
    await withPassword("reva");
    await withPassword("loginova", "Зимний вечер у камина");
    for (let i = 0; i < 5; i++) {
      const r = await pw.loginWithPassword("reva", `неверный пароль ${i}`, { ...device, ip: `10.0.1.${i}` }, later(i * 1000));
      expect(r.ok).toBe(false);
    }
    const locked = await pw.loginWithPassword("reva", GOOD, { ...device, ip: "10.0.2.1" }, later(10_000));
    expect(locked).toMatchObject({ ok: false });
    expect(!locked.ok && locked.error).toMatch(/к этому логину/);
    // Коллега с того же офисного адреса входит
    const colleague = await pw.loginWithPassword("loginova", "Зимний вечер у камина", { ...device, ip: "10.0.1.0" }, later(11_000));
    expect(colleague).toMatchObject({ ok: true });
    // Через 15 минут логин снова открыт
    expect((await pw.loginWithPassword("reva", GOOD, device, later(16 * 60_000))).ok).toBe(true);
  });

  it("с одного адреса не больше 30 неверных попыток за 15 минут", async () => {
    for (let i = 0; i < 30; i++) await pw.loginWithPassword(`ghost${i}`, "неверно-неверно", device, later(i * 100));
    const r = await pw.loginWithPassword("reva", GOOD, device, later(5000));
    expect(!r.ok && r.error).toMatch(/с этого адреса/);
  });
});

describe("сброс, смена и ссылки всем", () => {
  it("владелец сбрасывает пароль: старый не работает, входы и ссылки гаснут; не владелец не может", async () => {
    const { session } = await withPassword("reva");
    await expectRule(pw.resetPassword({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "INVITE" }, "reva"), /только владелец/);
    await pw.resetPassword(await owner(), "reva", later(1000));
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).passwordHash).toBeNull();
    expect((await pw.loginWithPassword("reva", GOOD, device, later(2000))).ok).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "auth.password.reset", entityId: "reva" } })).toBe(1);
  });

  it("смена пароля в профиле: только при личном входе и с текущим паролем; другие устройства выходят", async () => {
    const { session } = await withPassword("reva");
    const other = await pw.loginWithPassword("reva", GOOD, device, later(1000));
    if (!other.ok) throw new Error("вход не прошёл");
    const reva = { ...(await tasks.actorFor("reva")), via: "INVITE" as const };
    await expectRule(pw.changePassword({ ...reva, via: "TEAM" }, null, GOOD, "Новый пароль для всех", "Новый пароль для всех"), /личном входе/);
    await expectRule(pw.changePassword(reva, session.id, "неверный текущий", "Новый пароль для всех", "Новый пароль для всех"), /Текущий пароль неверный/);
    await pw.changePassword(reva, session.id, GOOD, "Новый пароль для всех", "Новый пароль для всех", later(2000));
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: other.sessionId } })).revokedBy).toBe("password");
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).toBeNull();
    expect((await pw.loginWithPassword("reva", "Новый пароль для всех", device, later(3000))).ok).toBe(true);
  });

  it("ссылки всем без пароля: только тем, у кого его нет, кроме наблюдателей и самого владельца", async () => {
    await withPassword("reva");
    const links = await pw.issueInvitesForAll(await owner(), later(1000));
    const slugs = links.map((l) => l.slug);
    expect(slugs).not.toContain("reva");
    expect(slugs).not.toContain("muradyan");
    expect(slugs).not.toContain("ceo");
    expect(slugs).toContain("loginova");
    expect(links.every((l) => l.login === l.slug)).toBe(true);
    // Каждая ссылка рабочая и задаёт пароль своему человеку
    const lg = links.find((l) => l.slug === "loginova")!;
    const r = await pw.setPasswordByLink(lg.token, "Зимний вечер у камина", "Зимний вечер у камина", device, later(2000));
    expect(r.person.slug).toBe("loginova");
    const stats = await pw.passwordStats();
    expect(stats.withPassword).toBe(2);
    await expectRule(pw.issueInvitesForAll({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "INVITE" }), /только владелец/);
  });
});
