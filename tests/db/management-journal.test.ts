// Журнал режима управления при личном входе: «Неверный пароль режима управления» пишется только за настоящую
// неудачную попытку пароля. Отказ правила (настройка пароля повреждена, личный пароль ещё не задан, нужен личный
// вход) не попытка подбора, и в журнале его нет; блокировка пишется отдельным событием.
// cookie и заголовки запроса подменены: вход читает подписанные cookie так же, как на сервере.
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
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { getEpochs, setSetting } from "@/lib/settings";
import { PASSWORD_SETTING_KEYS, hashPassword } from "@/lib/passwords";
import { setManagementPasswordMode } from "@/lib/login/management-password";
import { enterManagement } from "@/app/actions/auth";

const SECRET = process.env.SESSION_SECRET!;
const SHARED = "Общий пароль владельцев для проверки 2026";
const PERSONAL = "Личный пароль владельца для проверки 2026";
const slug = "test-management-journal-owner";
const deviceId = "test-management-journal-device";
const policyKey = `auth.management.person.${slug}`;
let savedShared: string | null = null;
let mark = BigInt(0);

async function clean() {
  await prisma.setting.deleteMany({ where: { key: policyKey } });
  await prisma.deviceSession.deleteMany({ where: { id: deviceId } });
  await prisma.person.deleteMany({ where: { id: slug } });
  await prisma.loginAttempt.deleteMany({ where: { ip: { startsWith: "10.92." } } });
}

/** Отказ действия или адрес перехода: после успеха это переход на страницу, ради которой включали режим */
async function enter(password: string): Promise<string> {
  const form = new FormData();
  form.set("password", password);
  try {
    const result = await enterManagement(null, form);
    return `отказ: ${String(result?.error ?? "")}`;
  } catch (error) {
    if (isRedirectError(error)) return `переход ${String((error as { digest?: string }).digest ?? "").split(";")[2] ?? ""}`;
    throw error;
  }
}

/** События журнала режима управления после метки */
async function journal(): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({ where: { id: { gt: mark }, action: { startsWith: "management." } }, select: { action: true }, orderBy: { id: "asc" } });
  return rows.map((r) => r.action);
}

beforeAll(async () => {
  const row = await prisma.setting.findUnique({ where: { key: PASSWORD_SETTING_KEYS.owner } });
  savedShared = typeof row?.value === "string" ? row.value : null;
  await setSetting(PASSWORD_SETTING_KEYS.owner, await hashPassword(SHARED));
});

beforeEach(async () => {
  await clean();
  const passwordSetAt = new Date();
  await prisma.person.create({ data: { id: slug, slug, fullName: "Проверочный владелец", shortName: "Проверочный", zone: "", role: "OWNER", passwordHash: await hashPassword(PERSONAL), passwordSetAt } });
  await prisma.deviceSession.create({ data: { id: deviceId, personId: slug, method: "PASSWORD", expiresAt: new Date(Date.now() + 86_400_000) } });
  const { epoch } = await getEpochs();
  http.cookies.clear();
  http.cookies.set(SESSION_COOKIE, await signSession({ epoch, personId: slug, sid: deviceId, via: "PASSWORD" }, SECRET));
  mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
});

afterEach(() => clean());

afterAll(async () => {
  if (savedShared === null) await prisma.setting.deleteMany({ where: { key: PASSWORD_SETTING_KEYS.owner } });
  else await setSetting(PASSWORD_SETTING_KEYS.owner, savedShared);
  await prisma.$disconnect();
});

describe("журнал режима управления", () => {
  it("неверный пароль пишется как неудачная попытка, верный как вход в режим", async () => {
    expect(await enter("совсем не тот пароль")).toMatch(/Неверный пароль/);
    expect(await journal()).toEqual(["management.fail"]);
    expect(await enter(SHARED)).toBe("переход /");
    expect(await journal()).toEqual(["management.fail", "management.enter"]);
  });

  it("неверный личный пароль тоже неудачная попытка", async () => {
    await setManagementPasswordMode(slug, "personal");
    mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    expect(await enter("совсем не тот пароль")).toMatch(/пароль неверный/);
    expect(await journal()).toEqual(["management.fail"]);
  });

  it("повреждённая настройка пароля: отказ без записи о неверном пароле", async () => {
    await setSetting(policyKey, { mode: "неизвестный режим" });
    mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await enter(SHARED)).toMatch(/повреждена/);
      expect(await enter(PERSONAL)).toMatch(/повреждена/);
    } finally {
      logged.mockRestore();
    }
    expect(await journal()).toEqual([]);
  });

  it("личный пароль ещё не задан: отказ без записи о неверном пароле", async () => {
    await setManagementPasswordMode(slug, "personal");
    await prisma.person.update({ where: { id: slug }, data: { passwordHash: null, passwordSetAt: null } });
    mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    expect(await enter(PERSONAL)).toMatch(/ещё не задан/);
    expect(await journal()).toEqual([]);
  });

  it("вход на устройстве завершён: экран входа, записи о неверном пароле нет", async () => {
    await setManagementPasswordMode(slug, "personal");
    mark = (await prisma.auditLog.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    await prisma.deviceSession.update({ where: { id: deviceId }, data: { revokedAt: new Date() } });
    expect(await enter(PERSONAL)).toBe("переход /login?ended=1");
    expect(await journal()).toEqual([]);
  });
});
