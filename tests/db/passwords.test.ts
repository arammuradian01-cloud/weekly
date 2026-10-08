// Личные логины и пароли (этап 20а): пароль по ссылке, вход по логину или почте, подбор, сброс, смена, ссылки всем.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as login from "@/lib/login/service";
import * as pw from "@/lib/login/password";
import { BUSY_ERROR, markAttemptOk, queuedKeys, reserveIpAttempt } from "@/lib/login/attempts";

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
    // Журнал общий для всех файлов тестов: считаем только новые записи
    const before = await prisma.auditLog.count({ where: { action: "auth.password.reset", entityId: "reva" } });
    await expectRule(pw.resetPassword({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "INVITE" }, "reva"), /только владелец/);
    await pw.resetPassword(await owner(), "reva", later(1000));
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).passwordHash).toBeNull();
    expect((await pw.loginWithPassword("reva", GOOD, device, later(2000))).ok).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "auth.password.reset", entityId: "reva" } })).toBe(before + 1);
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
    const stats = await pw.passwordStats((await owner()).personId);
    expect(stats.withPassword).toBe(2);
    await expectRule(pw.issueInvitesForAll({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "INVITE" }), /только владелец/);
  });
});

describe("после проверки кода", () => {
  it("пачка параллельных неверных попыток не обходит порог: к паролю доходят только 5", async () => {
    await withPassword("reva");
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => pw.loginWithPassword("reva", `неверный пароль ${i}`, { ...device, ip: `10.0.3.${i}` }, later(1000))),
    );
    const generic = results.filter((r) => !r.ok && r.error === "Неверный логин или пароль");
    const locked = results.filter((r) => !r.ok && /к этому логину/.test(r.error));
    expect(generic).toHaveLength(5);
    expect(locked).toHaveLength(15);
    expect((await pw.loginWithPassword("reva", GOOD, device, later(2000))).ok).toBe(false);
  });

  it("этап 29: пачка больше числа соединений базы не падает с общей ошибкой, каждый получает понятный ответ", async () => {
    await withPassword("reva");
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        pw.loginWithPassword(i % 2 ? "reva" : `ghost${i}`, `неверный пароль ${i}`, { ...device, ip: `10.0.7.${i % 4}` }, later(1000)),
      ),
    );
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results.filter((r) => !r.ok && r.error === BUSY_ERROR)).toHaveLength(0);
    // К паролю Ревы доходят только 5 попыток, остальные 15 упираются в блокировку логина
    const revaLocked = results.filter((r, i) => i % 2 === 1 && !r.ok && /к этому логину/.test(r.error));
    expect(revaLocked).toHaveLength(15);
    expect(await prisma.loginAttempt.count({ where: { kind: "PERSONAL" } })).toBe(40);
    expect(queuedKeys()).toBe(0);
  });

  it("этап 29: общий вход и режим управления тоже пишут попытку до сверки: пачка с одного адреса не обходит порог", async () => {
    for (const kind of ["TEAM", "MANAGEMENT"] as const) {
      const ip = `10.0.8.${kind === "TEAM" ? 1 : 2}`;
      const reserved = await Promise.all(Array.from({ length: 20 }, () => reserveIpAttempt(ip, kind, later(1000))));
      expect(reserved.filter((r) => r.ok)).toHaveLength(5);
      expect(reserved.filter((r) => !r.ok)).toHaveLength(15);
      // Оставшиеся попытки считаются по очереди: 5, 4, 3, 2, 1
      expect(reserved.flatMap((r) => (r.ok ? [r.remaining] : [])).sort().reverse()).toEqual([5, 4, 3, 2, 1]);
      const after = await reserveIpAttempt(ip, kind, later(2000));
      expect(after.ok).toBe(false);
    }
    // Верный пароль отмечает попытку успешной, счёт адреса обнуляется
    const ok = await reserveIpAttempt("10.0.8.9", "TEAM", later(1000));
    if (!ok.ok) throw new Error("первая попытка не должна закрываться");
    await markAttemptOk(prisma, ok.attemptId);
    for (let i = 0; i < 4; i++) await reserveIpAttempt("10.0.8.9", "TEAM", later(2000 + i));
    const fifth = await reserveIpAttempt("10.0.8.9", "TEAM", later(3000));
    expect(fifth.ok && fifth.remaining).toBe(1);
  });

  it("незнакомый логин закрывается так же, как настоящий: по блокировке не узнать, кто есть в ресурсе", async () => {
    for (let i = 0; i < 5; i++) await pw.loginWithPassword("nobody", `неверный ${i}`, { ...device, ip: `10.0.4.${i}` }, later(i * 1000));
    const r = await pw.loginWithPassword("nobody", "ещё попытка", device, later(6000));
    expect(!r.ok && r.error).toMatch(/к этому логину/);
    // Короткое имя и почта одного человека считаются вместе
    await withPassword("reva");
    await prisma.person.update({ where: { slug: "reva" }, data: { email: "reva@sravni.ru" } });
    for (let i = 0; i < 3; i++) await pw.loginWithPassword("reva", `неверный ${i}`, { ...device, ip: `10.0.5.${i}` }, later(10_000 + i));
    for (let i = 0; i < 2; i++) await pw.loginWithPassword("REVA@sravni.ru", `неверный ${i}`, { ...device, ip: `10.0.6.${i}` }, later(11_000 + i));
    const viaEmail = await pw.loginWithPassword("reva@sravni.ru", GOOD, device, later(12_000));
    expect(!viaEmail.ok && viaEmail.error).toMatch(/к этому логину/);
  });

  it("удачный вход одного человека не списывает чужие неверные попытки с того же адреса", async () => {
    await withPassword("reva");
    for (let i = 0; i < 29; i++) await pw.loginWithPassword(`ghost${i}`, "неверно-неверно", device, later(i * 100));
    expect((await pw.loginWithPassword("reva", GOOD, device, later(4000))).ok).toBe(true);
    await pw.loginWithPassword("ghost-last", "неверно-неверно", device, later(4100));
    const r = await pw.loginWithPassword("reva", GOOD, device, later(4200));
    expect(!r.ok && r.error).toMatch(/с этого адреса/);
  });

  it("пароль длиннее 72 байт не принимается: bcrypt молча отрезал бы хвост", async () => {
    const invite = await login.issueInvite(await owner(), "reva", t0);
    const long = "Длинная фраза про отпуск у моря и горы вдали";
    expect(Buffer.byteLength(long, "utf8")).toBeGreaterThan(72);
    await expectRule(pw.setPasswordByLink(invite.token, long, long, device, t0), /слишком длинный/);
    expect(pw.validatePersonalPassword("Short phrase about a long summer holiday!!", { slug: "reva", fullName: "Рева Тарас", email: null })).toBeNull();
  });

  it("две вкладки задают пароль по одной ссылке: одна входит, вторая узнаёт, что ссылка уже использована", async () => {
    const invite = await login.issueInvite(await owner(), "reva", t0);
    const results = await Promise.allSettled([
      pw.setPasswordByLink(invite.token, GOOD, GOOD, device, later(1000)),
      pw.setPasswordByLink(invite.token, "Осенний марафон 42", "Осенний марафон 42", device, later(1000)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/уже использована/);
  });

  it("после нового пароля прежние неиспользованные ссылки человека гаснут", async () => {
    const mail = login.newToken();
    await prisma.loginLink.create({
      data: { tokenHash: login.hashToken(mail), kind: "EMAIL", personId: (await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).id, expiresAt: later(15 * 60_000), createdAt: t0 },
    });
    await withPassword("reva", GOOD, later(1000));
    expect((await login.peekLink(mail, later(2000))).status).toBe("expired");
  });

  it("текущий пароль в профиле подбирается не быстрее входа: после 5 неверных форма закрыта", async () => {
    const { session } = await withPassword("reva");
    const reva = { ...(await tasks.actorFor("reva")), via: "INVITE" as const, ip: "10.0.7.1" };
    for (let i = 0; i < 5; i++) await expectRule(pw.changePassword(reva, session.id, `неверный ${i}`, "Новый пароль для всех", "Новый пароль для всех", later(i * 1000)), /Текущий пароль неверный/);
    await expectRule(pw.changePassword(reva, session.id, GOOD, "Новый пароль для всех", "Новый пароль для всех", later(6000)), /Слишком много неверных попыток/);
    // Тот же счётчик закрывает и вход по логину
    const r = await pw.loginWithPassword("reva", GOOD, device, later(7000));
    expect(!r.ok && r.error).toMatch(/к этому логину/);
  });

  it("владелец не сбрасывает свой пароль из списка людей; счётчик ссылок не считает владельца", async () => {
    const me = await owner();
    await expectRule(pw.resetPassword(me, "muradyan"), /Свой пароль меняйте в профиле/);
    const stats = await pw.passwordStats(me.personId);
    expect(stats.invitable).toBe(stats.total - stats.withPassword - 1);
    expect((await pw.issueInvitesForAll(me, later(1000))).length).toBe(stats.invitable);
  });

  it("ссылкой от владельца без пароля не войти: сначала пароль, ссылка при этом не тратится", async () => {
    const invite = await login.issueInvite(await owner(), "reva", t0);
    await expectRule(login.consumeLoginLink(invite.token, device, later(1000), null, ["EMAIL"]), /сначала задают пароль/);
    expect((await login.peekLink(invite.token, later(2000))).status).toBe("ok");
  });
});
