// Этап 63: «Смотреть как» на настоящей базе. Кто может включить (только владелец при личном входе в режиме
// управления, только включённого человека), что видно в просмотре, когда просмотр гаснет (владелец вышел, потерял
// роль или режим управления, человека выключили, срок, другое устройство), журнал начала и конца. Главное: каждое
// серверное действие ресурса и каждый обработчик с изменениями в режиме просмотра отказывает одним текстом, база не
// меняется, письма не уходят, события «Мне» не отмечаются прочитанными за другого человека.
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
import { MANAGEMENT_TTL_MS, SESSION_COOKIE, signSession, type ManagementGrant } from "@/lib/session";
import { getEpochs } from "@/lib/settings";
import { requireContext } from "@/lib/auth";
import { VIEW_AS_COOKIE, VIEW_AS_DENIED, VIEW_AS_TEXTS, ViewAsReadOnlyError, signViewAs } from "@/lib/view-as";
import { setMailTransport, type Mail } from "@/lib/mail";
import * as tasks from "@/lib/tasks/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import * as viewAs from "@/app/actions/view-as";
import { logout } from "@/app/actions/auth";
import { markSeenAction, markDoneAction } from "@/app/(app)/me/actions";
import { getTaskAction } from "@/app/(app)/tasks/actions";
import { searchAction } from "@/app/(app)/search/actions";
import { weekViewAction } from "@/app/(app)/weekly/actions";
import { POST as leaderBoardPost } from "@/app/api/goals/leader-board/route";
import { POST as marketUploadPost } from "@/app/api/market/upload/route";
import { GET as forecastExportGet } from "@/app/(app)/forecast/export/route";

const SECRET = process.env.SESSION_SECRET!;
const person = (slug: string) => prisma.person.findUniqueOrThrow({ where: { slug } });
const future = addDays(moscowToday(), 10);
let mails: Mail[] = [];

/** Личный вход человека: запись устройства и подписанная cookie сессии, по желанию с режимом управления его роли */
async function signIn(slug: string, opts: { management?: boolean; team?: boolean } = {}) {
  http.cookies.clear();
  const p = await person(slug);
  const { epoch, managementEpoch } = await getEpochs();
  const role = p.role === "OWNER" ? "OWNER" : p.role === "ADMIN" ? "ADMIN" : null;
  const management: ManagementGrant | undefined = opts.management && role ? { role, until: Date.now() + MANAGEMENT_TTL_MS, epoch: managementEpoch } : undefined;
  if (opts.team) {
    http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: p.id, via: "TEAM", ...(management ? { management } : {}) }, SECRET));
    return { person: p, sid: undefined as string | undefined, grant: management?.until ?? 0 };
  }
  const device = await prisma.deviceSession.create({ data: { personId: p.id, method: "PASSWORD", expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
  http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: p.id, sid: device.id, via: "PASSWORD", ...(management ? { management } : {}) }, SECRET));
  return { person: p, sid: device.id as string | undefined, grant: management?.until ?? 0 };
}

/** Действие, которое при удаче уводит на другую страницу: «redirect» вместо исключения */
async function settle<T>(run: () => Promise<T>): Promise<T | "redirect"> {
  try {
    return await run();
  } catch (error) {
    if (isRedirectError(error)) return "redirect";
    throw error;
  }
}

async function startAs(slug: string) {
  return settle(async () => viewAs.startViewAsAction((await person(slug)).id));
}

// Журнал только дописывается (триггер в базе): записи теста отсчитываются от последней записи перед тестом
let auditMark = BigInt(0);
const viewAsAudit = () => prisma.auditLog.findMany({ where: { action: { startsWith: "viewAs." }, id: { gt: auditMark } }, orderBy: { id: "asc" } });

beforeAll(async () => {
  await prisma.setting.upsert({ where: { key: "auth.teamLogin" }, update: { value: "on" }, create: { key: "auth.teamLogin", value: "on" } });
});

beforeEach(async () => {
  http.cookies.clear();
  await prisma.deviceSession.deleteMany();
  auditMark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
  mails = [];
  setMailTransport(async (mail) => {
    mails.push(mail);
  });
});
afterEach(() => setMailTransport(null));
afterAll(async () => {
  // Остальные файлы тестов ждут базу без задачи и входов этого файла
  await prisma.task.deleteMany({ where: { title: "Проверка просмотра" } });
  await prisma.deviceSession.deleteMany();
  await prisma.$disconnect();
});

describe("кто включает «Смотреть как»", () => {
  it("владелец при личном входе в режиме управления: просмотр, журнал, приложение глазами выбранного", async () => {
    const { person: owner } = await signIn("muradyan", { management: true });
    const reva = await person("reva");
    expect(await startAs("reva")).toBe("redirect");
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(true);

    const ctx = await requireContext();
    expect(ctx.person.slug).toBe("reva");
    expect(ctx.management).toBeNull();
    expect(ctx.managementRole).toBeNull();
    expect(ctx.deviceId).toBeNull();
    expect(ctx.viewAs?.owner.slug).toBe("muradyan");
    expect(ctx.viewAs!.until - Date.now()).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
    expect(ctx.viewAs!.until - Date.now()).toBeGreaterThan(2 * 60 * 60 * 1000 - 60_000);

    const [start] = await viewAsAudit();
    expect(start).toMatchObject({ action: "viewAs.start", actorId: owner.id, actorName: owner.fullName, entity: "person", entityId: "reva", via: "PASSWORD" });
    expect(String(start!.after)).toContain(reva.fullName);
  });

  it("срок не дольше режима управления", async () => {
    await signIn("muradyan", { management: true });
    const { epoch, managementEpoch } = await getEpochs();
    const owner = await person("muradyan");
    const sid = (await prisma.deviceSession.findFirstOrThrow({ where: { personId: owner.id } })).id;
    const soon = Date.now() + 20 * 60 * 1000;
    http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: owner.id, sid, via: "PASSWORD", management: { role: "OWNER", until: soon, epoch: managementEpoch } }, SECRET));
    expect(await startAs("reva")).toBe("redirect");
    expect((await requireContext()).viewAs!.until).toBe(soon);
  });

  it("без режима управления, по общему логину, администратор, лидер: нельзя", async () => {
    await signIn("muradyan");
    expect(await startAs("reva")).toEqual({ ok: false, error: VIEW_AS_TEXTS.management });
    await signIn("muradyan", { management: true, team: true });
    expect(await startAs("reva")).toEqual({ ok: false, error: VIEW_AS_TEXTS.personal });
    await signIn("golovkin", { management: true });
    expect(await startAs("reva")).toEqual({ ok: false, error: VIEW_AS_TEXTS.ownerOnly });
    await signIn("reva");
    expect(await startAs("fatyanov")).toEqual({ ok: false, error: VIEW_AS_TEXTS.ownerOnly });
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    expect(await viewAsAudit()).toEqual([]);
  });

  it("нельзя как выключенного, как себя и во время другого просмотра; список только включённых без себя", async () => {
    await signIn("muradyan", { management: true });
    // Аналитик встречи выключен в стартовых данных
    expect(await startAs("analyst")).toEqual({ ok: false, error: VIEW_AS_TEXTS.inactive });
    expect(await startAs("muradyan")).toEqual({ ok: false, error: VIEW_AS_TEXTS.self });
    expect(await viewAs.startViewAsAction("нет-такого")).toEqual({ ok: false, error: VIEW_AS_TEXTS.missing });

    const list = await viewAs.viewAsPeopleAction();
    expect(list.ok).toBe(true);
    const slugs = list.ok ? list.value.map((p) => p.slug) : [];
    expect(slugs).toContain("reva");
    expect(slugs).not.toContain("muradyan");
    expect(slugs).not.toContain("analyst");
    expect(slugs.length).toBe(await prisma.person.count({ where: { active: true } }) - 1);

    expect(await startAs("reva")).toBe("redirect");
    expect(await startAs("fatyanov")).toEqual({ ok: false, error: VIEW_AS_TEXTS.viewing });
    expect(await viewAs.viewAsPeopleAction()).toEqual({ ok: false, error: VIEW_AS_TEXTS.viewing });
    expect((await requireContext()).person.slug).toBe("reva");

    // Список людей не открывается не владельцу
    await signIn("golovkin", { management: true });
    expect(await viewAs.viewAsPeopleAction()).toEqual({ ok: false, error: VIEW_AS_TEXTS.ownerOnly });
  });
});

describe("просмотр гаснет сам", () => {
  it("владелец потерял роль, человека выключили, режим управления сменили: снова видно себя", async () => {
    await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    expect((await requireContext()).person.slug).toBe("reva");

    await prisma.person.update({ where: { slug: "muradyan" }, data: { role: "ADMIN" } });
    try {
      const ctx = await requireContext();
      expect([ctx.person.slug, ctx.viewAs]).toEqual(["muradyan", null]);
    } finally {
      await prisma.person.update({ where: { slug: "muradyan" }, data: { role: "OWNER" } });
    }
    expect((await requireContext()).person.slug).toBe("reva");

    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    try {
      expect((await requireContext()).person.slug).toBe("muradyan");
    } finally {
      await prisma.person.update({ where: { slug: "reva" }, data: { active: true } });
    }

    const { epoch, managementEpoch } = await getEpochs();
    await prisma.setting.upsert({ where: { key: "auth.managementEpoch" }, update: { value: managementEpoch + 1 }, create: { key: "auth.managementEpoch", value: managementEpoch + 1 } });
    try {
      const ctx = await requireContext();
      expect([ctx.person.slug, ctx.viewAs, ctx.management]).toEqual(["muradyan", null, null]);
    } finally {
      await prisma.setting.update({ where: { key: "auth.managementEpoch" }, data: { value: managementEpoch } });
    }
    expect((await requireContext()).person.slug).toBe("reva");

    // Режим управления включили заново на том же устройстве: это другой режим, старая cookie просмотра не оживает
    const owner = await person("muradyan");
    const sid = (await requireContext()).session.sid!;
    http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: owner.id, sid, via: "PASSWORD", management: { role: "OWNER", until: Date.now() + MANAGEMENT_TTL_MS + 5000, epoch: managementEpoch } }, SECRET));
    const again = await requireContext();
    expect([again.person.slug, again.viewAs, again.management?.role]).toEqual(["muradyan", null, "OWNER"]);
  });

  it("другое устройство владельца, срок вышел, вход завершён: просмотра нет", async () => {
    const { person: owner, sid } = await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    const cookie = http.cookies.get(VIEW_AS_COOKIE)!;

    // Та же cookie просмотра в другом браузере владельца не действует: она привязана к записи устройства
    await signIn("muradyan", { management: true });
    http.cookies.set(VIEW_AS_COOKIE, cookie);
    expect((await requireContext()).person.slug).toBe("muradyan");

    // Срок вышел
    const reva = await person("reva");
    const past = Date.now() - 60_000;
    const { sid: fresh, grant } = await signIn("muradyan", { management: true });
    http.cookies.set(VIEW_AS_COOKIE, await signViewAs({ ownerId: owner.id, sid: fresh!, targetId: reva.id, until: past + 1000, grant }, SECRET, past - 3_600_000));
    expect((await requireContext()).viewAs).toBeNull();

    // Вход завершили: никакого просмотра, человек уходит на экран входа
    http.cookies.set(VIEW_AS_COOKIE, await signViewAs({ ownerId: owner.id, sid: fresh!, targetId: reva.id, until: Date.now() + 60_000, grant }, SECRET));
    expect((await requireContext()).person.slug).toBe("reva");
    await prisma.deviceSession.update({ where: { id: fresh! }, data: { revokedAt: new Date(), revokedBy: "owner" } });
    await expect(requireContext()).rejects.toSatisfy(isRedirectError);
    expect(sid).not.toBe(fresh);
  });
});

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

/** Без входа в ресурс: экран входа, ссылки, первичная настройка. Режим просмотра их не касается */
const PUBLIC = new Set(["completeSetup", "login", "chooseProfile", "consumeLinkAction", "setPasswordAction", "confirmEmailAction", "requestEmailLinkAction", "logout"]);
/** Только чтение: работают и в режиме просмотра */
const READ = new Set([
  "setTeamAction",
  "searchAction",
  "getTaskAction",
  "taskHistoryAction",
  "taskExtrasAction",
  "taskLinksAction",
  "goalOptionsAction",
  "suggestGoalsAction",
  "meetingAction",
  "searchDecisionsAction",
  "myForecastAction",
  "planPeopleAction",
  "taskRequestsAction",
  "weekViewAction",
]);
/** Сам просмотр: выбор и начало отвечают «сначала выйдите из просмотра», выход проверен отдельно */
const SPECIAL = new Set(["viewAsPeopleAction", "startViewAsAction", "stopViewAsAction"]);

type Outcome = "denied" | string;

async function outcomeOf(fn: (...args: unknown[]) => Promise<unknown>, args: unknown[] = [anything, anything, anything, anything, anything]): Promise<Outcome> {
  try {
    const r = await fn(...args);
    if (r && typeof r === "object" && "error" in r && (r as { error: unknown }).error === VIEW_AS_DENIED) return "denied";
    return `ответ ${JSON.stringify(r)?.slice(0, 160)}`;
  } catch (error) {
    if (error instanceof ViewAsReadOnlyError || (error instanceof Error && error.message === VIEW_AS_DENIED)) return "denied";
    if (isRedirectError(error)) return `переход ${(error as { digest?: string }).digest ?? ""}`;
    return `исключение ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
  }
}

/** Отпечаток всех таблиц, кроме записей устройств (вход отмечает «последний раз» у устройства владельца) */
async function fingerprint(): Promise<Record<string, string>> {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('device_sessions', '_prisma_migrations') ORDER BY tablename");
  const out: Record<string, string> = {};
  for (const { tablename } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ h: string }[]>(`SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${tablename}" t`);
    out[tablename] = row!.h;
  }
  return out;
}

describe("только просмотр", () => {
  it("каждое серверное действие отказывает одним текстом, база не меняется, письма не уходят; чтение работает", async () => {
    // Задача Ревы и событие «Мне» до просмотра: чтение в просмотре должно их видеть, запись не должна их менять
    const owner = await tasks.actorFor("muradyan", "OWNER");
    const task = (await tasks.createTask(owner, { title: "Проверка просмотра", outcome: "Готово", owner: "reva", direction: "product", due: future })).task;
    await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");

    // Чтение работает в просмотре и видит то, что видит Рева
    const card = await getTaskAction(task.number);
    expect(card.ok && card.task?.number).toBe(task.number);
    const found = await searchAction("Проверка просмотра");
    expect(found.ok).toBe(true);
    expect((await weekViewAction(null)).week).toBeTruthy();

    const files = actionFiles();
    expect(files.length).toBeGreaterThan(15);
    const modules = await Promise.all(files.map(async (file) => ({ file, mod: (await import(resolve(file))) as Record<string, unknown> })));
    // Прогрев чтения: оно может завести служебную строку недели, как и при открытии страницы
    for (const { mod } of modules) for (const [name, fn] of Object.entries(mod)) if (READ.has(name) && typeof fn === "function") await outcomeOf(fn as never, []);

    const before = await fingerprint();
    const wrong: string[] = [];
    const seen = new Set<string>();
    for (const { file, mod } of modules) {
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function" || PUBLIC.has(name)) continue;
        seen.add(name);
        if (SPECIAL.has(name)) continue;
        // Чтение без аргументов: ответ «не найдено» вместо шума в логе, запись с любыми аргументами
        const outcome = await outcomeOf(fn as never, READ.has(name) ? [] : undefined);
        if (READ.has(name)) {
          if (outcome === "denied") wrong.push(`${file} ${name}: чтение отказало в просмотре`);
        } else if (outcome !== "denied") wrong.push(`${file} ${name}: ${outcome}`);
      }
    }
    expect(wrong).toEqual([]);
    // Списки чтения и особых действий не устарели: каждое имя есть среди действий
    for (const name of [...READ, ...SPECIAL]) expect(seen.has(name), name).toBe(true);
    expect(seen.size).toBeGreaterThan(150);
    expect(await fingerprint()).toEqual(before);
    expect(mails).toEqual([]);
    // Просмотр всё ещё идёт: отказы его не сломали
    expect((await requireContext()).person.slug).toBe("reva");
  }, 180_000);

  it("обработчики загрузок и выгрузка отказывают до чтения тела", async () => {
    await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    const before = await fingerprint();

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "борд.xlsx"));
    const board = await leaderBoardPost(new Request("http://localhost:3000/api/goals/leader-board", { method: "POST", headers: { origin: "http://localhost:3000" }, body: form }));
    expect(board.status).toBe(403);
    expect(await board.json()).toEqual({ ok: false, error: VIEW_AS_DENIED });

    const market = await marketUploadPost(new Request("http://localhost:3000/api/market/upload", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{}" }));
    expect(market.status).toBe(403);
    expect((await market.json()).error).toBe(VIEW_AS_DENIED);

    const exported = await forecastExportGet(new Request("http://localhost:3000/forecast/export"));
    expect(exported.status).toBe(403);
    expect(await exported.text()).toBe(VIEW_AS_DENIED);

    expect(await fingerprint()).toEqual(before);
  });

  it("события «Мне» не отмечаются прочитанными и разобранными за другого человека", async () => {
    const reva = await person("reva");
    const event = await prisma.inboxEvent.create({ data: { recipientId: reva.id, kind: "TEAM", subject: "team:view-as", text: "Событие для проверки просмотра" } });
    try {
      await signIn("muradyan", { management: true });
      expect(await startAs("reva")).toBe("redirect");
      expect(await markSeenAction(["team:view-as"])).toEqual({ ok: false, error: VIEW_AS_DENIED });
      expect(await markSeenAction()).toEqual({ ok: false, error: VIEW_AS_DENIED });
      expect(await markDoneAction("team:view-as")).toEqual({ ok: false, error: VIEW_AS_DENIED });
      const after = await prisma.inboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect([after.seenAt, after.doneAt]).toEqual([null, null]);
    } finally {
      await prisma.inboxEvent.delete({ where: { id: event.id } });
    }
  });
});

describe("конец просмотра", () => {
  it("«Выйти из просмотра»: журнал, кого смотрели, владелец снова он сам и в режиме управления", async () => {
    const { person: owner } = await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    expect(await settle(() => viewAs.stopViewAsAction())).toBe("redirect");
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    const ctx = await requireContext();
    expect([ctx.person.slug, ctx.viewAs, ctx.management?.role]).toEqual(["muradyan", null, "OWNER"]);
    const [, stop] = await viewAsAudit();
    expect(stop).toMatchObject({ action: "viewAs.stop", actorId: owner.id, entity: "person", entityId: "reva", field: "Выйти из просмотра", after: "Рева Тарас" });
  });

  it("выход из ресурса во время просмотра заканчивает просмотр и пишет это в журнал", async () => {
    const { sid } = await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    expect(await settle(() => logout())).toBe("redirect");
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    expect((await prisma.deviceSession.findUniqueOrThrow({ where: { id: sid! } })).revokedAt).not.toBeNull();
    const actions = (await viewAsAudit()).map((r) => [r.action, r.field]);
    expect(actions).toEqual([
      ["viewAs.start", "Смотреть как"],
      ["viewAs.stop", "Выход из ресурса"],
    ]);
  });
});
