// Этап 63: «Смотреть как» на настоящей базе. Кто может включить (только владелец при личном входе в режиме
// управления, только включённого человека), что видно в просмотре, когда просмотр гаснет (владелец вышел, потерял
// роль или режим управления, человека выключили, срок, другое устройство), журнал начала и конца. Главное: каждое
// серверное действие ресурса и каждый обработчик с изменениями в режиме просмотра отказывает одним текстом, база не
// меняется, письма не уходят, события очереди «Ждёт вас» не отмечаются прочитанными за другого человека.
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
import { closeViewAs, requireContext, requireWriteContext } from "@/lib/auth";
import { VIEW_AS_COOKIE, VIEW_AS_DENIED, VIEW_AS_ENDED, VIEW_AS_TEXTS, ViewAsReadOnlyError, signViewAs } from "@/lib/view-as";
import { inboxCount, listInbox } from "@/lib/inbox/service";
import { subjectOf } from "@/lib/org/current";
import { setMailTransport, type Mail } from "@/lib/mail";
import * as tasks from "@/lib/tasks/service";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";
import * as viewAs from "@/app/actions/view-as";
import { enterManagement, exitManagement, login, logout } from "@/app/actions/auth";
import { PASSWORD_SETTING_KEYS, hashPassword } from "@/lib/passwords";
import { setTeamAction } from "@/app/actions/team";
import { markSeenAction, markDoneAction } from "@/app/actions/inbox";
import { getTaskAction } from "@/app/(app)/tasks/actions";
import { searchAction } from "@/app/(app)/search/actions";
import { weekViewAction } from "@/app/(app)/weekly/actions";
import { POST as leaderBoardPost } from "@/app/api/goals/leader-board/route";
import { POST as marketUploadPost } from "@/app/api/market/upload/route";
import { GET as marketDataGet } from "@/app/api/market/data/route";
import { GET as forecastExportGet } from "@/app/(app)/forecast/export/route";
import { GET as exportExcelGet } from "@/app/(app)/settings/export/route";

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

/** Просмотр закончился сам, cookie ещё есть: владелец видит себя, но изменения закрыты до «Вернуться к себе» */
async function expectEnded(reason: string) {
  const ctx = await requireContext();
  expect([ctx.person.slug, ctx.viewAs, ctx.viewAsEnded?.reason, ctx.viewAsEnded?.target?.fullName]).toEqual(["muradyan", null, reason, "Рева Тарас"]);
  // Запрос без метки вкладки и вкладки просмотра не запишут правку от имени владельца
  expect(await markSeenAction()).toEqual({ ok: false, error: VIEW_AS_ENDED });
  expect(await withTab(`view:${ctx.viewAsEnded!.id}`, () => markSeenAction())).toEqual({ ok: false, error: VIEW_AS_ENDED });
  expect(await withTab(`ended:${ctx.viewAsEnded!.id}`, () => markSeenAction())).toEqual({ ok: false, error: VIEW_AS_ENDED });
  await expect(requireWriteContext()).rejects.toThrow(VIEW_AS_ENDED);
  // Обычная вкладка владельца не блокируется
  expect((await withTab("self", () => markSeenAction())).ok).toBe(true);
  return ctx.viewAsEnded!;
}

/** Метка вкладки в заголовке запроса, как её ставит страница (ViewAsSync) */
async function withTab<T>(tab: string, run: () => Promise<T>): Promise<T> {
  http.headers.set("x-weekly-view", tab);
  try {
    return await run();
  } finally {
    http.headers.delete("x-weekly-view");
  }
}

const stops = async () => (await viewAsAudit()).filter((r) => r.action === "viewAs.stop").map((r) => r.field);

describe("просмотр закончился сам", () => {
  it("снята роль: конец записан первым запросом и один раз, роль вернули, просмотр не продолжается; «Вернуться к себе» остаётся на странице", async () => {
    const { person: owner } = await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    const id = (await requireContext()).viewAs!.id;

    await prisma.person.update({ where: { slug: "muradyan" }, data: { role: "ADMIN" } });
    try {
      expect((await expectEnded("role")).id).toBe(id);
      await requireContext();
      expect(await stops()).toEqual(["Снята роль владельца"]);
    } finally {
      await prisma.person.update({ where: { slug: "muradyan" }, data: { role: "OWNER" } });
    }
    // Конец записан: роль вернули, а просмотр не продолжается, журнал и экран не расходятся
    await expectEnded("role");

    expect(await settle(() => viewAs.stopViewAsAction("/tasks?view=board"))).toBe("redirect");
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    const back = await requireWriteContext();
    expect([back.person.slug, back.viewAs, back.viewAsEnded, back.management?.role]).toEqual(["muradyan", null, null, "OWNER"]);
    expect(await stops()).toEqual(["Снята роль владельца"]);
    const [stop] = (await viewAsAudit()).filter((r) => r.action === "viewAs.stop");
    expect(stop).toMatchObject({ actorId: owner.id, entityId: "reva", after: "Рева Тарас", before: id });
  });

  it("«Вернуться к себе» возвращает на ту же страницу, чужой адрес не принимается", async () => {
    await signIn("muradyan", { management: true });
    const digest = async (back?: string) => {
      try {
        await viewAs.stopViewAsAction(back);
      } catch (error) {
        return (error as { digest?: string }).digest ?? "";
      }
      return "";
    };
    expect(await digest("/tasks?view=board")).toContain(";/tasks?view=board;");
    expect(await digest("//evil.example")).toContain(";/;");
    expect(await digest(undefined)).toContain(";/;");
  });

  it("человек выключен, режим управления сменили или включили заново: изменения закрыты; режим управления можно выключить", async () => {
    await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    try {
      await expectEnded("inactive");
    } finally {
      await prisma.person.update({ where: { slug: "reva" }, data: { active: true } });
    }
    expect(await stops()).toEqual(["Человек выключен"]);

    auditMark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    expect(await startAs("reva")).toBe("redirect");
    const { epoch, managementEpoch } = await getEpochs();
    await prisma.setting.upsert({ where: { key: "auth.managementEpoch" }, update: { value: managementEpoch + 1 }, create: { key: "auth.managementEpoch", value: managementEpoch + 1 } });
    try {
      await expectEnded("management");
    } finally {
      await prisma.setting.update({ where: { key: "auth.managementEpoch" }, data: { value: managementEpoch } });
    }
    expect(await stops()).toEqual(["Закончился режим управления"]);

    // Режим управления включили заново на том же устройстве: это другой режим, просмотр не оживает
    auditMark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    await settle(() => viewAs.stopViewAsAction());
    expect(await startAs("reva")).toBe("redirect");
    const owner = await person("muradyan");
    const sid = (await requireContext()).session.sid!;
    http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: owner.id, sid, via: "PASSWORD", management: { role: "OWNER", until: Date.now() + MANAGEMENT_TTL_MS + 5000, epoch: managementEpoch } }, SECRET));
    await expectEnded("management");

    // Выключить режим управления после конца просмотра можно из любой вкладки: владелец не застревает
    expect(await withTab(`view:${(await requireContext()).viewAsEnded!.id}`, () => settle(() => exitManagement()))).toBe("redirect");
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    expect((await requireContext()).management).toBeNull();
    expect(await stops()).toEqual(["Закончился режим управления"]);
  });

  it("срок вышел: изменения закрыты; новый просмотр сначала записывает конец прежнего", async () => {
    const { person: owner, sid, grant } = await signIn("muradyan", { management: true });
    const reva = await person("reva");
    const past = Date.now() - 60_000;
    http.cookies.set(VIEW_AS_COOKIE, await signViewAs({ id: "view-expired", ownerId: owner.id, sid: sid!, targetId: reva.id, until: past, grant }, SECRET, past - 3_600_000));
    await expectEnded("expired");

    expect(await startAs("fatyanov")).toBe("redirect");
    expect((await requireContext()).person.slug).toBe("fatyanov");
    expect((await viewAsAudit()).map((r) => [r.action, r.entityId, r.field])).toEqual([
      ["viewAs.stop", "reva", "Вышел срок просмотра"],
      ["viewAs.start", "fatyanov", "Смотреть как"],
    ]);
  });

  it("выход из ресурса после конца просмотра пишет конец один раз; после «Выйти из просмотра» второй записи нет", async () => {
    await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    try {
      expect(await settle(() => logout())).toBe("redirect");
    } finally {
      await prisma.person.update({ where: { slug: "reva" }, data: { active: true } });
    }
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    expect((await viewAsAudit()).map((r) => [r.action, r.field])).toEqual([
      ["viewAs.start", "Смотреть как"],
      ["viewAs.stop", "Человек выключен"],
    ]);

    auditMark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    const cookie = http.cookies.get(VIEW_AS_COOKIE)!;
    expect(await settle(() => viewAs.stopViewAsAction())).toBe("redirect");
    // Та же cookie вернулась (вторая вкладка прислала старую): конец уже записан, второй записи нет
    http.cookies.set(VIEW_AS_COOKIE, cookie);
    await prisma.person.update({ where: { slug: "reva" }, data: { active: false } });
    try {
      expect(await settle(() => logout())).toBe("redirect");
    } finally {
      await prisma.person.update({ where: { slug: "reva" }, data: { active: true } });
    }
    expect((await viewAsAudit()).map((r) => [r.action, r.field])).toEqual([
      ["viewAs.start", "Смотреть как"],
      ["viewAs.stop", "Выйти из просмотра"],
    ]);
  });

  it("cookie другой сессии не мешает и не закрывает изменения; завершённый вход пишет конец при новом входе", async () => {
    const { person: owner, sid } = await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    const cookie = http.cookies.get(VIEW_AS_COOKIE)!;
    const session = http.cookies.get(SESSION_COOKIE)!;

    // Другой браузер владельца с той же cookie просмотра: она привязана к записи устройства и здесь не в счёт
    await signIn("muradyan", { management: true });
    http.cookies.set(VIEW_AS_COOKIE, cookie);
    const other = await requireWriteContext();
    expect([other.person.slug, other.viewAs, other.viewAsEnded]).toEqual(["muradyan", null, null]);

    // Вход с просмотром завершили: страницы уводят на вход, а при новом входе в этом браузере пишется конец просмотра
    http.cookies.set(SESSION_COOKIE, session);
    await prisma.deviceSession.update({ where: { id: sid! }, data: { revokedAt: new Date(), revokedBy: "owner" } });
    await expect(requireContext()).rejects.toSatisfy(isRedirectError);
    await closeViewAs("login");
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    const [, stop] = await viewAsAudit();
    expect(stop).toMatchObject({ action: "viewAs.stop", actorId: owner.id, entityId: "reva", field: "Вход завершён" });
  });
});

describe("очередь «Ждёт вас» в просмотре", () => {
  // Этап 76: встречи один на один удалены вместе с событиями, исключений для просмотра в очереди больше нет: владелец
  // видит на «Моей неделе» выбранного человека ту же очередь и тот же счётчик, что и он сам
  it("события выбранного человека видны на «Моей неделе» и в счётчике так же, как ему самому", async () => {
    const reva = await person("reva");
    const events = await Promise.all([
      prisma.inboxEvent.create({ data: { recipientId: reva.id, kind: "TEAM", subject: "team:view-as-queue", text: "Событие о команде" } }),
      prisma.inboxEvent.create({ data: { recipientId: reva.id, kind: "MEETING", subject: "meeting:view-as-queue", text: "Протокол встречи" } }),
    ]);
    try {
      await signIn("reva");
      const self = await requireContext();
      // Только события этого теста: в очереди Ревы могут лежать события из других файлов тестов
      const mine = (items: { subject: string | null }[]) => items.map((i) => i.subject).filter((s) => s?.endsWith(":view-as-queue")).sort();
      const own = await listInbox(reva.id, new Date(), subjectOf(self));
      expect(mine(own.items)).toEqual(["meeting:view-as-queue", "team:view-as-queue"]);

      await signIn("muradyan", { management: true });
      expect(await startAs("reva")).toBe("redirect");
      const ctx = await requireContext();
      expect(subjectOf(ctx).viewAs).toBe(true);
      const seen = await listInbox(reva.id, new Date(), subjectOf(ctx));
      expect(mine(seen.items)).toEqual(["meeting:view-as-queue", "team:view-as-queue"]);
      expect(await inboxCount(reva.id, new Date(), subjectOf(ctx))).toBe(await inboxCount(reva.id, new Date(), subjectOf(self)));
    } finally {
      await prisma.inboxEvent.deleteMany({ where: { id: { in: events.map((e) => e.id) } } });
    }
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
/** Сам просмотр: выбор и начало отвечают «сначала выйдите из просмотра», выход (кнопкой и перед выходом из ресурса) проверен отдельно */
const SPECIAL = new Set(["viewAsPeopleAction", "startViewAsAction", "stopViewAsAction", "endViewAsForLogoutAction"]);

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
    // Без метки вкладки и с меткой обычной вкладки владельца: во время просмотра отказ одинаковый
    for (const tab of [null, "self"]) {
      if (tab) http.headers.set("x-weekly-view", tab);
      for (const { file, mod } of modules) {
        for (const [name, fn] of Object.entries(mod)) {
          if (typeof fn !== "function" || PUBLIC.has(name)) continue;
          seen.add(name);
          if (SPECIAL.has(name)) continue;
          // Чтение без аргументов: ответ «не найдено» вместо шума в логе, запись с любыми аргументами
          const outcome = await outcomeOf(fn as never, READ.has(name) ? [] : undefined);
          if (READ.has(name)) {
            if (outcome === "denied") wrong.push(`${file} ${name} (${tab ?? "без метки"}): чтение отказало в просмотре`);
          } else if (outcome !== "denied") wrong.push(`${file} ${name} (${tab ?? "без метки"}): ${outcome}`);
        }
      }
      http.headers.delete("x-weekly-view");
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

    // Этап 72 открыл рынок режиму управления: в просмотре от лица человека без доступа данные рынка закрыты
    const marketData = await marketDataGet();
    expect(marketData.status).toBe(403);

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

describe("метка вкладки в запросах", () => {
  it("во время просмотра отказ и с меткой обычной вкладки; после «Выйти из просмотра» старая вкладка просмотра не пишет, обычная пишет", async () => {
    await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    const id = (await requireContext()).viewAs!.id;
    expect(await withTab(`view:${id}`, () => markSeenAction())).toEqual({ ok: false, error: VIEW_AS_DENIED });
    expect(await withTab("self", () => markSeenAction())).toEqual({ ok: false, error: VIEW_AS_DENIED });
    expect(await withTab(`view:${id}`, () => exitManagement())).toEqual({ error: VIEW_AS_DENIED });

    // Выход кнопкой в другой вкладке: cookie снята, а старая вкладка с меткой просмотра всё ещё открыта
    expect(await settle(() => viewAs.stopViewAsAction())).toBe("redirect");
    expect(await withTab(`view:${id}`, () => markSeenAction())).toEqual({ ok: false, error: VIEW_AS_ENDED });
    await expect(withTab(`view:${id}`, () => requireWriteContext())).rejects.toThrow(VIEW_AS_ENDED);
    // Новый просмотр: вкладка прежнего просмотра тоже не пишет
    expect(await startAs("fatyanov")).toBe("redirect");
    expect(await withTab(`view:${id}`, () => markSeenAction())).toEqual({ ok: false, error: VIEW_AS_ENDED });
    expect(await settle(() => viewAs.stopViewAsAction())).toBe("redirect");
    // Обычная вкладка и запрос без метки пишут как раньше
    expect((await withTab("self", () => markSeenAction())).ok).toBe(true);
    expect((await markSeenAction()).ok).toBe(true);
  });

  it("включить режим управления после конца просмотра не мешает отказ просмотра; выгрузка в Excel после конца закрыта", async () => {
    const { person: owner, sid, grant } = await signIn("muradyan", { management: true });
    const reva = await person("reva");
    const past = Date.now() - 60_000;
    http.cookies.set(VIEW_AS_COOKIE, await signViewAs({ id: "view-manage", ownerId: owner.id, sid: sid!, targetId: reva.id, until: past, grant }, SECRET, past - 3_600_000));
    await expectEnded("expired");
    const form = new FormData();
    form.set("password", "не тот пароль");
    const entered = await enterManagement(null, form);
    expect([VIEW_AS_DENIED, VIEW_AS_ENDED]).not.toContain(entered?.error);
    const exported = await exportExcelGet();
    expect(exported.status).toBe(403);
    expect(await exported.text()).toBe(VIEW_AS_ENDED);
  });

  it("команда, выбранная в просмотре, не меняет команду владельца и уходит вместе с просмотром", async () => {
    await signIn("muradyan", { management: true });
    http.cookies.set("team", "top");
    expect(await startAs("reva")).toBe("redirect");
    expect(await setTeamAction("top")).toEqual({ ok: true });
    expect([http.cookies.get("team"), http.cookies.get("team_view")]).toEqual(["top", "top"]);
    expect(await settle(() => viewAs.stopViewAsAction())).toBe("redirect");
    expect([http.cookies.get("team"), http.cookies.has("team_view")]).toEqual(["top", false]);
  });
});

describe("вход общим логином", () => {
  it("ведёт на выбор профиля и без cookie просмотра, и после просмотра владельца в этом браузере (просмотр закрывается)", async () => {
    const key = PASSWORD_SETTING_KEYS.team;
    const previous = await prisma.setting.findUnique({ where: { key } });
    await prisma.setting.upsert({ where: { key }, update: { value: await hashPassword("общий пароль для проверки") }, create: { key, value: await hashPassword("общий пароль для проверки") } });
    const form = () => {
      const f = new FormData();
      f.set("login", "team");
      f.set("password", "общий пароль для проверки");
      return f;
    };
    const target = async () => {
      try {
        await login(null, form());
      } catch (error) {
        return (error as { digest?: string }).digest ?? "";
      }
      return "не было перехода";
    };
    try {
      // Новый браузер: никаких cookie
      http.cookies.clear();
      expect(await target()).toContain(";/choose;");
      expect(http.cookies.has(SESSION_COOKIE)).toBe(true);
      expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);

      // В этом браузере владелец смотрел как Рева: общий вход закрывает просмотр и тоже ведёт на выбор профиля
      await signIn("muradyan", { management: true });
      expect(await startAs("reva")).toBe("redirect");
      expect(await target()).toContain(";/choose;");
      expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
      expect(await stops()).toEqual(["Вход завершён"]);
    } finally {
      if (previous) await prisma.setting.update({ where: { key }, data: { value: previous.value as string } });
      else await prisma.setting.delete({ where: { key } });
      await prisma.loginAttempt.deleteMany({ where: { kind: "TEAM" } });
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

  it("выход из ресурса из меню: сначала снимается просмотр, и черновики самого владельца сервер уже принимает", async () => {
    const { person: owner } = await signIn("muradyan", { management: true });
    expect(await startAs("reva")).toBe("redirect");
    expect(await viewAs.endViewAsForLogoutAction()).toEqual({ ok: true });
    expect(http.cookies.has(VIEW_AS_COOKIE)).toBe(false);
    const ctx = await requireWriteContext();
    expect([ctx.person.slug, ctx.viewAs, ctx.viewAsEnded]).toEqual(["muradyan", null, null]);
    expect((await viewAsAudit()).map((r) => [r.action, r.actorId, r.field])).toEqual([
      ["viewAs.start", owner.id, "Смотреть как"],
      ["viewAs.stop", owner.id, "Выход из ресурса"],
    ]);
    // Обычный выход после этого второй записи о конце не делает
    expect(await settle(() => logout())).toBe("redirect");
    expect(await viewAsAudit()).toHaveLength(2);
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
