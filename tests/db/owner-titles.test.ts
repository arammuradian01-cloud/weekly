// Этап 69: подпись роли владельца на настоящей базе. Задаёт только главный владелец при личном входе в режиме
// управления, себе и совладельцам; совладелец, администратор, общий логин и вход без режима управления не могут.
// Журнал пишет, что было и что стало. Пустая подпись возвращает правило по умолчанию, со снятием роли владельца
// подпись снимается. Права подпись не меняет. Серверное действие в режиме «Смотреть как» отказывает, база не меняется.
// cookie и заголовки запроса подменены: вход читает подписанные cookie так же, как на сервере.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Headers({ "user-agent": "vitest", origin: "http://localhost:3000" }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (http.cookies.has(name) ? { name, value: http.cookies.get(name)! } : undefined),
    getAll: () => [...http.cookies].map(([name, value]) => ({ name, value })),
    has: (name: string) => http.cookies.has(name),
    set: (name: string | { name: string; value: string }, value?: string) => {
      if (typeof name === "object") http.cookies.set(name.name, name.value);
      else http.cookies.set(name, String(value ?? ""));
    },
    delete: (name: string) => {
      http.cookies.delete(name);
    },
  }),
  headers: async () => http.headers,
}));

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as admin from "@/lib/admin/service";
import * as login from "@/lib/login/service";
import * as pw from "@/lib/login/password";
import { ownerLabels, primaryOwnerSlug } from "@/lib/login/primary";
import { OWNER_TITLES_KEY, OWNER_TITLE_TEXTS } from "@/lib/owner-title";
import { roleLabelOf } from "@/lib/roles";
import { MANAGEMENT_TTL_MS, SESSION_COOKIE, signSession, type ManagementGrant } from "@/lib/session";
import { getEpochs } from "@/lib/settings";
import { VIEW_AS_DENIED } from "@/lib/view-as";
import { setOwnerTitleAction } from "@/app/(app)/settings/actions";
import * as viewAs from "@/app/actions/view-as";

const SECRET = process.env.SESSION_SECRET!;
const PEOPLE = ["muradyan", "golovkin", "reva"];

/** Главный владелец Мурадян при личном входе в режиме управления */
const primary = async () => ({ ...(await tasks.actorFor("muradyan", "OWNER")), via: "PASSWORD" as const });
/** Головкин совладельцем: роль владельца, режим управления владельца, личный вход */
const coOwner = async () => ({ ...(await tasks.actorFor("golovkin", "OWNER")), via: "PASSWORD" as const });
const expectRule = async (p: Promise<unknown>, message: RegExp | string) => {
  await expect(p).rejects.toBeInstanceOf(tasks.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};
const titlesRow = () => prisma.setting.findUnique({ where: { key: OWNER_TITLES_KEY } });

// Журнал только дописывается (триггер в базе): записи теста отсчитываются от последней записи перед тестом
let auditMark = BigInt(0);
const titleAudit = () => prisma.auditLog.findMany({ where: { field: "Подпись роли", id: { gt: auditMark } }, orderBy: { id: "asc" } });

/** Личный вход или вход по общему логину: подписанная cookie сессии, по желанию с режимом управления роли человека */
async function signIn(slug: string, opts: { management?: boolean; team?: boolean } = {}) {
  http.cookies.clear();
  const p = await prisma.person.findUniqueOrThrow({ where: { slug } });
  const { epoch, managementEpoch } = await getEpochs();
  const role = p.role === "OWNER" ? "OWNER" : p.role === "ADMIN" ? "ADMIN" : null;
  const management: ManagementGrant | undefined = opts.management && role ? { role, until: Date.now() + MANAGEMENT_TTL_MS, epoch: managementEpoch } : undefined;
  if (opts.team) {
    http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: p.id, via: "TEAM", ...(management ? { management } : {}) }, SECRET));
    return;
  }
  const device = await prisma.deviceSession.create({ data: { personId: p.id, method: "PASSWORD", expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
  http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: p.id, sid: device.id, via: "PASSWORD", ...(management ? { management } : {}) }, SECRET));
}

async function reset() {
  http.cookies.clear();
  await prisma.deviceSession.deleteMany();
  await prisma.loginLink.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { in: [OWNER_TITLES_KEY, admin.PRIMARY_OWNER_KEY] } } });
  await prisma.setting.create({ data: { key: admin.PRIMARY_OWNER_KEY, value: "muradyan" } });
  await prisma.person.updateMany({ where: { slug: { in: PEOPLE } }, data: { active: true } });
  await prisma.person.update({ where: { slug: "golovkin" }, data: { role: "ADMIN" } });
  await prisma.setting.upsert({ where: { key: "auth.teamLogin" }, update: { value: "on" }, create: { key: "auth.teamLogin", value: "on" } });
}

beforeEach(async () => {
  await reset();
  auditMark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe("кто задаёт подпись роли", () => {
  it("главный владелец задаёт себе «ex-Владелец» и совладельцу «Владелец»; подписи видны в списке людей и на экранах, журнал пишет было и стало", async () => {
    await admin.updatePerson(await primary(), "golovkin", { role: "OWNER" });
    expect(await admin.setOwnerTitle(await primary(), "muradyan", "  ex-Владелец ")).toEqual({ slug: "muradyan", title: "ex-Владелец", label: "ex-Владелец", changed: true });
    expect(await admin.setOwnerTitle(await primary(), "golovkin", "Владелец")).toEqual({ slug: "golovkin", title: "Владелец", label: "Владелец", changed: true });

    expect((await titlesRow())?.value).toEqual({ muradyan: "ex-Владелец", golovkin: "Владелец" });
    const list = await admin.listPeople();
    const row = (slug: string) => list.find((p) => p.slug === slug)!;
    expect([row("muradyan").ownerTitle, row("muradyan").roleLabel, row("muradyan").primaryOwner]).toEqual(["ex-Владелец", "ex-Владелец", true]);
    expect([row("golovkin").ownerTitle, row("golovkin").roleLabel, row("golovkin").primaryOwner]).toEqual(["Владелец", "Владелец", false]);
    expect([row("reva").ownerTitle, row("reva").roleLabel]).toEqual([null, "Лидер"]);
    const owners = await ownerLabels();
    expect(owners).toEqual({ primary: "muradyan", titles: { muradyan: "ex-Владелец", golovkin: "Владелец" } });
    expect(roleLabelOf({ slug: "golovkin", role: "OWNER" }, owners)).toBe("Владелец");

    const me = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const log = await titleAudit();
    expect(log.map((l) => [l.action, l.entity, l.entityId, l.before, l.after, l.actorId, l.via])).toEqual([
      ["settings.person.update", "person", "muradyan", "Владелец, по умолчанию", "ex-Владелец", me.id, "PASSWORD"],
      ["settings.person.update", "person", "golovkin", "Совладелец, по умолчанию", "Владелец", me.id, "PASSWORD"],
    ]);
  });

  it("та же подпись ничего не пишет, пустая возвращает правило по умолчанию с записью в журнал", async () => {
    await admin.setOwnerTitle(await primary(), "muradyan", "ex-Владелец");
    expect((await admin.setOwnerTitle(await primary(), "muradyan", "ex-Владелец")).changed).toBe(false);
    expect(await titleAudit()).toHaveLength(1);
    expect(await admin.setOwnerTitle(await primary(), "muradyan", "   ")).toEqual({ slug: "muradyan", title: null, label: "Владелец", changed: true });
    expect((await titlesRow())?.value).toEqual({});
    expect((await admin.listPeople()).find((p) => p.slug === "muradyan")?.roleLabel).toBe("Владелец");
    const log = await titleAudit();
    expect([log[1]?.before, log[1]?.after]).toEqual(["ex-Владелец", "Владелец, по умолчанию"]);
  });

  it("совладелец, администратор, общий логин и вход без режима управления подпись не задают; база не меняется", async () => {
    await admin.updatePerson(await primary(), "golovkin", { role: "OWNER" });
    // Совладелец с теми же правами владельца не задаёт подпись ни главному, ни себе
    await expectRule(admin.setOwnerTitle(await coOwner(), "muradyan", "Совладелец"), admin.OWNER_TITLE_RULES.primaryOnly);
    await expectRule(admin.setOwnerTitle(await coOwner(), "golovkin", "Владелец"), admin.OWNER_TITLE_RULES.primaryOnly);
    // Главный владелец по общему логину: профиль в нём выбирают сами
    await expectRule(admin.setOwnerTitle({ ...(await primary()), via: "TEAM" as const }, "muradyan", "ex-Владелец"), admin.OWNER_TITLE_RULES.personal);
    await expectRule(admin.setOwnerTitle({ ...(await primary()), via: null }, "muradyan", "ex-Владелец"), admin.OWNER_TITLE_RULES.personal);
    // Без режима управления и с режимом администратора
    await expectRule(admin.setOwnerTitle({ ...(await primary()), management: null }, "muradyan", "ex-Владелец"), /только владелец в режиме управления/);
    await admin.updatePerson(await primary(), "golovkin", { role: "ADMIN" });
    await expectRule(admin.setOwnerTitle({ ...(await tasks.actorFor("golovkin", "ADMIN")), via: "PASSWORD" as const }, "muradyan", "ex-Владелец"), /только владелец в режиме управления/);
    expect(await titlesRow()).toBeNull();
    expect(await titleAudit()).toEqual([]);
  });

  it("подпись бывает только у включённого владельца; неверный текст отказывает до записи", async () => {
    await expectRule(admin.setOwnerTitle(await primary(), "reva", "Владелец"), admin.OWNER_TITLE_RULES.ownerOnly);
    await expectRule(admin.setOwnerTitle(await primary(), "nobody", "Владелец"), admin.OWNER_TITLE_RULES.ownerOnly);
    await admin.updatePerson(await primary(), "golovkin", { role: "OWNER" });
    await prisma.person.update({ where: { slug: "golovkin" }, data: { active: false } });
    await expectRule(admin.setOwnerTitle(await primary(), "golovkin", "Владелец"), admin.OWNER_TITLE_RULES.ownerOnly);
    await expectRule(admin.setOwnerTitle(await primary(), "muradyan", "Владелец → CEO"), OWNER_TITLE_TEXTS.chars);
    await expectRule(admin.setOwnerTitle(await primary(), "muradyan", "В"), OWNER_TITLE_TEXTS.length);
    await expectRule(admin.setOwnerTitle(await primary(), "muradyan", "В".repeat(31)), OWNER_TITLE_TEXTS.length);
    expect(await titlesRow()).toBeNull();
    expect(await titleAudit()).toEqual([]);
  });

  it("снятие роли владельца снимает подпись с записью в журнал: снова став владельцем, человек подписан по умолчанию", async () => {
    await admin.updatePerson(await primary(), "golovkin", { role: "OWNER" });
    await admin.setOwnerTitle(await primary(), "golovkin", "Владелец");
    await admin.updatePerson(await primary(), "golovkin", { role: "ADMIN" });
    expect((await titlesRow())?.value).toEqual({});
    const log = await titleAudit();
    expect([log.at(-1)?.before, log.at(-1)?.after]).toEqual(["Владелец", "снята вместе с ролью владельца"]);
    await admin.updatePerson(await primary(), "golovkin", { role: "OWNER" });
    expect((await admin.listPeople()).find((p) => p.slug === "golovkin")?.roleLabel).toBe("Совладелец");
  });
});

describe("подпись не меняет права", () => {
  it("главный с подписью «ex-Владелец» остаётся главным, совладелец с подписью «Владелец» не управляет его входом и паролем", async () => {
    await admin.updatePerson(await primary(), "golovkin", { role: "OWNER" });
    await admin.setOwnerTitle(await primary(), "muradyan", "ex-Владелец");
    await admin.setOwnerTitle(await primary(), "golovkin", "Владелец");
    expect(await primaryOwnerSlug()).toBe("muradyan");
    // Совладелец по-прежнему не трогает главного
    await expectRule(login.issueInvite(await coOwner(), "muradyan"), /только он сам/);
    await expectRule(pw.resetPassword(await coOwner(), "muradyan"), /только он сам/);
    await expectRule(login.revokeAllDevices(await coOwner(), "muradyan"), /только он сам/);
    await expectRule(admin.updatePerson(await coOwner(), "muradyan", { role: "ADMIN" }), /только он сам/);
    await expectRule(admin.setPrimaryOwner(await coOwner(), "golovkin"), /только сам главный владелец/);
    // Главный по-прежнему выдаёт ссылку совладельцу и управляет людьми
    expect((await login.issueInvite(await primary(), "golovkin")).fullName).toBe("Головкин Владислав");
    await admin.updatePerson(await primary(), "reva", { zone: "Продукт и CJM по всем линиям" });
  });
});

describe("серверное действие", () => {
  /** Действие, которое при удаче уводит на другую страницу: «redirect» вместо исключения */
  async function settle<T>(run: () => Promise<T>): Promise<T | "redirect"> {
    try {
      return await run();
    } catch (error) {
      if (isRedirectError(error)) return "redirect";
      throw error;
    }
  }

  it("главный владелец при личном входе в режиме управления задаёт подпись; по общему логину отказ текстом", async () => {
    await signIn("muradyan", { management: true });
    expect(await setOwnerTitleAction("muradyan", "ex-Владелец")).toEqual({ ok: true, value: { slug: "muradyan", title: "ex-Владелец", label: "ex-Владелец", changed: true } });
    await signIn("muradyan", { management: true, team: true });
    expect(await setOwnerTitleAction("muradyan", "Владелец")).toEqual({ ok: false, error: admin.OWNER_TITLE_RULES.personal });
    expect((await titlesRow())?.value).toEqual({ muradyan: "ex-Владелец" });
  });

  it("в режиме «Смотреть как» отказывает одним текстом, подпись и журнал не меняются", async () => {
    await signIn("muradyan", { management: true });
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    expect(await settle(() => viewAs.startViewAsAction(reva.id))).toBe("redirect");
    expect(await setOwnerTitleAction("muradyan", "ex-Владелец")).toEqual({ ok: false, error: VIEW_AS_DENIED });
    expect(await titlesRow()).toBeNull();
    expect(await titleAudit()).toEqual([]);
    expect(await settle(() => viewAs.stopViewAsAction())).toBe("redirect");
  });
});
