// Личные входы на настоящей базе (этап 9): ссылки, устройства, «выйти везде», общий логин, почта, журнал со способом входа.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as admin from "@/lib/admin/service";
import * as login from "@/lib/login/service";
import { setMailTransport, type Mail } from "@/lib/mail";

const owner = async () => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "INVITE" as const });
const device = { ip: "10.0.0.1", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36" };
const t0 = new Date("2026-10-06T09:00:00Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const base = "https://weekly.example.ru";

let sent: Mail[] = [];

beforeEach(async () => {
  await prisma.deviceSession.deleteMany();
  await prisma.loginLink.deleteMany();
  await prisma.loginAttempt.deleteMany({ where: { kind: "LINK" } });
  await prisma.person.updateMany({ data: { email: null, active: true } });
  await prisma.setting.upsert({ where: { key: "auth.teamLogin" }, update: { value: "on" }, create: { key: "auth.teamLogin", value: "on" } });
  sent = [];
  setMailTransport(async (mail) => {
    sent.push(mail);
  });
});
afterEach(() => setMailTransport(null));
afterAll(() => prisma.$disconnect());

const tokenFrom = (mail: Mail) => new URL(mail.text.split("\n").find((l) => l.startsWith("http"))!).searchParams.get("t")!;

describe("ссылка от владельца", () => {
  it("выдаёт только владелец, ссылка одна на человека и открывает вход один раз", async () => {
    const reva = await tasks.actorFor("reva");
    const adminActor = await tasks.actorFor("golovkin", "ADMIN");
    await expect(login.issueInvite(reva, "reva", t0)).rejects.toThrow(/только владелец/);
    await expect(login.issueInvite(adminActor, "reva", t0)).rejects.toThrow(/только владелец/);

    const first = await login.issueInvite(await owner(), "reva", t0);
    const second = await login.issueInvite(await owner(), "reva", later(1000));
    expect(first.fullName).toBe("Рева Тарас");
    // Новая ссылка гасит прежнюю
    expect((await login.peekLink(first.token, later(2000))).status).toBe("expired");
    expect(await login.peekLink(second.token, later(2000))).toEqual({ status: "ok", kind: "INVITE", fullName: "Рева Тарас" });

    // Открытие ничего не тратит, вход тратит
    const { session, person, method } = await login.consumeLoginLink(second.token, device, later(3000));
    expect([person.slug, method]).toEqual(["reva", "INVITE"]);
    expect(session.expiresAt.getTime() - later(3000).getTime()).toBe(login.DEVICE_TTL_MS);
    await expect(login.consumeLoginLink(second.token, device, later(4000))).rejects.toThrow(/уже использована/);

    // В журнале выдача без самой ссылки и вход со способом входа
    const issued = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.invite", entityId: "reva" }, orderBy: { id: "desc" } });
    expect(JSON.stringify({ ...issued, id: String(issued.id) })).not.toContain(second.token);
    expect(issued.via).toBe("INVITE");
    const entered = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.login" }, orderBy: { id: "desc" } });
    expect([entered.actorName, entered.via, entered.ip]).toEqual(["Рева Тарас", "INVITE", "10.0.0.1"]);
  });

  it("ссылка живёт 3 дня, выключенному человеку не выдаётся и не работает", async () => {
    const link = await login.issueInvite(await owner(), "loginova", t0);
    await expect(login.consumeLoginLink(link.token, device, later(login.INVITE_TTL_MS + 1000))).rejects.toThrow(/Срок ссылки истёк/);
    await expect(login.consumeLoginLink("нет-такой", device, t0)).rejects.toThrow(/не найдена/);

    const fresh = await login.issueInvite(await owner(), "loginova", later(login.INVITE_TTL_MS + 2000));
    await admin.setPersonActive(await owner(), "loginova", false);
    await expect(login.consumeLoginLink(fresh.token, device, later(login.INVITE_TTL_MS + 3000))).rejects.toThrow(/Срок ссылки истёк|выключен/);
    await expect(login.issueInvite(await owner(), "loginova", later(login.INVITE_TTL_MS + 4000))).rejects.toThrow(/выключен/);
  });

  it("две вкладки с одной ссылкой одновременно: входит только одна", async () => {
    const link = await login.issueInvite(await owner(), "fatyanov", t0);
    const results = await Promise.allSettled([login.consumeLoginLink(link.token, device, later(1000)), login.consumeLoginLink(link.token, device, later(1000))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.deviceSession.count()).toBe(1);
  });
});

describe("устройства", () => {
  it("список своих входов, выход на одном и «выйти везде»; владелец завершает чужие входы", async () => {
    const a = await login.issueInvite(await owner(), "reva", t0);
    const first = await login.consumeLoginLink(a.token, device, later(1000));
    const b = await login.issueInvite(await owner(), "reva", later(2000));
    const second = await login.consumeLoginLink(b.token, { ip: "10.0.0.2", userAgent: "iPhone Safari/604.1" }, later(3000));

    const reva = { ...(await tasks.actorFor("reva")), via: "INVITE" as const };
    expect((await login.listDevices(reva.personId, later(4000))).map((d) => d.id)).toEqual([second.session.id, first.session.id]);

    // Чужое устройство не завершить
    const fatyanov = await tasks.actorFor("fatyanov");
    await expect(login.revokeDevice(fatyanov, first.session.id, later(5000))).rejects.toThrow(/не найдено/);
    await login.revokeDevice(reva, first.session.id, later(5000));
    expect(await login.loadDevice(first.session.id, later(6000))).toBeNull();
    expect(await login.loadDevice(second.session.id, later(6000))).not.toBeNull();

    await expect(login.revokeAllDevices(fatyanov, "reva", later(7000))).rejects.toThrow(/только владелец/);
    expect(await login.revokeAllDevices(await owner(), "reva", later(7000))).toBe(1);
    expect(await login.loadDevice(second.session.id, later(8000))).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.device.revoke-all" }, orderBy: { id: "desc" } });
    expect([log.entityId, log.after]).toEqual(["reva", "завершено входов: 1"]);
  });

  it("«выйти везде» гасит и неиспользованные ссылки; выключение человека завершает его входы", async () => {
    const used = await login.issueInvite(await owner(), "reva", t0);
    const s = await login.consumeLoginLink(used.token, device, later(1000));
    const pending = await login.issueInvite(await owner(), "reva", later(2000));
    const reva = { ...(await tasks.actorFor("reva")), via: "INVITE" as const };
    await login.revokeAllDevices(reva, "reva", later(3000));
    expect((await login.peekLink(pending.token, later(4000))).status).toBe("expired");

    const again = await login.issueInvite(await owner(), "reva", later(5000));
    const s2 = await login.consumeLoginLink(again.token, device, later(6000));
    await admin.setPersonActive(await owner(), "reva", false);
    const row = await prisma.deviceSession.findUniqueOrThrow({ where: { id: s2.session.id } });
    expect(row.revokedBy).toBe("deactivate");
    expect(s.session.id).not.toBe(s2.session.id);
  });

  it("личный вход истекает через 30 дней", async () => {
    const link = await login.issueInvite(await owner(), "reva", t0);
    const { session } = await login.consumeLoginLink(link.token, device, t0);
    expect(await login.loadDevice(session.id, later(login.DEVICE_TTL_MS - 1000))).not.toBeNull();
    expect(await login.loadDevice(session.id, later(login.DEVICE_TTL_MS + 1000))).toBeNull();
  });
});

describe("общий логин team", () => {
  it("выключает только владелец и только после своего личного входа", async () => {
    const teamOwner = { ...(await tasks.actorFor("muradyan", "OWNER")), via: "TEAM" as const };
    await expect(login.saveTeamLogin(teamOwner, "off")).rejects.toThrow(/Сначала войдите сами по личной ссылке/);
    await expect(login.saveTeamLogin({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "INVITE" }, "off")).rejects.toThrow(/только владелец/);
    expect(await login.saveTeamLogin(await owner(), "off")).toBe("off");
    expect(await login.getTeamLogin()).toBe("off");
    // Включить обратно можно и с общего логина: это безопасно
    expect(await login.saveTeamLogin(teamOwner, "on")).toBe("on");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.team-login" }, orderBy: { id: "desc" } });
    expect([log.before, log.after, log.via]).toEqual(["выключен", "работает", "TEAM"]);
  });
});

describe("ссылка на почту", () => {
  it("письмо уходит только на адрес из списка, ответ одинаковый, ссылка живёт 15 минут", async () => {
    await admin.updatePerson(await owner(), "reva", { email: " Reva@Sravni.ru " });
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).email).toBe("reva@sravni.ru");

    expect(await login.requestEmailLink("stranger@sravni.ru", { ip: "1.1.1.1", baseUrl: base }, t0)).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
    expect(await login.requestEmailLink("REVA@sravni.ru", { ip: "1.1.1.1", baseUrl: base }, t0)).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("reva@sravni.ru");
    // В письме только кто, что и ссылка
    expect(sent[0]!.text).toMatch(/^Рева Тарас, ссылка для входа в Weekly:\nhttps:\/\/weekly\.example\.ru\/login\/link\?t=/);
    const token = tokenFrom(sent[0]!);
    expect((await login.peekLink(token, later(login.EMAIL_TTL_MS - 1000))).status).toBe("ok");
    await expect(login.consumeLoginLink(token, device, later(login.EMAIL_TTL_MS + 1000))).rejects.toThrow(/Срок ссылки истёк/);

    expect(await login.requestEmailLink("не почта", { ip: "1.1.1.1", baseUrl: base }, t0)).toMatchObject({ ok: false, error: expect.stringMatching(/с ошибкой/) });
  });

  it("не больше 5 запросов с адреса и 3 писем человеку за 15 минут", async () => {
    await admin.updatePerson(await owner(), "reva", { email: "reva@sravni.ru" });
    for (let i = 0; i < 5; i++) expect((await login.requestEmailLink("reva@sravni.ru", { ip: "2.2.2.2", baseUrl: base }, later(i * 1000))).ok).toBe(true);
    expect(sent).toHaveLength(3);
    expect(await login.requestEmailLink("reva@sravni.ru", { ip: "2.2.2.2", baseUrl: base }, later(6000))).toMatchObject({ ok: false, error: expect.stringMatching(/Слишком много/) });
    // Через 15 минут снова можно
    expect((await login.requestEmailLink("reva@sravni.ru", { ip: "2.2.2.2", baseUrl: base }, later(16 * 60 * 1000))).ok).toBe(true);
    expect(sent).toHaveLength(4);
  });

  it("почта уникальна и проверяется", async () => {
    await admin.updatePerson(await owner(), "reva", { email: "reva@sravni.ru" });
    await expect(admin.updatePerson(await owner(), "fatyanov", { email: "REVA@sravni.ru" })).rejects.toThrow(/уже указана у Рева Тарас/);
    await expect(admin.updatePerson(await owner(), "fatyanov", { email: "fatyanov@" })).rejects.toThrow(/с ошибкой/);
    await admin.updatePerson(await owner(), "reva", { email: "" });
    expect((await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } })).email).toBeNull();
  });
});

describe("режим управления по почте", () => {
  it("только администратор при личном входе, ссылка работает у него же и на том же устройстве; владелец только паролем", async () => {
    await admin.updatePerson(await owner(), "golovkin", { email: "golovkin@sravni.ru" });
    await admin.updatePerson(await owner(), "muradyan", { email: "muradyan@sravni.ru" });
    const teamAdmin = { ...(await tasks.actorFor("golovkin")), via: "TEAM" as const };
    await expect(login.requestStepUp(teamAdmin, null, base, t0)).rejects.toThrow(/при личном входе/);
    const reva = { ...(await tasks.actorFor("reva")), via: "INVITE" as const };
    await expect(login.requestStepUp(reva, "d-reva", base, t0)).rejects.toThrow(/только владельцу и администраторам/);
    const personalOwner = { ...(await tasks.actorFor("muradyan")), via: "INVITE" as const };
    await expect(login.requestStepUp(personalOwner, "d-owner", base, t0)).rejects.toThrow(/паролем владельца/);

    const invite = await login.issueInvite(await owner(), "golovkin", t0);
    const { session } = await login.consumeLoginLink(invite.token, device, t0);
    const golovkin = { ...(await tasks.actorFor("golovkin")), via: "INVITE" as const };
    expect(await login.requestStepUp(golovkin, session.id, base, t0)).toEqual({ email: "golovkin@sravni.ru" });
    expect(sent[0]!.text).toContain(`${base}/manage/confirm?t=`);
    const token = tokenFrom(sent[0]!);
    // Ссылка подтверждения не открывает вход, не работает у другого человека и на другом устройстве
    await expect(login.consumeLoginLink(token, device, later(1000))).rejects.toThrow();
    await expect(login.consumeStepUp(token, personalOwner, "d-owner", later(1000))).rejects.toThrow(/другому человеку/);
    await expect(login.consumeStepUp(token, golovkin, "другое-устройство", later(1000))).rejects.toThrow(/с которого её запросили/);
    await login.consumeStepUp(token, golovkin, session.id, later(2000));
    await expect(login.consumeStepUp(token, golovkin, session.id, later(3000))).rejects.toThrow(/уже использована/);
  });
});

describe("найдено проверкой", () => {
  it("параллельные запросы на почту не обходят ограничения и не дают двух живых ссылок", async () => {
    await admin.updatePerson(await owner(), "reva", { email: "reva@sravni.ru" });
    const results = await Promise.all(Array.from({ length: 20 }, () => login.requestEmailLink("reva@sravni.ru", { ip: "3.3.3.3", baseUrl: base }, t0)));
    expect(results.filter((r) => r.ok)).toHaveLength(login.EMAIL_REQUESTS_PER_IP);
    expect(sent).toHaveLength(login.EMAIL_LINKS_PER_PERSON);
    const live = await prisma.loginLink.count({ where: { kind: "EMAIL", usedAt: null, expiresAt: { gt: t0 } } });
    expect(live).toBe(1);
  });

  it("сбой почтового сервера не выдаёт, кто в команде", async () => {
    await admin.updatePerson(await owner(), "reva", { email: "reva@sravni.ru" });
    setMailTransport(async () => {
      throw new Error("SMTP недоступен");
    });
    expect(await login.requestEmailLink("reva@sravni.ru", { ip: "4.4.4.4", baseUrl: base }, t0)).toEqual({ ok: true });
    expect(await login.requestEmailLink("nobody@sravni.ru", { ip: "4.4.4.4", baseUrl: base }, t0)).toEqual({ ok: true });
  });

  it("выключение общего логина гасит старые сессии: включили обратно, они не оживают", async () => {
    const before = await prisma.setting.findUnique({ where: { key: "auth.epoch" } });
    await login.saveTeamLogin(await owner(), "off");
    const after = await prisma.setting.findUniqueOrThrow({ where: { key: "auth.epoch" } });
    expect(after.value).toBe((typeof before?.value === "number" ? before.value : 1) + 1);
    await login.saveTeamLogin(await owner(), "on");
    expect((await prisma.setting.findUniqueOrThrow({ where: { key: "auth.epoch" } })).value).toBe(after.value);
  });

  it("по общему логину нельзя завершить чьи-то личные входы, выбрав его имя", async () => {
    const link = await login.issueInvite(await owner(), "reva", t0);
    const { session } = await login.consumeLoginLink(link.token, device, t0);
    const impostor = { ...(await tasks.actorFor("reva")), via: "TEAM" as const };
    await expect(login.revokeAllDevices(impostor, "reva", later(1000))).rejects.toThrow(/при личном входе/);
    await expect(login.revokeDevice(impostor, session.id, later(1000))).rejects.toThrow(/при личном входе/);
    expect(await login.loadDevice(session.id, later(2000))).not.toBeNull();
  });

  it("скользящий срок: заходит каждый день, вход не гаснет через 30 дней", async () => {
    const link = await login.issueInvite(await owner(), "reva", t0);
    const { session } = await login.consumeLoginLink(link.token, device, t0);
    const day = 24 * 60 * 60 * 1000;
    let last = t0;
    for (let d = 1; d <= 40; d += 10) {
      const now = later(d * day);
      expect(await login.loadDevice(session.id, now), `день ${d}`).not.toBeNull();
      await login.touchDevice(session.id, last, now);
      last = now;
    }
    expect(await login.loadDevice(session.id, later(41 * day))).not.toBeNull();
  });

  it("смена почты гасит ссылки, ушедшие на старый адрес; новый вход в том же браузере завершает прежний", async () => {
    await admin.updatePerson(await owner(), "reva", { email: "reva@sravni.ru" });
    await login.requestEmailLink("reva@sravni.ru", { ip: "5.5.5.5", baseUrl: base }, new Date());
    const old = tokenFrom(sent[0]!);
    await admin.updatePerson(await owner(), "reva", { email: "taras@sravni.ru" });
    expect((await login.peekLink(old)).status).toBe("expired");

    const first = await login.consumeLoginLink((await login.issueInvite(await owner(), "reva", t0)).token, device, t0);
    const second = await login.consumeLoginLink((await login.issueInvite(await owner(), "reva", later(1000))).token, device, later(2000), first.session.id);
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: first.session.id } })).revokedBy).toBe("replaced");
    expect(await login.loadDevice(second.session.id, later(3000))).not.toBeNull();
  });
});

describe("журнал знает способ входа", () => {
  it("правка задачи с личного входа и с общего логина", async () => {
    await prisma.task.deleteMany();
    const personal = { ...(await tasks.actorFor("reva")), via: "INVITE" as const };
    await tasks.createTask(personal, { title: "Личный вход", outcome: "Проверка", owner: "reva", direction: "product", due: "2030-01-15", source: "weekly" });
    const team = { ...(await tasks.actorFor("reva")), via: "TEAM" as const };
    await tasks.createTask(team, { title: "Общий логин", outcome: "Проверка", owner: "reva", direction: "product", due: "2030-01-15", source: "weekly" });
    const rows = await prisma.auditLog.findMany({ where: { action: "task.create" }, orderBy: { id: "desc" }, take: 2 });
    expect(rows.map((r) => r.via)).toEqual(["TEAM", "INVITE"]);
  });
});
