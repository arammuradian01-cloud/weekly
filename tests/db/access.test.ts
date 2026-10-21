// Доступы для всей компании (этап 52): логины вида amuradyan, рабочая почта с подтверждением, главный владелец,
// срок ссылок пачкой, ссылки подтверждения не годятся для входа.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as login from "@/lib/login/service";
import * as pw from "@/lib/login/password";
import * as email from "@/lib/login/email";
import * as admin from "@/lib/admin/service";
import { fillMissingLogins } from "@/lib/login/logins";
import { setMailTransport, type Mail } from "@/lib/mail";

const device = { ip: "10.0.0.9", userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1" };
const t0 = new Date("2026-10-21T09:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const GOOD = "Летний отпуск 2026!";
const owner = async () => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "INVITE" as const });
const personal = async (slug: string) => ({ ...(await tasks.actorFor(slug)), via: "PASSWORD" as const, ip: "10.0.0.9" });
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
let sent: Mail[] = [];
const tokenFrom = (mail: Mail) => decodeURIComponent(/[?&]t=([^\s&]+)/.exec(mail.text)![1]!);

async function reset() {
  await prisma.deviceSession.deleteMany();
  await prisma.loginLink.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.person.updateMany({ data: { email: null, pendingEmail: null, passwordHash: null, passwordSetAt: null, active: true } });
  await prisma.person.updateMany({ where: { slug: { in: ["analyst", "ceo"] } }, data: { active: false } });
  await prisma.setting.deleteMany({ where: { key: { in: [admin.PRIMARY_OWNER_KEY, email.EMAIL_DOMAINS_KEY] } } });
  await prisma.person.updateMany({ where: { slug: "golovkin" }, data: { role: "ADMIN" } });
}

beforeEach(async () => {
  await reset();
  sent = [];
  setMailTransport(async (mail) => {
    sent.push(mail);
  });
});
afterEach(() => setMailTransport(null));
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("логины вида amuradyan", () => {
  it("у всех есть логин; вход по логину, по прежнему короткому имени и по почте", async () => {
    expect(await prisma.person.count({ where: { login: null } })).toBe(0);
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    expect(reva.login).toBe("treva");
    const invite = await login.issueInvite(await owner(), "reva", t0);
    await pw.setPasswordByLink(invite.token, GOOD, GOOD, device, t0);
    expect((await pw.loginWithPassword("treva", GOOD, device, later(1000))).ok).toBe(true);
    expect((await pw.loginWithPassword("TREVA", GOOD, device, later(2000))).ok).toBe(true);
    expect((await pw.loginWithPassword("reva", GOOD, device, later(3000))).ok).toBe(true);
  });

  it("новый человек сразу получает логин, совпадение решается номером, владелец может поменять логин", async () => {
    const a = await admin.createPerson(await owner(), { fullName: "Рева Тимофей", role: "LEADER", zone: "Тест", direction: (await prisma.dictionaryItem.findFirstOrThrow({ where: { kind: "DIRECTION" } })).code });
    const created = await prisma.person.findUniqueOrThrow({ where: { slug: a.slug } });
    expect(created.login).toBe("treva2");
    await expectRule(admin.updatePerson(await owner(), a.slug, { login: "treva" }), /уже занят/);
    // Чужое короткое имя тоже занято: иначе вход по нему стал бы неоднозначным
    await expectRule(admin.updatePerson(await owner(), a.slug, { login: "golovkin" }), /уже занят/);
    await expectRule(admin.updatePerson(await owner(), a.slug, { login: "Т-рева" }), /латинские буквы/);
    await admin.updatePerson(await owner(), a.slug, { login: "timofey.reva" });
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: a.slug } })).login).toBe("timofey.reva");
    await prisma.person.delete({ where: { slug: a.slug } });
  });

  it("повторное заполнение ничего не меняет, а логин не совпадает с чужим коротким именем", async () => {
    expect(await fillMissingLogins(prisma)).toBe(0);
    const people = await prisma.person.findMany({ select: { id: true, slug: true, login: true } });
    for (const p of people) expect(people.some((o) => o.id !== p.id && o.slug === p.login)).toBe(false);
  });
});

describe("рабочая почта", () => {
  it("человек указывает почту, она начинает работать только после ссылки из письма", async () => {
    const reva = await personal("reva");
    await email.requestEmailBinding(reva, "T.Reva@sravni.ru", "https://weekly.test", t0);
    const p1 = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    expect(p1.email).toBeNull();
    expect(p1.pendingEmail).toBe("t.reva@sravni.ru");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("t.reva@sravni.ru");
    expect(sent[0]!.text).toContain("https://weekly.test/login/confirm-email?t=");
    // Неподтверждённая почта для входа по ссылке не годится: письмо не уходит, ответ одинаковый
    expect(await login.requestEmailLink("t.reva@sravni.ru", { ip: "10.0.0.1", baseUrl: "https://weekly.test" }, later(1000))).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    const token = tokenFrom(sent[0]!);
    // Ссылка подтверждения не открывает экран входа и не задаёт пароль
    expect((await login.peekLink(token, later(2000))).kind).toBe("EMAIL_CONFIRM");
    await expect(pw.setPasswordByLink(token, GOOD, GOOD, device, later(2000))).rejects.toThrow(/не найдена/);
    await expect(login.consumeLoginLink(token, device, later(2000))).rejects.toBeInstanceOf(tasks.TaskRuleError);
    const done = await email.confirmEmail(token, "10.0.0.2", later(3000));
    expect(done).toEqual({ ok: true, fullName: "Рева Тарас", email: "t.reva@sravni.ru" });
    const p2 = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    expect(p2.email).toBe("t.reva@sravni.ru");
    expect(p2.pendingEmail).toBeNull();
    expect(await email.confirmEmail(token, "10.0.0.2", later(4000))).toMatchObject({ ok: false });
    // Теперь по почте приходит ссылка для входа
    await login.requestEmailLink("t.reva@sravni.ru", { ip: "10.0.0.1", baseUrl: "https://weekly.test" }, later(5000));
    expect(sent).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: "auth.email.confirm", entityId: "reva" } })).toBeGreaterThan(0);
  });

  it("только рабочий домен, чужой привязанный адрес нельзя, по общему логину нельзя, ссылка живёт сутки", async () => {
    const reva = await personal("reva");
    await expectRule(email.requestEmailBinding(reva, "reva@gmail.com", "https://weekly.test", t0), /рабочая почта/);
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: "golovkin@sravni.ru" } });
    await expectRule(email.requestEmailBinding(reva, "golovkin@sravni.ru", "https://weekly.test", t0), /уже привязан/);
    await expectRule(email.requestEmailBinding({ ...reva, via: "TEAM" }, "t.reva@sravni.ru", "https://weekly.test", t0), /личном входе/);
    // Поддомен рабочего домена подходит
    await email.requestEmailBinding(reva, "t.reva@mail.sravni.ru", "https://weekly.test", t0);
    const token = tokenFrom(sent.at(-1)!);
    expect(await email.confirmEmail(token, null, later(email.EMAIL_CONFIRM_TTL_MS + 1000))).toMatchObject({ ok: false });
    // Домены задаются настройкой
    await prisma.setting.create({ data: { key: email.EMAIL_DOMAINS_KEY, value: ["sravni.ru", "sravni.tech"] } });
    await email.requestEmailBinding(reva, "t.reva@sravni.tech", "https://weekly.test", t0);
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).pendingEmail).toBe("t.reva@sravni.tech");
  });

  it("адрес успели занять до подтверждения, человек передумал, почта не настроена", async () => {
    const reva = await personal("reva");
    await email.requestEmailBinding(reva, "t.reva@sravni.ru", "https://weekly.test", t0);
    const token = tokenFrom(sent.at(-1)!);
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: "t.reva@sravni.ru" } });
    expect(await email.confirmEmail(token, null, later(1000))).toMatchObject({ ok: false, error: expect.stringMatching(/другому человеку/) });
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: null } });
    await email.requestEmailBinding(reva, "t.reva@sravni.ru", "https://weekly.test", later(2000));
    const second = tokenFrom(sent.at(-1)!);
    await email.cancelEmailBinding(reva, later(3000));
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).pendingEmail).toBeNull();
    expect(await email.confirmEmail(second, null, later(4000))).toMatchObject({ ok: false });
    setMailTransport(null);
    const app = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      await expectRule(email.requestEmailBinding(reva, "t.reva@sravni.ru", "https://weekly.test", later(5000)), /не настроена/);
    } finally {
      if (app !== undefined) process.env.APP_URL = app;
    }
  });

  it("не больше пяти писем подтверждения в сутки", async () => {
    const reva = await personal("reva");
    for (let i = 0; i < email.EMAIL_CONFIRMS_PER_DAY; i++) await email.requestEmailBinding(reva, `t.reva${i}@sravni.ru`, "https://weekly.test", later(i * 1000));
    await expectRule(email.requestEmailBinding(reva, "t.reva9@sravni.ru", "https://weekly.test", later(10_000)), /Слишком много/);
  });
});

describe("главный владелец и совладельцы", () => {
  it("главным становится только владелец, подпись остальных владельцев: совладелец", async () => {
    expect(await admin.primaryOwnerSlug()).toBe("muradyan");
    await expectRule(admin.setPrimaryOwner(await owner(), "golovkin"), /только владельца/);
    await admin.updatePerson(await owner(), "golovkin", { role: "OWNER" });
    await admin.setPrimaryOwner(await owner(), "golovkin");
    expect(await admin.primaryOwnerSlug()).toBe("golovkin");
    const list = await admin.listPeople();
    expect(list.find((p) => p.slug === "golovkin")?.primaryOwner).toBe(true);
    expect(list.find((p) => p.slug === "muradyan")?.primaryOwner).toBe(false);
    // Совладелец сохраняет права владельца: управляет людьми
    await admin.updatePerson(await owner(), "reva", { zone: "Продукт" });
    await expectRule(admin.setPrimaryOwner({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "INVITE" as const }, "muradyan"), /владелец/);
    // Главный владелец выключен или понижен: главным считается первый владелец списка
    await admin.updatePerson(await owner(), "golovkin", { role: "ADMIN" });
    expect(await admin.primaryOwnerSlug()).toBe("muradyan");
    expect(await prisma.auditLog.count({ where: { field: "Главный владелец" } })).toBeGreaterThan(0);
  });
});

describe("ссылки пачкой", () => {
  it("срок 3, 7 или 14 дней, в ссылке должность для выгрузки", async () => {
    await prisma.person.update({ where: { slug: "loginova" }, data: { position: "Лидер RED" } });
    const links = await pw.issueInvitesForAll(await owner(), t0, 14);
    expect(links[0]!.expiresAt.getTime() - t0.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    expect(links.find((l) => l.slug === "loginova")?.position).toBe("Лидер RED");
    await expectRule(pw.issueInvitesForAll(await owner(), t0, 30), /3, 7 или 14/);
    const view = await admin.listPeople();
    expect(view.find((p) => p.slug === "loginova")?.inviteUntil).toBe(links[0]!.expiresAt.toISOString());
    await prisma.person.update({ where: { slug: "loginova" }, data: { position: null } });
  });
});
