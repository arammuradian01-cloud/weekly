// Этап 62: обработчики рынка без базы и без сервера. Загрузка пакета идёт мимо proxy, поэтому обработчик сам
// проверяет адрес страницы, вход, права и размер до чтения тела и обрывает чтение на 25 МБ. Данные рынка браузер не
// кэширует: no-store, без ETag и 304. Вход, доступ и база подменены
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/tasks/service";

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  actor: null as null | Record<string, unknown> | "redirect",
  seesMarket: true,
  uploads: [] as { bytes: number; datasets: number }[],
  body: null as null | { stamp: string; version: number; body: string },
}));

vi.mock("@/lib/auth", () => ({
  readSession: async () => state.session,
  requireContext: async () => {
    if (!state.session) redirect("/login");
    return { person: { id: "p1", role: "OWNER" }, via: "PASSWORD" };
  },
}));
vi.mock("@/lib/action-runner", () => ({
  currentActor: async () => {
    // Устройство отозвано или профиль выключен: вход перенаправляет на экран входа
    if (state.actor === "redirect") redirect("/login?ended=1");
    return state.actor;
  },
}));
vi.mock("@/lib/market/access", async (original) => ({ ...(await original<typeof import("@/lib/market/access")>()), canSeeMarket: async () => state.seesMarket }));
vi.mock("@/lib/market/service", () => ({
  MARKET_UPLOAD_ONLY: "Пакет рынка загружает владелец при личном входе",
  uploadMarketBundle: async (_actor: Actor, bundle: { datasetsCount: number }, bytes: number) => {
    state.uploads.push({ bytes, datasets: bundle.datasetsCount });
    return { version: 1, uploadedAt: "2026-10-22T10:00:00.000Z", datasetsCount: bundle.datasetsCount, rowsTotal: 6, uploadedBy: "Мурадян Арам", stamp: "1-1" };
  },
  marketDataBody: async () => state.body,
}));

const { POST } = await import("@/app/api/market/upload/route");
const { GET } = await import("@/app/api/market/data/route");

const FIXTURE = readFileSync("tests/fixtures/market/bundle.json");
const MB = 1024 * 1024;
const owner = { personId: "p1", slug: "muradyan", fullName: "Мурадян Арам", role: "OWNER", management: null, ip: "127.0.0.1", via: "PASSWORD" };

/** Тело запроса, которое считает, сколько из него прочитано: чтение идёт только по запросу обработчика */
function countingBody(total: number, chunk = MB) {
  const seen = { bytes: 0, pulls: 0 };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        seen.pulls++;
        if (seen.bytes >= total) return controller.close();
        const n = Math.min(chunk, total - seen.bytes);
        seen.bytes += n;
        controller.enqueue(new Uint8Array(n).fill(32));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, seen };
}

function upload(body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  return POST(new Request("http://localhost:3000/api/market/upload", { method: "POST", headers: { "content-type": "application/json", ...headers }, body, duplex: "half" } as RequestInit));
}

beforeEach(() => {
  state.session = { personId: "p1", sid: "d1" };
  state.actor = owner;
  state.seesMarket = true;
  state.uploads = [];
  state.body = null;
});

describe("загрузка пакета рынка", () => {
  it("владелец при личном входе: пакет проверен и загружен, ответ без кэша", async () => {
    const res = await upload(FIXTURE, { origin: "http://localhost:3000", "content-length": String(FIXTURE.byteLength) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, value: { datasetsCount: 2, rowsTotal: 6 } });
    expect(state.uploads).toEqual([{ bytes: FIXTURE.byteLength, datasets: 2 }]);
  });

  it("чужой сайт, нет входа, вход больше не действует, не владелец: ответ сразу, тело не читается", async () => {
    const cases: [() => void, Record<string, string>, number, RegExp][] = [
      [() => undefined, { origin: "https://evil.example" }, 403, /Запрос с чужого сайта/],
      [() => (state.session = null), {}, 401, /Вход закончился/],
      [() => (state.actor = "redirect"), {}, 401, /Вход закончился/],
      [() => (state.actor = { ...owner, role: "ADMIN" }), {}, 403, /загружает владелец при личном входе/],
      [() => (state.actor = { ...owner, via: "TEAM" }), {}, 403, /загружает владелец при личном входе/],
    ];
    for (const [setup, headers, status, error] of cases) {
      state.session = { personId: "p1", sid: "d1" };
      state.actor = owner;
      setup();
      const { stream, seen } = countingBody(30 * MB);
      const res = await upload(stream, headers);
      expect(res.status, String(error)).toBe(status);
      // Без перенаправления на вход: браузер не повторяет POST с файлом
      expect(res.headers.get("location")).toBeNull();
      expect((await res.json()).error).toMatch(error);
      expect(seen.pulls, String(error)).toBe(0);
    }
    expect(state.uploads).toEqual([]);
  });

  it("размер больше 25 МБ по заголовку: 413 до чтения тела", async () => {
    const { stream, seen } = countingBody(30 * MB);
    const res = await upload(stream, { "content-length": String(26 * MB) });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("Файл больше 25 МБ: пакет рынка может быть не больше 25 МБ");
    expect(seen.pulls).toBe(0);
  });

  it("без заголовка размера чтение обрывается на 25 МБ, весь файл не читается", async () => {
    const { stream, seen } = countingBody(200 * MB);
    const res = await upload(stream);
    expect(res.status).toBe(413);
    expect(seen.bytes).toBeGreaterThan(25 * MB);
    expect(seen.bytes).toBeLessThanOrEqual(27 * MB);
    expect(state.uploads).toEqual([]);
  });

  it("ошибка проверки пакета приходит текстом", async () => {
    const res = await upload(JSON.stringify({ kind: "weekly-market-bundle", version: 1, files: { "index.html": "<p>x</p>" }, datasets: { k: { rows: [] } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/нет библиотеки графиков d3\.min\.js/);
  });
});

describe("данные рынка для окна", () => {
  it("полный ответ без кэша браузера: no-store, без ETag и 304 даже с If-None-Match", async () => {
    state.body = { stamp: "3-1", version: 3, body: '{"ok":true,"version":3,"files":{},"datasets":{}}' };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("vary")).toBeNull();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true, version: 3, files: {}, datasets: {} });
    // Обработчик не принимает запрос вовсе: отпечаток браузера ему не нужен, ответ всегда полный
    expect(GET.length).toBe(0);
  });

  it("без доступа 403 без цифр, без пакета 404, оба без кэша", async () => {
    state.body = { stamp: "3-1", version: 3, body: '{"ok":true,"datasets":{"k_demo":[]}}' };
    state.seesMarket = false;
    const closed = await GET();
    expect(closed.status).toBe(403);
    expect(closed.headers.get("cache-control")).toBe("no-store");
    expect(await closed.text()).not.toContain("k_demo");
    state.seesMarket = true;
    state.body = null;
    const empty = await GET();
    expect(empty.status).toBe(404);
    expect(empty.headers.get("cache-control")).toBe("no-store");
  });
});
