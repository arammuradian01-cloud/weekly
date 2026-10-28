// Этап 71, добавка по аудиту 23.10: режим управления только при личном входе. Раньше цепочка «общий логин team, выбор
// владельца на экране «Выберите себя», пароль режима управления владельца» давала полный режим управления: ссылки для
// входа, сброс паролей, выгрузку всего. Здесь: по общему логину режим не включается ни паролем, ни ссылкой на почту ни
// владельцу, ни администратору; режим, оставшийся в cookie общего логина, не действует; перебор всех серверных действий
// ресурса под общим логином с таким режимом в cookie: каждое отвечает так же, как без него, база (люди, настройки,
// ссылки, календари, уведомления) и письма не меняются; выгрузки и закрытые разделы отказывают. Плюс точечные вызовы
// действий управления с настоящими аргументами: отказ по правам, а не на проверке ввода.
// cookie и заголовки запроса подменены: вход читает подписанные cookie так же, как на сервере.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { MANAGEMENT_TTL_MS, SESSION_COOKIE, signSession, verifySession, type ManagementRole } from "@/lib/session";
import { getEpochs } from "@/lib/settings";
import { requireContext, requireManagement } from "@/lib/auth";
import { MANAGEMENT_TEAM_REFUSAL } from "@/lib/roles";
import { PASSWORD_SETTING_KEYS, hashPassword } from "@/lib/passwords";
import { managementCredential, managementPasswordCurrent, managementPasswordPolicy, setManagementPasswordMode } from "@/lib/login/management-password";
import { setMailTransport, type Mail } from "@/lib/mail";
import { confirmStepUpAction, enterManagement, requestStepUpAction } from "@/app/actions/auth";
import { GET as exportExcelGet } from "@/app/(app)/settings/export/route";
import { GET as forecastExportGet } from "@/app/(app)/forecast/export/route";
import ManagePage from "@/app/(app)/manage/page";
import { TeamRefusal } from "@/app/(app)/manage/team-refusal";
import { issueInviteAction, issueInvitesForAllAction, resetPasswordAction, revokePersonDevicesAction, setPersonActiveAction, updatePersonAction } from "@/app/(app)/settings/actions";

const SECRET = process.env.SESSION_SECRET!;
const OWNER_PASSWORD = "Пароль владельца для проверки 2026";
const ADMIN_PASSWORD = "Пароль администраторов для проверки 2026";
let mails: Mail[] = [];

/** Вход по общему логину с выбранным профилем; grant: режим управления, оставшийся в cookie (подделать его нельзя, но он мог остаться) */
async function teamSession(slug: string, grant: ManagementRole | null = null) {
  http.cookies.clear();
  const p = await prisma.person.findUniqueOrThrow({ where: { slug } });
  const { epoch, managementEpoch } = await getEpochs();
  const management = grant ? { role: grant, until: Date.now() + MANAGEMENT_TTL_MS, epoch: managementEpoch } : undefined;
  http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: p.id, via: "TEAM", ...(management ? { management } : {}) }, SECRET));
  return p;
}

async function settle<T>(run: () => Promise<T>): Promise<T | { redirect: string }> {
  try {
    return await run();
  } catch (error) {
    if (isRedirectError(error)) return { redirect: String((error as { digest?: string }).digest ?? "").split(";")[2] ?? "" };
    throw error;
  }
}

/** Все серверные действия ресурса: файлы с "use server" в src */
function actionFiles(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : actionFiles(path);
    return /\.(ts|tsx)$/.test(name) && /^"use server";/m.test(readFileSync(path, "utf8")) ? [path] : [];
  });
}

/** Любой аргумент: читается как пустая строка, ноль, пустой список, вызывается и не падает */
const anything: unknown = new Proxy(function () {}, {
  get: (_t, key) => (key === Symbol.toPrimitive ? () => "" : key === Symbol.iterator ? function* () {} : key === "then" ? undefined : anything),
  apply: () => anything,
});

/** Без входа или меняют саму сессию (вход, выбор профиля, выход): в переборе не вызываются */
const SKIP = new Set(["completeSetup", "login", "chooseProfile", "consumeLinkAction", "setPasswordAction", "confirmEmailAction", "requestEmailLinkAction", "logout"]);

/** Ответ действия коротко: успех, текст отказа, переход или исключение. Данные успешного ответа не сравниваются */
async function outcomeOf(fn: (...args: unknown[]) => Promise<unknown>): Promise<string> {
  try {
    const r = await fn(anything, anything, anything, anything, anything);
    if (r && typeof r === "object") {
      if ("ok" in r) return (r as { ok: unknown }).ok ? "успех" : `отказ: ${String((r as { error?: unknown }).error ?? "")}`;
      if ("error" in r) return `отказ: ${String((r as { error: unknown }).error)}`;
      return "ответ";
    }
    return `ответ ${typeof r}`;
  } catch (error) {
    if (isRedirectError(error)) return `переход ${String((error as { digest?: string }).digest ?? "").split(";")[2] ?? ""}`;
    return `исключение ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
  }
}

/** Отпечаток того, что открывает режим управления: люди и роли, входы, ссылки, настройки, календари, уведомления */
async function fingerprint(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const queries: Record<string, string> = {
    people: `SELECT md5(coalesce(string_agg(concat_ws('|', slug, role, active, "passwordHash", email, "pendingEmail", login, "fullName", zone), ',' ORDER BY slug), '')) AS h FROM people`,
    settings: `SELECT md5(coalesce(string_agg(concat_ws('|', key, value::text), ',' ORDER BY key), '')) AS h FROM settings WHERE key NOT LIKE 'sheet.%'`,
    login_links: `SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS h FROM login_links t`,
    calendar_feeds: `SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS h FROM calendar_feeds t`,
    push_subscriptions: `SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) AS h FROM push_subscriptions t`,
    revoked_devices: `SELECT count(*)::text AS h FROM device_sessions WHERE "revokedAt" IS NOT NULL`,
  };
  for (const [name, sql] of Object.entries(queries)) {
    const [row] = await prisma.$queryRawUnsafe<{ h: string }[]>(sql);
    out[name] = row!.h;
  }
  return out;
}

const saved: Record<string, unknown> = {};
let auditMark = BigInt(0);

beforeAll(async () => {
  await prisma.setting.upsert({ where: { key: "auth.teamLogin" }, update: { value: "on" }, create: { key: "auth.teamLogin", value: "on" } });
  for (const kind of ["owner", "admin"] as const) {
    saved[kind] = (await prisma.setting.findUnique({ where: { key: PASSWORD_SETTING_KEYS[kind] } }))?.value ?? null;
    const value = await hashPassword(kind === "owner" ? OWNER_PASSWORD : ADMIN_PASSWORD);
    await prisma.setting.upsert({ where: { key: PASSWORD_SETTING_KEYS[kind] }, update: { value }, create: { key: PASSWORD_SETTING_KEYS[kind], value } });
  }
  // Владелец и администратор без личного пароля: оба есть в списке общего логина
  for (const slug of ["muradyan", "golovkin"]) {
    saved[slug] = (await prisma.person.findUniqueOrThrow({ where: { slug } })).passwordHash;
    await prisma.person.update({ where: { slug }, data: { passwordHash: null } });
  }
});

beforeEach(async () => {
  http.cookies.clear();
  http.headers.delete("x-weekly-view");
  await prisma.loginAttempt.deleteMany();
  auditMark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
  mails = [];
  setMailTransport(async (mail) => {
    mails.push(mail);
  });
});
afterEach(() => setMailTransport(null));

afterAll(async () => {
  for (const kind of ["owner", "admin"] as const) {
    if (saved[kind] === null) await prisma.setting.deleteMany({ where: { key: PASSWORD_SETTING_KEYS[kind] } });
    else await prisma.setting.update({ where: { key: PASSWORD_SETTING_KEYS[kind] }, data: { value: saved[kind] as string } });
  }
  for (const slug of ["muradyan", "golovkin"]) await prisma.person.update({ where: { slug }, data: { passwordHash: (saved[slug] as string | null) ?? null } });
  await prisma.$disconnect();
});

describe("режим управления по общему логину", () => {
  it("не включается ни владельцу, ни администратору: ни паролем, ни ссылкой на почту", async () => {
    for (const [slug, password] of [
      ["muradyan", OWNER_PASSWORD],
      ["golovkin", ADMIN_PASSWORD],
    ] as const) {
      await teamSession(slug);
      const form = new FormData();
      form.set("password", password);
      expect(await enterManagement(null, form)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
      expect(await requestStepUpAction(null)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
      const link = new FormData();
      link.set("token", "любая-ссылка");
      expect(await confirmStepUpAction(null, link)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
      expect((await verifySession(http.cookies.get(SESSION_COOKIE), SECRET))?.management).toBeUndefined();
      const ctx = await requireContext();
      expect([ctx.managementRole, ctx.management]).toEqual([null, null]);
    }
    expect(await prisma.auditLog.count({ where: { id: { gt: auditMark }, action: { startsWith: "management." } } })).toBe(0);
    expect(mails).toEqual([]);
  });

  it("режим, оставшийся в cookie общего логина, не действует: разделы управления и выгрузки закрыты", async () => {
    for (const [slug, grant] of [
      ["muradyan", "OWNER"],
      ["golovkin", "ADMIN"],
    ] as const) {
      await teamSession(slug, grant);
      const ctx = await requireContext();
      expect([ctx.managementRole, ctx.management]).toEqual([null, null]);
      // Не молчаливый уход на главную, а экран режима управления с объяснением
      expect(await settle(() => requireManagement())).toEqual({ redirect: "/manage?next=%2F" });
      expect(await settle(() => exportExcelGet())).toEqual({ redirect: "/manage?next=%2Fsettings" });
      const manage = (await ManagePage({ searchParams: Promise.resolve({ next: "/settings" }) })) as { type: unknown };
      expect(manage.type).toBe(TeamRefusal);
      expect(JSON.stringify(TeamRefusal())).toContain(MANAGEMENT_TEAM_REFUSAL);
      const forecast = await forecastExportGet(new Request("http://localhost:3000/forecast/export"));
      expect(forecast.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("действия управления с настоящими аргументами под общим логином с режимом в cookie: отказ, база и письма не меняются", async () => {
    // Было бы что менять: у Ревы личный пароль и вход на устройстве
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
    const revaHash = await hashPassword("Пароль Ревы для проверки 2026");
    await prisma.person.update({ where: { id: reva.id }, data: { passwordHash: revaHash } });
    const device = await prisma.deviceSession.create({ data: { personId: reva.id, method: "PASSWORD", expiresAt: new Date(Date.now() + 86_400_000) } });
    try {
      const before = await fingerprint();
      // Отказ по правам, а не по проверке ввода: аргументы настоящие
      const refused = (r: unknown) => expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/только владелец/) });
      for (const [slug, grant] of [
        ["muradyan", "OWNER"],
        ["golovkin", "ADMIN"],
      ] as const) {
        await teamSession(slug, grant);
        refused(await issueInviteAction("muradyan"));
        refused(await issueInviteAction("reva"));
        refused(await issueInvitesForAllAction(3));
        refused(await resetPasswordAction("reva"));
        refused(await revokePersonDevicesAction("reva"));
        refused(await updatePersonAction("reva", { role: "ADMIN" }));
        refused(await updatePersonAction("muradyan", { role: "LEADER" }));
        refused(await setPersonActiveAction("reva", false));
        expect(await settle(() => exportExcelGet())).toEqual({ redirect: "/manage?next=%2Fsettings" });
        expect((await forecastExportGet(new Request("http://localhost:3000/forecast/export"))).status).toBeGreaterThanOrEqual(400);
      }
      expect(await fingerprint()).toEqual(before);
      const after = await prisma.person.findUniqueOrThrow({ where: { id: reva.id } });
      expect([after.role, after.active, after.passwordHash]).toEqual([reva.role, reva.active, revaHash]);
      expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: device.id } })).revokedAt).toBeNull();
      expect((await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } })).role).toBe("OWNER");
      expect(await prisma.loginLink.count({ where: { createdAt: { gt: new Date(Date.now() - 60_000) } } })).toBe(0);
      expect(mails).toEqual([]);
    } finally {
      await prisma.deviceSession.delete({ where: { id: device.id } });
      await prisma.person.update({ where: { id: reva.id }, data: { passwordHash: reva.passwordHash } });
    }
  });

  // PR #87: у владельца может быть свой личный пароль управления вместо общего. Правило этапа 71 от этого не меняется:
  // по общему логину режима управления нет ни от общего пароля, ни от личного, ни по ссылке на почту
  it("личный пароль управления владельца не открывает режим по общему логину", async () => {
    const owner = await prisma.person.findUniqueOrThrow({ where: { slug: "muradyan" } });
    const key = `auth.management.person.${owner.id}`;
    const personalPassword = "Личный пароль владельца для проверки 2026";
    const passwordSetAt = new Date();
    await prisma.person.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(personalPassword), passwordSetAt } });
    try {
      await setManagementPasswordMode("muradyan", "personal");
      const policy = await managementPasswordPolicy(await prisma.person.findUniqueOrThrow({ where: { id: owner.id } }));
      expect(policy.mode).toBe("personal");
      // Отметка в cookie, какую выдал бы личный вход с личным паролем
      const credential = managementCredential({ passwordSetAt }, policy);
      const { epoch, managementEpoch } = await getEpochs();
      const grant = { role: "OWNER" as const, until: Date.now() + MANAGEMENT_TTL_MS, epoch: managementEpoch, credential };

      // Пока личный пароль есть, владельца нет в списке общего логина: прежний выбор профиля больше не открывается
      await teamSession("muradyan");
      expect(await settle(() => requireContext())).toEqual({ redirect: "/choose" });

      // Личный пароль сняли: владелец снова в списке общего логина, но режима управления там нет ни от одного пароля
      await prisma.person.update({ where: { id: owner.id }, data: { passwordHash: null, passwordSetAt: null } });
      await teamSession("muradyan");
      for (const password of [personalPassword, OWNER_PASSWORD]) {
        const form = new FormData();
        form.set("password", password);
        expect(await enterManagement(null, form)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
      }
      expect(await requestStepUpAction(null)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
      const link = new FormData();
      link.set("token", "любая-ссылка");
      expect(await confirmStepUpAction(null, link)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
      expect((await verifySession(http.cookies.get(SESSION_COOKIE), SECRET))?.management).toBeUndefined();

      // Режим, выданный личным входом по личному паролю, в сессии общего логина не действует
      http.cookies.clear();
      http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: owner.id, via: "TEAM", management: grant }, SECRET));
      const personalCtx = await requireContext();
      expect([personalCtx.managementRole, personalCtx.management]).toEqual([null, null]);
      expect(await settle(() => requireManagement())).toEqual({ redirect: "/manage?next=%2F" });
      expect(await managementPasswordCurrent(grant, await prisma.person.findUniqueOrThrow({ where: { id: owner.id } }), false)).toBe(false);

      // То же с общим паролем владельцев: правильная отметка в cookie режима по общему логину не возвращает
      await prisma.setting.deleteMany({ where: { key } });
      http.cookies.clear();
      http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: owner.id, via: "TEAM", management: { ...grant, credential: "shared/default/" } }, SECRET));
      const sharedCtx = await requireContext();
      expect([sharedCtx.managementRole, sharedCtx.management]).toEqual([null, null]);
      expect(await settle(() => requireManagement())).toEqual({ redirect: "/manage?next=%2F" });

      expect(await prisma.auditLog.count({ where: { id: { gt: auditMark }, action: "management.enter" } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { id: { gt: auditMark }, action: "management.fail" } })).toBe(0);
      expect(mails).toEqual([]);
    } finally {
      await prisma.setting.deleteMany({ where: { key } });
      await prisma.person.update({ where: { id: owner.id }, data: { passwordHash: null, passwordSetAt: owner.passwordSetAt } });
    }
  });

  it("перебор: каждое серверное действие под общим логином с режимом в cookie отвечает так же, как без режима; база и письма не меняются", async () => {
    const files = actionFiles();
    expect(files.length).toBeGreaterThan(15);
    const modules = await Promise.all(files.map(async (file) => ({ file, mod: (await import(resolve(file))) as Record<string, unknown> })));
    const before = await fingerprint();
    const differ: string[] = [];
    let checked = 0;
    for (const [slug, grant] of [
      ["muradyan", "OWNER"],
      ["golovkin", "ADMIN"],
    ] as const) {
      for (const { file, mod } of modules) {
        for (const [name, fn] of Object.entries(mod)) {
          if (typeof fn !== "function" || SKIP.has(name)) continue;
          await teamSession(slug, null);
          const plain = await outcomeOf(fn as never);
          await teamSession(slug, grant);
          const withGrant = await outcomeOf(fn as never);
          checked += 1;
          if (plain !== withGrant) differ.push(`${file} ${name} (${grant}): без режима «${plain}», с режимом «${withGrant}»`);
        }
      }
    }
    expect(differ).toEqual([]);
    expect(checked).toBeGreaterThan(300);
    expect(await fingerprint()).toEqual(before);
    expect(mails).toEqual([]);
    // Ни одной записи о том, что открывает только режим управления
    const managed = await prisma.auditLog.findMany({
      where: { id: { gt: auditMark }, OR: [{ action: { startsWith: "settings." } }, { action: { startsWith: "auth." } }, { action: { startsWith: "management." } }, { action: { startsWith: "export." } }, { action: { startsWith: "sync." } }, { action: "data.reload" }] },
      select: { action: true },
    });
    expect(managed).toEqual([]);
  }, 300_000);
});
