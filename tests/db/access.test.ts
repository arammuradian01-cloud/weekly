// Доступы для всей компании (этап 52): логины вида amuradyan, рабочая почта с подтверждением, главный владелец,
// срок ссылок пачкой, ссылки подтверждения не годятся для входа.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as login from "@/lib/login/service";
import * as pw from "@/lib/login/password";
import * as email from "@/lib/login/email";
import * as admin from "@/lib/admin/service";
import * as org from "@/lib/org/service";
import { fillMissingLoginsAll } from "@/lib/login/logins";
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

/** Зоны, которые тесты правят: после файла они возвращаются, их сверяют тесты журнала в других файлах */
const ZONES: Record<string, string> = {};

async function reset() {
  if (!Object.keys(ZONES).length) for (const p of await prisma.person.findMany({ where: { slug: { in: ["reva", "golovkin"] } } })) ZONES[p.slug] = p.zone;
  for (const [slug, zone] of Object.entries(ZONES)) await prisma.person.update({ where: { slug }, data: { zone } });
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
    expect(await fillMissingLoginsAll(prisma)).toBe(0);
    const people = await prisma.person.findMany({ select: { id: true, slug: true, login: true } });
    for (const p of people) expect(people.some((o) => o.id !== p.id && o.slug === p.login)).toBe(false);
  });
});

describe("рабочая почта", () => {
  it("человек указывает почту, она начинает работать только после ссылки из письма", async () => {
    const reva = await personal("reva");
    await email.requestEmailBinding(reva, "T.Reva@sravni.ru", "", "https://weekly.test", t0);
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
    await expectRule(email.requestEmailBinding(reva, "reva@gmail.com", "", "https://weekly.test", t0), /рабочая почта/);
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: "golovkin@sravni.ru" } });
    await expectRule(email.requestEmailBinding(reva, "golovkin@sravni.ru", "", "https://weekly.test", t0), /уже привязан/);
    await expectRule(email.requestEmailBinding({ ...reva, via: "TEAM" }, "t.reva@sravni.ru", "", "https://weekly.test", t0), /личном входе/);
    // Поддомен по умолчанию не подходит: им может управлять подрядчик
    await expectRule(email.requestEmailBinding(reva, "t.reva@mail.sravni.ru", "", "https://weekly.test", t0), /рабочая почта/);
    await email.requestEmailBinding(reva, "t.reva@sravni.ru", "", "https://weekly.test", t0);
    const token = tokenFrom(sent.at(-1)!);
    expect(await email.confirmEmail(token, null, later(email.EMAIL_CONFIRM_TTL_MS + 1000))).toMatchObject({ ok: false });
    // Домены задаются настройкой
    await prisma.setting.create({ data: { key: email.EMAIL_DOMAINS_KEY, value: ["sravni.ru", "sravni.tech"] } });
    await email.requestEmailBinding(reva, "t.reva@sravni.tech", "", "https://weekly.test", t0);
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).pendingEmail).toBe("t.reva@sravni.tech");
  });

  it("адрес успели занять до подтверждения, человек передумал, почта не настроена", async () => {
    const reva = await personal("reva");
    await email.requestEmailBinding(reva, "t.reva@sravni.ru", "", "https://weekly.test", t0);
    const token = tokenFrom(sent.at(-1)!);
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: "t.reva@sravni.ru" } });
    expect(await email.confirmEmail(token, null, later(1000))).toMatchObject({ ok: false, error: expect.stringMatching(/другому человеку/) });
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: null } });
    await email.requestEmailBinding(reva, "t.reva@sravni.ru", "", "https://weekly.test", later(2000));
    const second = tokenFrom(sent.at(-1)!);
    await email.cancelEmailBinding(reva, later(3000));
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).pendingEmail).toBeNull();
    expect(await email.confirmEmail(second, null, later(4000))).toMatchObject({ ok: false });
    setMailTransport(null);
    const app = process.env.APP_URL;
    delete process.env.APP_URL;
    try {
      await expectRule(email.requestEmailBinding(reva, "t.reva@sravni.ru", "", "https://weekly.test", later(5000)), /не настроена/);
    } finally {
      if (app !== undefined) process.env.APP_URL = app;
    }
  });

  it("не больше пяти писем подтверждения в сутки", async () => {
    const reva = await personal("reva");
    for (let i = 0; i < email.EMAIL_CONFIRMS_PER_DAY; i++) await email.requestEmailBinding(reva, `t.reva${i}@sravni.ru`, "", "https://weekly.test", later(i * 1000));
    await expectRule(email.requestEmailBinding(reva, "t.reva9@sravni.ru", "", "https://weekly.test", later(10_000)), /Слишком много/);
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
    // [Codex] Совладелец управляет главным на равных, включая доступ и назначение главного.
    await admin.setPersonActive(await owner(), "golovkin", false);
    await admin.setPersonActive(await owner(), "golovkin", true);
    await admin.setPrimaryOwner(await owner(), "muradyan");
    await admin.setPrimaryOwner(await owner(), "golovkin");
    await admin.updatePerson(await owner(), "golovkin", { zone: "Департамент" });
    // После снятия роли настройка главного снимается с записью в журнал.
    await admin.updatePerson(await owner(), "golovkin", { role: "ADMIN" });
    expect(await prisma.setting.findUnique({ where: { key: admin.PRIMARY_OWNER_KEY } })).toBeNull();
    expect(await admin.primaryOwnerSlug()).toBe("muradyan");
    // Снова владелец: молча главным он не возвращается
    await admin.updatePerson(await owner(), "golovkin", { role: "OWNER" });
    expect(await admin.primaryOwnerSlug()).toBe("muradyan");
    await admin.updatePerson(await owner(), "golovkin", { role: "ADMIN" });
    expect(await prisma.auditLog.count({ where: { field: "Главный владелец" } })).toBeGreaterThan(1);
  });
  it("совладелец восстанавливает доступ главному без почты, старые пароль и устройства перестают работать", async () => {
    await admin.updatePerson(await owner(), "golovkin", { role: "OWNER" });
    const co = { ...(await tasks.actorFor("golovkin", "OWNER")), via: "PASSWORD" as const };
    const first = await login.issueInvite(co, "muradyan", t0);
    const { session, person } = await pw.setPasswordByLink(first.token, GOOD, GOOD, device, t0);
    const unused = await login.issueInvite(co, "muradyan", later(1000));
    await pw.resetPassword(co, "muradyan", later(2000));
    expect((await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).passwordHash).toBeNull();
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    await expect(pw.setPasswordByLink(unused.token, GOOD, GOOD, device, later(3000))).rejects.toBeInstanceOf(tasks.TaskRuleError);
    const replacement = await login.issueInvite(co, "muradyan", later(4000));
    const next = await pw.setPasswordByLink(replacement.token, GOOD, GOOD, device, later(5000));
    expect(next.person.slug).toBe("muradyan");
    await login.revokeAllDevices(co, "muradyan", later(6000));
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: next.session.id } })).revokedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "auth.password.reset", entityId: "muradyan", actorId: co.personId } })).toBeGreaterThan(0);
    await expectRule(pw.resetPassword(co, "golovkin"), /Свой пароль/);
    await expectRule(pw.resetPassword({ ...co, management: null }, "muradyan"), /только владелец/);
    await expectRule(login.issueInvite({ ...co, management: "ADMIN" }, "muradyan"), /только владелец/);
  });

  it("одновременное выключение и понижение владельцев оставляет хотя бы одного включённого владельца", async () => {
    await admin.updatePerson(await owner(), "golovkin", { role: "OWNER" });
    const a = await owner();
    const b = { ...(await tasks.actorFor("golovkin", "OWNER")), via: "INVITE" as const };
    try {
      const outcomes = await Promise.allSettled([
        admin.setPersonActive(a, "golovkin", false),
        admin.updatePerson(b, "muradyan", { role: "LEADER" }),
      ]);
      expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(tasks.TaskRuleError);
      expect(rejected.reason.message).toMatch(/хотя бы один включённый владелец/);
      expect(await prisma.person.count({ where: { role: "OWNER", active: true } })).toBe(1);
    } finally {
      await prisma.person.update({ where: { slug: "muradyan" }, data: { role: "OWNER", active: true } });
      await prisma.person.update({ where: { slug: "golovkin" }, data: { role: "ADMIN", active: true } });
    }
  });
});

describe("после проверки кода этапа 52", () => {
  it("смена пароля, сброс, «выйти везде» и выключение снимают неподтверждённую почту и ссылку на неё", async () => {
    const steps: [string, () => Promise<unknown>][] = [
      ["смена пароля в профиле", async () => {
        const invite = await login.issueInvite(await owner(), "reva", t0);
        const { session } = await pw.setPasswordByLink(invite.token, GOOD, GOOD, device, t0);
        await email.requestEmailBinding(await personal("reva"), "t.reva@sravni.ru", GOOD, "https://weekly.test", later(1000));
        await pw.changePassword({ ...(await personal("reva")), via: "PASSWORD" }, session.id, GOOD, "Новый пароль для всех", "Новый пароль для всех", later(2000));
      }],
      ["пароль по ссылке", async () => {
        await email.requestEmailBinding(await personal("reva"), "t.reva@sravni.ru", "", "https://weekly.test", later(1000));
        const invite = await login.issueInvite(await owner(), "reva", later(1500));
        await pw.setPasswordByLink(invite.token, GOOD, GOOD, device, later(2000));
      }],
      ["сброс владельцем", async () => {
        await email.requestEmailBinding(await personal("reva"), "t.reva@sravni.ru", "", "https://weekly.test", later(1000));
        await pw.resetPassword(await owner(), "reva", later(2000));
      }],
      ["выйти везде", async () => {
        await email.requestEmailBinding(await personal("reva"), "t.reva@sravni.ru", "", "https://weekly.test", later(1000));
        await login.revokeAllDevices(await owner(), "reva", later(2000));
      }],
      ["выключение", async () => {
        await email.requestEmailBinding(await personal("reva"), "t.reva@sravni.ru", "", "https://weekly.test", later(1000));
        await admin.setPersonActive(await owner(), "reva", false);
        await admin.setPersonActive(await owner(), "reva", true);
      }],
    ];
    for (const [name, step] of steps) {
      await reset();
      sent = [];
      await step();
      const token = tokenFrom(sent.find((m) => m.subject.startsWith("Подтвердите"))!);
      expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).pendingEmail, name).toBeNull();
      expect((await email.confirmEmail(token, null, later(3000))).ok, name).toBe(false);
    }
  });

  it("сменить почту можно только с текущим паролем; владелец и администратор только в режиме управления", async () => {
    const invite = await login.issueInvite(await owner(), "reva", t0);
    await pw.setPasswordByLink(invite.token, GOOD, GOOD, device, t0);
    const reva = await personal("reva");
    await expectRule(email.requestEmailBinding(reva, "t.reva@sravni.ru", "", "https://weekly.test", later(1000)), /Текущий пароль неверный/);
    await expectRule(email.requestEmailBinding(reva, "t.reva@sravni.ru", "не тот", "https://weekly.test", later(1000)), /Текущий пароль неверный/);
    await email.requestEmailBinding(reva, "t.reva@sravni.ru", GOOD, "https://weekly.test", later(2000));
    const admin1 = { ...(await tasks.actorFor("golovkin")), via: "PASSWORD" as const };
    await expectRule(email.requestEmailBinding(admin1, "golovkin@sravni.ru", "", "https://weekly.test", later(3000)), /режиме управления/);
    await email.requestEmailBinding({ ...admin1, management: "ADMIN" }, "golovkin@sravni.ru", "", "https://weekly.test", later(3000));
    await expectRule(email.requestEmailBinding({ ...(await personal("muradyan")) }, "a.muradyan@sravni.ru", "", "https://weekly.test", later(4000)), /режиме управления/);
  });

  it("подтверждается адрес из письма; прежний адрес узнаёт о смене", async () => {
    await prisma.person.update({ where: { slug: "reva" }, data: { email: "old.reva@sravni.ru" } });
    await email.requestEmailBinding(await personal("reva"), "t.reva@sravni.ru", "", "https://weekly.test", t0);
    const token = tokenFrom(sent.at(-1)!);
    expect((await login.peekLink(token, later(1000))).target).toBe("t***a@sravni.ru");
    expect(await email.confirmEmail(token, null, later(2000))).toMatchObject({ ok: true, email: "t.reva@sravni.ru" });
    const notice = sent.find((m) => m.to === "old.reva@sravni.ru");
    expect(notice?.subject).toMatch(/изменена/);
    expect(notice?.text).not.toContain("t.reva@sravni.ru");
  });

  it("владелец вписал почту, пока человек ждал подтверждения: старое письмо адрес не возвращает", async () => {
    await email.requestEmailBinding(await personal("reva"), "t.reva@sravni.ru", "", "https://weekly.test", t0);
    const token = tokenFrom(sent.at(-1)!);
    await admin.updatePerson(await owner(), "reva", { email: "reva@sravni.ru" });
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).pendingEmail).toBeNull();
    expect((await email.confirmEmail(token, null, later(1000))).ok).toBe(false);
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).email).toBe("reva@sravni.ru");
  });

  it("параллельные запросы не обходят лимит писем; занятый адрес тоже считается", async () => {
    const reva = await personal("reva");
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => email.requestEmailBinding(reva, `t.reva${i}@sravni.ru`, "", "https://weekly.test", later(1000))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(email.EMAIL_CONFIRMS_PER_DAY);
    expect(sent).toHaveLength(email.EMAIL_CONFIRMS_PER_DAY);
    await reset();
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: "golovkin@sravni.ru" } });
    for (let i = 0; i < email.EMAIL_CONFIRMS_PER_DAY; i++) await expectRule(email.requestEmailBinding(reva, "golovkin@sravni.ru", "", "https://weekly.test", later(i)), /уже привязан/);
    await expectRule(email.requestEmailBinding(reva, "golovkin@sravni.ru", "", "https://weekly.test", later(10)), /Слишком много/);
  });

  it("два человека подтверждают один адрес одновременно: один успевает, второй получает понятный ответ", async () => {
    await email.requestEmailBinding(await personal("reva"), "same@sravni.ru", "", "https://weekly.test", t0);
    await email.requestEmailBinding(await personal("loginova"), "same@sravni.ru", "", "https://weekly.test", t0);
    const [a, b] = sent.map(tokenFrom);
    const results = await Promise.all([email.confirmEmail(a!, null, later(1000)), email.confirmEmail(b!, null, later(1000))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: expect.stringMatching(/другому человеку/) });
  });

  it("неподтверждённую почту по общему логину не отменить; отмена пишется в журнал", async () => {
    const reva = await personal("reva");
    await email.requestEmailBinding(reva, "t.reva@sravni.ru", "", "https://weekly.test", t0);
    await expectRule(email.cancelEmailBinding({ ...reva, via: "TEAM" }), /личном входе/);
    await email.cancelEmailBinding(reva, later(1000));
    expect(await prisma.auditLog.count({ where: { action: "auth.email.cancel", entityId: "reva" } })).toBeGreaterThan(0);
  });

  it("короткое имя нового человека не совпадает с чужим логином; правка без смены логина проходит", async () => {
    const dir = (await prisma.dictionaryItem.findFirstOrThrow({ where: { kind: "DIRECTION" } })).code;
    const a = await admin.createPerson(await owner(), { fullName: "Трева Иван", role: "LEADER", zone: "Тест", direction: dir });
    try {
      expect(a.slug).not.toBe("treva");
      expect(await prisma.person.count({ where: { OR: [{ slug: "treva" }, { login: "treva" }] } })).toBe(1);
      const created = await prisma.person.findUniqueOrThrow({ where: { slug: a.slug } });
      // Форма присылает логин всегда: правка зоны не упирается в проверку логина
      await admin.updatePerson(await owner(), a.slug, { zone: "Другая зона", login: created.login! });
      // Логины, занятые ресурсом
      await expectRule(admin.updatePerson(await owner(), a.slug, { login: "team" }), /занят ресурсом/);
    } finally {
      await prisma.person.delete({ where: { slug: a.slug } });
    }
  });

  it("совладелец меняет почту главного владельца через загрузку структуры", async () => {
    await admin.updatePerson(await owner(), "golovkin", { role: "OWNER" });
    await admin.setPrimaryOwner(await owner(), "golovkin");
    await prisma.person.update({ where: { slug: "golovkin" }, data: { email: "golovkin@sravni.ru" } });
    try {
      await org.applyStructure(await owner(), [["ФИО", "Должность", "Почта"], ["Головкин Владислав", "Директор", "new.golovkin@sravni.ru"]].map((r) => r.join(";")).join("\n"));
      expect((await prisma.person.findUniqueOrThrow({ where: { slug: "golovkin" } })).email).toBe("new.golovkin@sravni.ru");
    } finally {
      const golovkin = { ...(await tasks.actorFor("golovkin", "OWNER")), via: "INVITE" as const };
      await admin.updatePerson(golovkin, "golovkin", { role: "ADMIN" });
      await prisma.person.updateMany({ data: { unitId: null, managerId: null, position: null } });
      await prisma.team.deleteMany({ where: { id: { not: "top" } } });
      for (let i = 0; i < 10 && (await prisma.orgUnit.count()); i++) await prisma.orgUnit.deleteMany({ where: { children: { none: {} } } });
    }
  });

  it("два человека с одной фамилией добавляются одновременно: короткие имена разные, общей ошибки нет", async () => {
    const dir = (await prisma.dictionaryItem.findFirstOrThrow({ where: { kind: "DIRECTION" } })).code;
    const made = await Promise.all([
      admin.createPerson(await owner(), { fullName: "Зайцев Пётр", role: "LEADER", zone: "Тест", direction: dir }),
      admin.createPerson(await owner(), { fullName: "Зайцев Олег", role: "LEADER", zone: "Тест", direction: dir }),
    ]);
    try {
      expect(new Set(made.map((m) => m.slug)).size).toBe(2);
    } finally {
      await prisma.person.deleteMany({ where: { slug: { in: made.map((m) => m.slug) } } });
    }
  });

  it("ссылки пачкой не выдаются владельцам и администраторам", async () => {
    const links = await pw.issueInvitesForAll(await owner(), t0);
    expect(links.map((l) => l.slug)).not.toContain("golovkin");
    expect(links.map((l) => l.slug)).not.toContain("muradyan");
    expect((await pw.passwordStats((await owner()).personId)).invitable).toBe(links.length);
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
