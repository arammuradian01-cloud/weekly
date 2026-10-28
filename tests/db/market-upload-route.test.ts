// Этап 83: обработчик загрузки пакета рынка на настоящей базе. Проверяется путь целиком: сжатый файл .json.gz
// приходит телом запроса, распаковывается потоком, проверяется и ложится в базу, а прежний пакет заменяется.
// Вход подменён, право на загрузку и запись в базу настоящие. Пакет синтетический: tests/fixtures/market/bundle.json
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ actor: null as null | Record<string, unknown> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  readSession: async () => ({ personId: "p1", sid: "d1" }),
  requestIp: async () => "127.0.0.1",
}));
vi.mock("@/lib/action-runner", () => ({ writingActor: async () => state.actor, currentActor: async () => state.actor }));

const { prisma } = await import("@/lib/db");
const tasks = await import("@/lib/tasks/service");
const { marketMeta, marketPayload, resetMarketBodyCache } = await import("@/lib/market/service");
const { POST } = await import("@/app/api/market/upload/route");

const FIXTURE = readFileSync("tests/fixtures/market/bundle.json");

async function reset() {
  await prisma.marketDataset.deleteMany();
  await prisma.marketBundle.deleteMany();
  resetMarketBodyCache();
}

beforeEach(async () => {
  await reset();
  state.actor = { ...(await tasks.actorFor("muradyan", null)), via: "PASSWORD" };
});
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

const send = (body: Uint8Array, headers: Record<string, string> = {}) =>
  POST(new Request("http://localhost:3000/api/market/upload", { method: "POST", headers: { "content-type": "application/json", "content-length": String(body.byteLength), ...headers }, body, duplex: "half" } as RequestInit));

describe("загрузка сжатого пакета в базу", () => {
  it("файл .json.gz распаковывается, проверяется и ложится в базу, размером считается распакованный пакет", async () => {
    const packed = gzipSync(FIXTURE);
    expect(packed.byteLength).toBeLessThan(FIXTURE.byteLength);
    const res = await send(new Uint8Array(packed));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, value: { datasetsCount: 2, rowsTotal: 6, version: 1 } });

    const meta = await marketMeta();
    expect(meta).toMatchObject({ datasetsCount: 2, rowsTotal: 6, uploadedBy: "Мурадян Арам" });
    expect(await prisma.marketBundle.findFirst({ select: { bytes: true } })).toEqual({ bytes: FIXTURE.byteLength });
    const payload = await marketPayload();
    expect(Object.keys(payload!.files).sort()).toEqual(["app.js", "d3.min.js", "index.html"]);
    expect(payload!.datasets.k_demo).toHaveLength(3);
  });

  it("сжатый пакет заменяет прежний обычный: версия растёт, старые наборы уходят", async () => {
    expect((await send(new Uint8Array(FIXTURE))).status).toBe(200);
    const trimmed = JSON.parse(FIXTURE.toString("utf8")) as { datasets: Record<string, unknown> };
    delete trimmed.datasets.o_demo;
    const res = await send(new Uint8Array(gzipSync(Buffer.from(JSON.stringify(trimmed), "utf8"))), { "content-encoding": "gzip" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, value: { datasetsCount: 1, version: 2 } });
    expect((await prisma.marketDataset.findMany({ select: { name: true } })).map((d) => d.name)).toEqual(["k_demo"]);
  });

  it("битый сжатый файл: 400, в базе остаётся прежний пакет", async () => {
    expect((await send(new Uint8Array(FIXTURE))).status).toBe(200);
    const packed = gzipSync(FIXTURE);
    const cut = new Uint8Array(packed.subarray(0, Math.floor(packed.byteLength / 2)));
    const res = await send(cut);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Сжатый файл не распаковывается/);
    expect((await marketMeta())!.version).toBe(1);
  });

  it("загружает только владелец при личном входе: общий логин получает отказ до базы", async () => {
    state.actor = { ...(await tasks.actorFor("muradyan", null)), via: "TEAM" };
    const res = await send(new Uint8Array(gzipSync(FIXTURE)));
    expect(res.status).toBe(403);
    expect(await marketMeta()).toBeNull();
  });
});
