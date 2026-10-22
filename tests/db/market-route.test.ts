// Этап 72: обработчик данных рынка на настоящей базе. Вход подменён, правило доступа и пакет настоящие: по общему
// логину данные получает и человек не из списка, при личном входе он получает 403 без цифр. Пакет синтетический:
// tests/fixtures/market/bundle.json
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const state = vi.hoisted(() => ({ ctx: null as null | { person: { id: string; role: string }; via: string } }));
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
  });
});
