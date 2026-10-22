// Этап 71: «Сменить профиль» на настоящей базе. Кого может выбрать владелец и кого общий логин (люди вне топ-команды,
// без личного пароля, не владельцы), вход владельца в профиль человека и возврат: сессия, журнал с пометкой «вошёл
// владелец» в каждой правке, начало и конец отдельными событиями. Отказы во время входа: режим управления, «Смотреть
// как», повторная смена, учётная запись человека, вкладка другого профиля. Конец входа: срок, человека выключили, с
// владельца сняли роль, владельца выключили, выход. И права владельцев на роль «Администратор» (пункт 4 решения).
// cookie и заголовки запроса подменены: вход читает подписанные cookie так же, как на сервере.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { MANAGEMENT_TTL_MS, SESSION_COOKIE, signSession, verifySession, type ManagementGrant, type SessionData } from "@/lib/session";
import { getEpochs } from "@/lib/settings";
import { requireContext } from "@/lib/auth";
import { OWNER_AS_ENDED, OWNER_AS_STALE, OWNER_AS_TEXTS } from "@/lib/owner-as";
import { teamChoosableWhere } from "@/lib/org/people";
import { MANAGEMENT_TEAM_REFUSAL, roleLabelOf } from "@/lib/roles";
import { VIEW_AS_TEXTS } from "@/lib/view-as";
import { journalEvents } from "@/lib/journal";
import { updatePerson } from "@/lib/admin/service";
import { ownerLabels, primaryOwnerSlug } from "@/lib/login/primary";
import { revokeOnDeactivate } from "@/lib/login/service";
import { PASSWORD_SETTING_KEYS, hashPassword } from "@/lib/passwords";
import * as tasks from "@/lib/tasks/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import * as ownerAs from "@/app/actions/owner-as";
import * as viewAs from "@/app/actions/view-as";
import { chooseProfile, confirmStepUpAction, enterManagement, exitManagement, logout, requestStepUpAction } from "@/app/actions/auth";
import { addCommentAction, createTaskAction } from "@/app/(app)/tasks/actions";
import { setTeamAction } from "@/app/actions/team";
import {
  calendarTitlesAction,
  cancelEmailBindingAction,
  changePasswordAction,
  createCalendarAction,
  requestEmailBindingAction,
  revokeAllMineAction,
  revokeCalendarAction,
  revokeDeviceAction,
  saveMailPrefsAction,
  savePushPrefsAction,
  syncPushAction,
} from "@/app/(app)/profile/actions";
import type { Actor } from "@/lib/tasks/service";

const SECRET = process.env.SESSION_SECRET!;
const person = (slug: string) => prisma.person.findUniqueOrThrow({ where: { slug } });
const future = addDays(moscowToday(), 10);
const PASSWORD = "Пароль владельца 2026";

/**
 * Люди этого файла: совладелец, человек вне топ-команды, человек с личным паролем, выключенный, человек для выключения.
 * В конце списка людей: главным владельцем по умолчанию остаётся первый владелец списка, а не совладелец этого файла
 */
const EXTRA = [
  { slug: "s71-coowner", fullName: "Совладельцев Олег", shortName: "Олег", role: "OWNER" as const, zone: "Совладелец", active: true },
  { slug: "s71-lead", fullName: "Структурный Лидер", shortName: "Лидер", role: "LEADER" as const, zone: "", position: "Product Owner ОСАГО", active: true },
  { slug: "s71-pw", fullName: "Парольный Пётр", shortName: "Пётр", role: "LEADER" as const, zone: "", active: true },
  { slug: "s71-owner-pw", fullName: "Парольный Владелец", shortName: "Владелец", role: "OWNER" as const, zone: "", active: true },
  { slug: "s71-off", fullName: "Выключенный Игорь", shortName: "Игорь", role: "LEADER" as const, zone: "", active: false },
  { slug: "s71-tmp", fullName: "Временный Тимур", shortName: "Тимур", role: "EMPLOYEE" as const, zone: "", active: true },
];

/** Личный вход человека: запись устройства и подписанная cookie сессии, по желанию с режимом управления его роли */
async function signIn(slug: string, opts: { management?: boolean } = {}) {
  http.cookies.clear();
  http.headers.delete("x-weekly-view");
  const p = await person(slug);
  const { epoch, managementEpoch } = await getEpochs();
  const role = p.role === "OWNER" ? "OWNER" : p.role === "ADMIN" ? "ADMIN" : null;
  const management: ManagementGrant | undefined = opts.management && role ? { role, until: Date.now() + MANAGEMENT_TTL_MS, epoch: managementEpoch } : undefined;
  const device = await prisma.deviceSession.create({ data: { personId: p.id, method: "PASSWORD", expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
  http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: p.id, sid: device.id, via: "PASSWORD", ...(management ? { management } : {}) }, SECRET));
  return { person: p, sid: device.id };
}

/** Вход по общему логину team: без выбранного профиля или с ним */
async function signInTeam(personId?: string) {
  http.cookies.clear();
  http.headers.delete("x-weekly-view");
  const { epoch } = await getEpochs();
  http.cookies.set(SESSION_COOKIE, await signSession({ epoch, via: "TEAM", ...(personId ? { personId } : {}) }, SECRET));
}

async function session(): Promise<SessionData | null> {
  return verifySession(http.cookies.get(SESSION_COOKIE), SECRET);
}

/** Действие, которое при удаче уводит на другую страницу: адрес перехода вместо исключения */
async function settle<T>(run: () => Promise<T>): Promise<T | { redirect: string }> {
  try {
    return await run();
  } catch (error) {
    if (isRedirectError(error)) return { redirect: String((error as { digest?: string }).digest ?? "").split(";")[2] ?? "" };
    throw error;
  }
}

async function enterAs(slug: string) {
  const r = await ownerAs.startOwnerAsAction((await person(slug)).id);
  expect(r).toEqual({ ok: true, value: null });
  const grant = (await session())!.ownerAs!;
  // Метка вкладки, которую страница входа кладёт в каждое действие
  http.headers.set("x-weekly-view", `as:${grant.id}`);
  return grant;
}

// Журнал только дописывается (триггер в базе): записи теста отсчитываются от последней записи перед тестом
let auditMark = BigInt(0);
const audit = (where: Record<string, unknown> = {}) => prisma.auditLog.findMany({ where: { id: { gt: auditMark }, ...where }, orderBy: { id: "asc" } });
const ownerAsAudit = () => audit({ action: { startsWith: "ownerAs." } });

let taskNumber = 0;

beforeAll(async () => {
  await prisma.setting.upsert({ where: { key: "auth.teamLogin" }, update: { value: "on" }, create: { key: "auth.teamLogin", value: "on" } });
  await prisma.setting.upsert({ where: { key: PASSWORD_SETTING_KEYS.owner }, update: { value: await hashPassword(PASSWORD) }, create: { key: PASSWORD_SETTING_KEYS.owner, value: await hashPassword(PASSWORD) } });
  for (const p of EXTRA) {
    const { position, ...rest } = p as typeof p & { position?: string };
    await prisma.person.upsert({ where: { slug: p.slug }, update: { ...rest, position: position ?? null, sortOrder: 9000 }, create: { ...rest, position: position ?? null, sortOrder: 9000 } });
  }
  await prisma.person.update({ where: { slug: "s71-pw" }, data: { passwordHash: await hashPassword("Пароль Петра 2026") } });
  await prisma.person.update({ where: { slug: "s71-owner-pw" }, data: { passwordHash: await hashPassword("Пароль владельца файла 2026") } });
  const owner = await tasks.actorFor("muradyan", "OWNER");
  taskNumber = (await tasks.createTask(owner, { title: "Проверка входа владельца", outcome: "Готово", owner: "reva", direction: "product", due: future })).task.number;
});

beforeEach(async () => {
  http.cookies.clear();
  http.headers.delete("x-weekly-view");
  await prisma.deviceSession.deleteMany();
  auditMark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { title: { in: ["Проверка входа владельца", "Задача из чужого профиля"] } } });
  await prisma.deviceSession.deleteMany();
  await prisma.person.deleteMany({ where: { slug: { in: EXTRA.map((p) => p.slug) } } });
  await prisma.$disconnect();
});

describe("кого можно выбрать", () => {
  it("владелец: все включённые люди структуры, кроме себя и других владельцев", async () => {
    await signIn("muradyan");
    const r = await ownerAs.ownerAsPeopleAction();
    expect(r.ok).toBe(true);
    const slugs = r.ok ? r.value.map((p) => p.slug) : [];
    expect(slugs).toEqual(expect.arrayContaining(["reva", "golovkin", "s71-lead", "s71-pw", "s71-tmp"]));
    expect(slugs).not.toContain("muradyan");
    expect(slugs).not.toContain("s71-coowner");
    expect(slugs).not.toContain("s71-owner-pw");
    expect(slugs).not.toContain("s71-off");
    const lead = r.ok ? r.value.find((p) => p.slug === "s71-lead") : null;
    expect(lead?.position).toBe("Product Owner ОСАГО");
  });

  it("не владелец и общий логин выбора не получают", async () => {
    await signIn("golovkin", { management: true });
    expect(await ownerAs.ownerAsPeopleAction()).toEqual({ ok: false, error: OWNER_AS_TEXTS.ownerOnly });
    expect(await ownerAs.startOwnerAsAction((await person("reva")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.ownerOnly });
    await signInTeam((await person("reva")).id);
    expect(await ownerAs.ownerAsPeopleAction()).toEqual({ ok: false, error: OWNER_AS_TEXTS.ownerOnly });
  });

  it("владелец не входит к другому владельцу, к себе и к выключенному", async () => {
    await signIn("muradyan");
    expect(await ownerAs.startOwnerAsAction((await person("s71-coowner")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.owner });
    expect(await ownerAs.startOwnerAsAction((await person("muradyan")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.self });
    expect(await ownerAs.startOwnerAsAction((await person("s71-off")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.inactive });
    expect(await ownerAs.startOwnerAsAction("нет-такого")).toEqual({ ok: false, error: OWNER_AS_TEXTS.missing });
    expect((await session())?.ownerAs).toBeUndefined();
    expect(await ownerAsAudit()).toEqual([]);
  });

  it("общий логин: все включённые люди структуры без личного пароля, владелец без пароля тоже (поправка 23.10)", async () => {
    const list = await prisma.person.findMany({ where: teamChoosableWhere, select: { slug: true } });
    const slugs = list.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(["reva", "golovkin", "s71-lead", "s71-tmp", "s71-coowner"]));
    for (const no of ["s71-owner-pw", "s71-pw", "s71-off"]) expect(slugs).not.toContain(no);
  });

  it("chooseProfile: человек вне топ-команды и владелец без пароля выбираются, с личным паролем и выключенный нет", async () => {
    const lead = await person("s71-lead");
    await signInTeam();
    const form = (id: string) => {
      const f = new FormData();
      f.set("personId", id);
      return f;
    };
    expect(await settle(() => chooseProfile(form(lead.id)))).toEqual({ redirect: "/" });
    expect(await session()).toMatchObject({ personId: lead.id, via: "TEAM" });
    expect((await requireContext()).person.slug).toBe("s71-lead");
    const [chosen] = await audit({ action: "profile.choose" });
    expect(chosen).toMatchObject({ actorId: lead.id, via: "TEAM" });

    for (const slug of ["s71-pw", "s71-owner-pw", "s71-off"]) {
      await signInTeam();
      expect(await settle(async () => chooseProfile(form((await person(slug)).id)))).toEqual({ redirect: "/choose?denied=1" });
      expect((await session())?.personId).toBeUndefined();
    }
  });

  it("владелец по общему логину: подпись роли, но не режим управления, не «Смотреть как» и не вход в чужой профиль", async () => {
    const coowner = await person("s71-coowner");
    await signInTeam();
    const f = new FormData();
    f.set("personId", coowner.id);
    expect(await settle(() => chooseProfile(f))).toEqual({ redirect: "/" });
    // Режим управления, подписанный когда-то в эту же cookie, тоже не действует
    const { epoch, managementEpoch } = await getEpochs();
    http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: coowner.id, via: "TEAM", management: { role: "OWNER", until: Date.now() + MANAGEMENT_TTL_MS, epoch: managementEpoch } }, SECRET));
    const ctx = await requireContext();
    expect(ctx.person.slug).toBe("s71-coowner");
    expect(ctx.via).toBe("TEAM");
    expect(ctx.management).toBeNull();
    expect(ctx.managementRole).toBeNull();
    expect(roleLabelOf(ctx.person, await ownerLabels())).toBe("Совладелец");
    const form = new FormData();
    form.set("password", PASSWORD);
    expect(await enterManagement(null, form)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
    expect(await requestStepUpAction(null)).toEqual({ error: MANAGEMENT_TEAM_REFUSAL });
    expect(await viewAs.viewAsPeopleAction()).toEqual({ ok: false, error: VIEW_AS_TEXTS.personal });
    expect(await ownerAs.ownerAsPeopleAction()).toEqual({ ok: false, error: OWNER_AS_TEXTS.personal });
    expect(await ownerAs.startOwnerAsAction((await person("reva")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.personal });
    expect(await ownerAsAudit()).toEqual([]);
  });

  it("профиль общего логина больше не открывается, когда человек задал личный пароль", async () => {
    const reva = await person("reva");
    await signInTeam(reva.id);
    expect((await requireContext()).person.slug).toBe("reva");
    await prisma.person.update({ where: { id: reva.id }, data: { passwordHash: await hashPassword("Пароль Ревы 2026") } });
    try {
      expect(await settle(() => requireContext())).toEqual({ redirect: "/choose" });
    } finally {
      await prisma.person.update({ where: { id: reva.id }, data: { passwordHash: null } });
    }
    // Владелец задал себе личный пароль: из общего логина пропал
    await signInTeam((await person("s71-owner-pw")).id);
    expect(await settle(() => requireContext())).toEqual({ redirect: "/choose" });
  });
});

describe("вход владельца в профиль и возврат", () => {
  it("вход: профиль, права и правки человека, режим управления выключен, в журнале начало", async () => {
    const { person: owner } = await signIn("muradyan", { management: true });
    const reva = await person("reva");
    const grant = await enterAs("reva");
    const s = (await session())!;
    expect(s.management).toBeUndefined();
    expect(s.personId).toBe(owner.id);
    expect(grant.targetId).toBe(reva.id);
    expect(grant.until - Date.now()).toBeGreaterThan(12 * 60 * 60 * 1000 - 60_000);

    const ctx = await requireContext();
    expect(ctx.person.slug).toBe("reva");
    expect(ctx.via).toBe("OWNER_AS");
    expect(ctx.management).toBeNull();
    expect(ctx.managementRole).toBeNull();
    expect(ctx.deviceId).toBeNull();
    expect(ctx.ownerAs?.owner.slug).toBe("muradyan");

    const [start] = await ownerAsAudit();
    expect(start).toMatchObject({ action: "ownerAs.start", actorId: owner.id, actorName: owner.fullName, entity: "person", entityId: "reva", field: "Вход владельца в профиль", via: "PASSWORD", before: grant.id });
    expect(String(start!.after)).toContain(reva.fullName);
  });

  it("правки от имени человека, в каждой записи журнала пометка, кто из владельцев вошёл", async () => {
    const { person: owner } = await signIn("muradyan");
    const reva = await person("reva");
    await enterAs("reva");
    const comment = await addCommentAction(taskNumber, "Комментарий из чужого профиля");
    expect(comment.ok).toBe(true);
    const created = await createTaskAction({ title: "Задача из чужого профиля", outcome: "Готово", owner: "reva", direction: "product", due: future });
    expect(created.ok).toBe(true);

    const rows = await audit({ action: { in: ["task.comment", "task.create"] } });
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["task.comment", "task.create"]));
    for (const r of rows) expect(r).toMatchObject({ actorId: reva.id, actorName: reva.fullName, via: "OWNER_AS", asOwnerId: owner.id, asOwnerName: owner.fullName });
    const authored = await prisma.taskComment.findFirstOrThrow({ where: { text: "Комментарий из чужого профиля" } });
    expect(authored.authorId).toBe(reva.id);

    // Экран журнала: правка Ревы с пометкой, и у владельца в фильтре «Кто» его правки в чужом профиле
    const byOwner = await journalEvents({ who: "muradyan", limit: 50 });
    const marked = byOwner.events.find((e) => e.kind === "comment");
    expect(marked).toMatchObject({ by: "reva", via: "owner", asOwner: owner.fullName });
  });

  it("вкладка, показанная для другого профиля, не записывает: отказ без изменений", async () => {
    await signIn("muradyan");
    const grant = await enterAs("reva");
    const before = await prisma.taskComment.count();
    for (const tab of ["self", "as:other-entry", "view:x"]) {
      http.headers.set("x-weekly-view", tab);
      expect(await addCommentAction(taskNumber, "Не от того имени")).toEqual({ ok: false, error: OWNER_AS_STALE });
    }
    // Запрос без метки (страница без скрипта) проходит, как обычно
    http.headers.delete("x-weekly-view");
    expect((await addCommentAction(taskNumber, "Без метки вкладки")).ok).toBe(true);
    http.headers.set("x-weekly-view", `as:${grant.id}`);
    expect(await prisma.taskComment.count()).toBe(before + 1);
  });

  it("во время входа: режим управления, «Смотреть как» и повторная смена отказывают", async () => {
    await signIn("muradyan", { management: true });
    await enterAs("s71-lead");
    const form = new FormData();
    form.set("password", PASSWORD);
    expect(await enterManagement(null, form)).toEqual({ error: OWNER_AS_TEXTS.management });
    expect(await exitManagement()).toEqual({ error: OWNER_AS_TEXTS.management });
    expect(await requestStepUpAction(null)).toEqual({ error: OWNER_AS_TEXTS.management });
    expect(await confirmStepUpAction(null, new FormData())).toEqual({ error: OWNER_AS_TEXTS.management });
    expect(await viewAs.viewAsPeopleAction()).toEqual({ ok: false, error: OWNER_AS_TEXTS.viewAs });
    expect(await viewAs.startViewAsAction((await person("reva")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.viewAs });
    expect(await ownerAs.ownerAsPeopleAction()).toEqual({ ok: false, error: OWNER_AS_TEXTS.inside });
    expect(await ownerAs.startOwnerAsAction((await person("reva")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.inside });
    const ctx = await requireContext();
    expect(ctx.person.slug).toBe("s71-lead");
    expect(ctx.management).toBeNull();
    expect((await session())?.management).toBeUndefined();
  });

  it("учётная запись человека закрыта: пароль, почта, входы, календарь, письма и уведомления не меняются", async () => {
    const lead = await person("s71-lead");
    const device = await prisma.deviceSession.create({ data: { personId: lead.id, method: "PASSWORD", expiresAt: new Date(Date.now() + 86_400_000) } });
    await signIn("muradyan");
    await enterAs("s71-lead");
    const refused = { ok: false, error: OWNER_AS_TEXTS.account };
    expect(await changePasswordAction("", "Новый пароль Лидера 2026", "Новый пароль Лидера 2026")).toEqual(refused);
    expect(await requestEmailBindingAction("lead@sravni.ru", "")).toEqual(refused);
    expect(await cancelEmailBindingAction()).toEqual(refused);
    expect(await revokeDeviceAction(device.id)).toEqual(refused);
    expect(await revokeAllMineAction()).toEqual(refused);
    expect(await createCalendarAction(true)).toEqual(refused);
    expect(await calendarTitlesAction(true)).toEqual(refused);
    expect(await revokeCalendarAction()).toEqual(refused);
    expect(await saveMailPrefsAction({ events: false })).toEqual(refused);
    expect(await savePushPrefsAction({ tasks: false })).toEqual(refused);
    expect(await syncPushAction({ endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } }, "s71-lead")).toEqual(refused);

    const after = await person("s71-lead");
    expect(after.passwordHash).toBeNull();
    expect(after.pendingEmail).toBeNull();
    expect(after.mailPrefs).toEqual(lead.mailPrefs);
    expect(after.pushPrefs).toEqual(lead.pushPrefs);
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: device.id } })).revokedAt).toBeNull();
    expect(await prisma.calendarFeed.count({ where: { personId: lead.id } })).toBe(0);
    // Вход владельца отказы не сломали
    expect((await requireContext()).person.slug).toBe("s71-lead");
  });

  it("возврат: без пароля к тому же владельцу, режим управления не возвращается, в журнале конец; старая вкладка не пишет", async () => {
    const { person: owner } = await signIn("muradyan", { management: true });
    const grant = await enterAs("reva");
    expect(await ownerAs.returnToOwnProfileAction()).toEqual({ ok: true, value: null });
    const s = (await session())!;
    expect(s.ownerAs).toBeUndefined();
    expect(s.management).toBeUndefined();
    expect(s.personId).toBe(owner.id);
    const ctx = await requireContext();
    expect(ctx.person.slug).toBe("muradyan");
    expect(ctx.via).toBe("PASSWORD");
    expect(ctx.ownerAs).toBeNull();

    const [start, stop] = await ownerAsAudit();
    expect(start!.action).toBe("ownerAs.start");
    expect(stop).toMatchObject({ action: "ownerAs.stop", actorId: owner.id, entityId: "reva", field: "Вернулся в свой профиль", before: grant.id });
    // Вкладка, оставшаяся от входа, правку не пишет: она ушла бы уже от имени владельца
    expect(await addCommentAction(taskNumber, "Из старой вкладки")).toEqual({ ok: false, error: OWNER_AS_STALE });
    http.headers.set("x-weekly-view", "self");
    expect((await addCommentAction(taskNumber, "Владелец у себя")).ok).toBe(true);
    // Второй возврат: «вы и так в своём профиле»
    expect(await ownerAs.returnToOwnProfileAction()).toEqual({ ok: false, error: OWNER_AS_TEXTS.notInside });
    expect(await ownerAsAudit()).toHaveLength(2);
  });

  it("команда, выбранная во входе, живёт в своей cookie и снимается при возврате", async () => {
    await signIn("muradyan");
    // Выбор владельца: cookie «team» не должна меняться во входе
    http.cookies.set("team", "owner-choice");
    await enterAs("reva");
    expect(await setTeamAction("top")).toEqual({ ok: true });
    expect(http.cookies.get("team_view")).toBe("top");
    expect(http.cookies.get("team")).toBe("owner-choice");
    expect(await ownerAs.returnToOwnProfileAction()).toEqual({ ok: true, value: null });
    expect(http.cookies.has("team_view")).toBe(false);
    expect(http.cookies.get("team")).toBe("owner-choice");
  });

  it("выход во время входа: конец «выход из ресурса», вход владельца на устройстве завершён", async () => {
    const { person: owner, sid } = await signIn("muradyan");
    await enterAs("reva");
    expect(await settle(() => logout())).toEqual({ redirect: "/login" });
    const stop = (await ownerAsAudit()).find((r) => r.action === "ownerAs.stop");
    expect(stop).toMatchObject({ actorId: owner.id, field: "Выход из ресурса" });
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: sid } })).revokedAt).not.toBeNull();
  });

  it("во время «Смотреть как» в чужой профиль не войти", async () => {
    await signIn("muradyan", { management: true });
    expect(await settle(async () => viewAs.startViewAsAction((await person("reva")).id))).toEqual({ redirect: "/" });
    expect(await ownerAs.startOwnerAsAction((await person("s71-lead")).id)).toEqual({ ok: false, error: OWNER_AS_TEXTS.viewing });
    expect(await ownerAs.ownerAsPeopleAction()).toEqual({ ok: false, error: OWNER_AS_TEXTS.viewing });
  });
});

describe("конец входа", () => {
  it("срок вышел: владелец снова у себя, изменения закрыты до возврата, конец в журнале один раз", async () => {
    const { person: owner, sid } = await signIn("muradyan");
    const reva = await person("reva");
    const { epoch } = await getEpochs();
    const grant = { id: "s71-expired-1", targetId: reva.id, until: Date.now() - 1000 };
    http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: owner.id, sid, via: "PASSWORD", ownerAs: grant }, SECRET));
    http.headers.set("x-weekly-view", `as:${grant.id}`);

    const ctx = await requireContext();
    expect(ctx.person.slug).toBe("muradyan");
    expect(ctx.ownerAs).toBeNull();
    expect(ctx.ownerAsEnded).toMatchObject({ id: grant.id, reason: "expired", target: { id: reva.id } });
    expect(ctx.management).toBeNull();
    await requireContext();
    expect(await addCommentAction(taskNumber, "После срока")).toEqual({ ok: false, error: OWNER_AS_ENDED });
    http.headers.set("x-weekly-view", "as-ended:s71-expired-1");
    expect(await addCommentAction(taskNumber, "После срока")).toEqual({ ok: false, error: OWNER_AS_ENDED });
    const form = new FormData();
    form.set("password", PASSWORD);
    expect(await enterManagement(null, form)).toEqual({ error: OWNER_AS_ENDED });

    expect(await ownerAs.returnToOwnProfileAction()).toEqual({ ok: true, value: null });
    const stops = (await ownerAsAudit()).filter((r) => r.action === "ownerAs.stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ actorId: owner.id, field: "Вышел срок входа", before: grant.id });
    http.headers.set("x-weekly-view", "self");
    expect((await addCommentAction(taskNumber, "Снова у себя")).ok).toBe(true);
  });

  it("человека выключили: вход кончается, возврат есть", async () => {
    await signIn("muradyan");
    await enterAs("s71-tmp");
    await prisma.person.update({ where: { slug: "s71-tmp" }, data: { active: false } });
    try {
      const ctx = await requireContext();
      expect(ctx.person.slug).toBe("muradyan");
      expect(ctx.ownerAsEnded?.reason).toBe("inactive");
      expect(await ownerAs.returnToOwnProfileAction()).toEqual({ ok: true, value: null });
      expect((await ownerAsAudit()).find((r) => r.action === "ownerAs.stop")?.field).toBe("Человек выключен");
    } finally {
      await prisma.person.update({ where: { slug: "s71-tmp" }, data: { active: true } });
    }
  });

  it("с владельца сняли роль: возврата нет, вход на устройстве завершается", async () => {
    const { person: coowner, sid } = await signIn("s71-coowner");
    await enterAs("s71-lead");
    await prisma.person.update({ where: { id: coowner.id }, data: { role: "ADMIN" } });
    try {
      expect(await settle(() => requireContext())).toEqual({ redirect: "/login?ended=1" });
      expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: sid } })).revokedBy).toBe("owner-as");
      expect((await ownerAsAudit()).find((r) => r.action === "ownerAs.stop")).toMatchObject({ actorId: coowner.id, field: "Снята роль владельца" });
      expect(await settle(() => ownerAs.returnToOwnProfileAction())).toEqual({ redirect: "/login?ended=1" });
      expect(http.cookies.has(SESSION_COOKIE)).toBe(false);
    } finally {
      await prisma.person.update({ where: { id: coowner.id }, data: { role: "OWNER" } });
    }
  });

  it("владельца выключили: его входы завершены, вход в чужой профиль кончается без возврата", async () => {
    const { person: coowner } = await signIn("s71-coowner");
    await enterAs("s71-lead");
    await prisma.$transaction(async (tx) => {
      await tx.person.update({ where: { id: coowner.id }, data: { active: false } });
      await revokeOnDeactivate(tx, coowner.id);
    });
    try {
      expect(await settle(() => requireContext())).toEqual({ redirect: "/login?ended=1" });
      expect((await ownerAsAudit()).find((r) => r.action === "ownerAs.stop")).toMatchObject({ actorId: coowner.id, field: "Владелец выключен" });
      expect(await settle(() => ownerAs.returnToOwnProfileAction())).toEqual({ redirect: "/login?ended=1" });
    } finally {
      await prisma.person.update({ where: { id: coowner.id }, data: { active: true } });
    }
  });
});

describe("права владельцев на роли (пункт 4)", () => {
  const actorOf = async (slug: string, management: Actor["management"]): Promise<Actor> => ({ ...(await tasks.actorFor(slug, management)), via: "PASSWORD" });

  it("совладелец в режиме управления даёт роль «Администратор», администратор роли не меняет", async () => {
    expect(await primaryOwnerSlug()).not.toBe("s71-coowner");
    const coowner = await actorOf("s71-coowner", "OWNER");
    try {
      await updatePerson(coowner, "s71-tmp", { role: "ADMIN" });
      expect((await person("s71-tmp")).role).toBe("ADMIN");
      const change = (await audit({ action: "settings.person.update", entityId: "s71-tmp" })).at(-1);
      expect(change).toMatchObject({ actorId: coowner.personId, field: "Роль" });

      const admin = await actorOf("golovkin", "ADMIN");
      await expect(updatePerson(admin, "s71-tmp", { role: "LEADER" })).rejects.toThrow("Людей и роли меняет только владелец в режиме управления");
      await expect(updatePerson(admin, "s71-lead", { role: "ADMIN" })).rejects.toThrow("Людей и роли меняет только владелец в режиме управления");
      // Без режима управления совладелец роли тоже не меняет
      await expect(updatePerson(await actorOf("s71-coowner", null), "s71-lead", { role: "ADMIN" })).rejects.toThrow("Людей и роли меняет только владелец в режиме управления");
      expect((await person("s71-tmp")).role).toBe("ADMIN");
      expect((await person("s71-lead")).role).toBe("LEADER");
    } finally {
      await prisma.person.update({ where: { slug: "s71-tmp" }, data: { role: "EMPLOYEE" } });
    }
  });
});
