// Этап 72: обработчик данных рынка на настоящей базе. Вход подменён, правило доступа и пакет настоящие: по общему
// логину и в режиме управления данные получает и человек не из списка, при личном входе без режима 403 без цифр.
// Этап 82: ответ уходит сжатым и с отпечатком версии пакета, повторный заход получает 304, новая загрузка его
// обновляет. Пакет синтетический: tests/fixtures/market/bundle.json
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const state = vi.hoisted(() => ({ ctx: null as null | { person: { id: string; role: string }; via: string; management?: { role: string } | null } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  requireContext: async () => {
    if (!state.ctx) redirect("/login");
    return state.ctx;
  },
}));

const { prisma } = await import("@/lib/db");
const tasks = await import("@/lib/tasks/service");
const { MARKET_ACCESS_KEY } = await import("@/lib/market/access");
const { resetMarketBodyCache, uploadMarketBundle } = await import("@/lib/market/service");
const { parseBundle } = await import("@/lib/market/bundle");
const { GET } = await import("@/app/api/market/data/route");

const FIXTURE = readFileSync("tests/fixtures/market/bundle.json", "utf8");

async function reset() {
  await prisma.marketDataset.deleteMany();
  await prisma.marketBundle.deleteMany();
  await prisma.setting.deleteMany({ where: { key: MARKET_ACCESS_KEY } });
  resetMarketBodyCache();
}

beforeEach(reset);
afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

const ask = (headers: Record<string, string> = {}) => GET(new Request("https://weekly.test/api/market/data", { headers }));

describe("данные рынка по общему логину", () => {
  it("общий логин: 200 с данными человеку не из списка; личный вход: 403 без цифр; владелец лично: 200", async () => {
    const owner = await tasks.actorFor("muradyan", null);
    await uploadMarketBundle({ ...owner, via: "PASSWORD" }, parseBundle(FIXTURE), 100);
    await prisma.setting.create({ data: { key: MARKET_ACCESS_KEY, value: { people: ["reva"] } } });
    const loginova = await prisma.person.findUniqueOrThrow({ where: { slug: "loginova" }, select: { id: true, role: true } });

    state.ctx = { person: loginova, via: "TEAM" };
    const open = await GET();
    expect(open.status).toBe(200);
    const body = (await open.json()) as { ok: boolean; datasets: Record<string, unknown[]> };
    expect(body.ok).toBe(true);
    expect(body.datasets.k_demo).toHaveLength(3);

    state.ctx = { person: loginova, via: "PASSWORD" };
    const closed = await GET();
    expect(closed.status).toBe(403);
    expect(await closed.text()).not.toContain("k_demo");

    state.ctx = { person: { id: owner.personId, role: "OWNER" }, via: "PASSWORD" };
    expect((await GET()).status).toBe(200);

    // Администратор не из списка: в режиме управления 200, без режима 403
    const golovkin = await prisma.person.findUniqueOrThrow({ where: { slug: "golovkin" }, select: { id: true, role: true } });
    state.ctx = { person: golovkin, via: "PASSWORD", management: { role: "ADMIN" } };
    expect((await GET()).status).toBe(200);
    state.ctx = { person: golovkin, via: "PASSWORD", management: null };
    expect((await GET()).status).toBe(403);
  });
});

describe("сжатие и отпечаток версии пакета", () => {
  it("ответ сжат, повторный заход получает 304, после новой загрузки снова полный ответ", async () => {
    const owner = await tasks.actorFor("muradyan", null);
    await uploadMarketBundle({ ...owner, via: "PASSWORD" }, parseBundle(FIXTURE), 100);
    state.ctx = { person: { id: owner.personId, role: "OWNER" }, via: "PASSWORD" };

    const first = await ask({ "accept-encoding": "gzip" });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-encoding")).toBe("gzip");
    expect(first.headers.get("cache-control")).toContain("private");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"m\d+-\d+"$/);
    const packed = Buffer.from(await first.arrayBuffer());
    const body = JSON.parse(gunzipSync(packed).toString("utf8")) as { ok: boolean; datasets: Record<string, unknown[]> };
    expect(body.ok).toBe(true);
    expect(body.datasets.k_demo).toHaveLength(3);
    // Сжатый ответ заметно короче исходного текста
    expect(packed.byteLength).toBeLessThan(gunzipSync(packed).byteLength);

    const again = await ask({ "if-none-match": etag!, "accept-encoding": "gzip" });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");

    // Новый пакет: отпечаток другой, прежний отпечаток 304 уже не даёт
    await uploadMarketBundle({ ...owner, via: "PASSWORD" }, parseBundle(FIXTURE), 100);
    const fresh = await ask({ "if-none-match": etag!, "accept-encoding": "identity" });
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("etag")).not.toBe(etag);
    expect(((await fresh.json()) as { datasets: Record<string, unknown[]> }).datasets.k_demo).toHaveLength(3);
  });
});
