// Этап 72: обработчик данных рынка на настоящей базе. Вход подменён, правило доступа и пакет настоящие: по общему
// логину и в режиме управления данные получает и человек не из списка, при личном входе без режима 403 без цифр.
// Этап 82: ответ уходит сжатым, но браузер его не хранит (no-store, без отпечатков); право на раздел проверяется
// на каждом запросе заново. Пакет синтетический: tests/fixtures/market/bundle.json
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

describe("сжатие ответа и проверка права на каждом запросе", () => {
  it("ответ сжат и не кэшируется браузером; сжатие считается один раз на версию пакета", async () => {
    const owner = await tasks.actorFor("muradyan", null);
    await uploadMarketBundle({ ...owner, via: "PASSWORD" }, parseBundle(FIXTURE), 100);
    state.ctx = { person: { id: owner.personId, role: "OWNER" }, via: "PASSWORD" };

    const first = await ask({ "accept-encoding": "gzip" });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-encoding")).toBe("gzip");
    expect(first.headers.get("cache-control")).toBe("no-store");
    expect(first.headers.get("etag")).toBeNull();
    expect(first.headers.get("vary")).toBe("Accept-Encoding");
    const packed = Buffer.from(await first.arrayBuffer());
    const plain = gunzipSync(packed);
    const body = JSON.parse(plain.toString("utf8")) as { ok: boolean; datasets: Record<string, unknown[]> };
    expect(body.ok).toBe(true);
    expect(body.datasets.k_demo).toHaveLength(3);
    // Сжатый ответ заметно короче исходного
    expect(packed.byteLength).toBeLessThan(plain.byteLength);

    // Повторный заход: снова полный ответ, 304 не бывает
    const again = await ask({ "accept-encoding": "gzip", "if-none-match": '"m1-1"' });
    expect(again.status).toBe(200);
    expect(Buffer.from(await again.arrayBuffer()).byteLength).toBe(packed.byteLength);

    // Браузер без сжатия получает те же цифры обычным текстом
    const plainRes = await ask({ "accept-encoding": "identity" });
    expect(plainRes.headers.get("content-encoding")).toBeNull();
    expect(((await plainRes.json()) as { datasets: Record<string, unknown[]> }).datasets.k_demo).toHaveLength(3);
  });

  it("человека убрали из списка или выключили профиль: следующий запрос 403 без цифр, по общему логину данные остаются", async () => {
    const owner = await tasks.actorFor("muradyan", null);
    await uploadMarketBundle({ ...owner, via: "PASSWORD" }, parseBundle(FIXTURE), 100);
    await prisma.setting.create({ data: { key: MARKET_ACCESS_KEY, value: { people: ["reva"] } } });
    const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" }, select: { id: true, role: true } });

    state.ctx = { person: reva, via: "PASSWORD" };
    const open = await ask({ "accept-encoding": "gzip" });
    expect(open.status).toBe(200);

    // Убрали из списка: пакет он больше не получает, хотя только что получил
    await prisma.setting.update({ where: { key: MARKET_ACCESS_KEY }, data: { value: { people: [] } } });
    const closed = await ask({ "accept-encoding": "gzip" });
    expect(closed.status).toBe(403);
    expect(closed.headers.get("cache-control")).toBe("no-store");
    expect(await closed.text()).not.toContain("k_demo");

    // Вернули в список, но выключили профиль: тоже 403
    await prisma.setting.update({ where: { key: MARKET_ACCESS_KEY }, data: { value: { people: ["reva"] } } });
    expect((await ask()).status).toBe(200);
    await prisma.person.update({ where: { id: reva.id }, data: { active: false } });
    const off = await ask({ "accept-encoding": "gzip" });
    expect(off.status).toBe(403);
    expect(await off.text()).not.toContain("k_demo");
    await prisma.person.update({ where: { id: reva.id }, data: { active: true } });

    // По общему логину раздел открыт любому выбранному профилю, даже не из списка
    const loginova = await prisma.person.findUniqueOrThrow({ where: { slug: "loginova" }, select: { id: true, role: true } });
    state.ctx = { person: loginova, via: "TEAM" };
    expect((await ask({ "accept-encoding": "gzip" })).status).toBe(200);
  });
});
