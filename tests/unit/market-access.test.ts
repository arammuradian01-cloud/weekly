// Этап 72: рынок по общему логину и сохранение доступа. Решение Арама 23.10: вход по общему логину открывает раздел
// «Рынок» любому выбранному профилю, при личном входе видят владельцы и люди из списка, загружает пакет только
// владелец при личном входе. Страница и обработчик данных проверяют доступ сами по настоящему правилу (база
// подменена), а не по меню. Тексты строки «Не сохранено», счётчика и уведомления, ссылки, которые уводят со страницы
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { redirect } from "next/navigation";

type Person = { slug: string; role: string; active: boolean };
const state = vi.hoisted(() => ({
  people: {} as Record<string, Person>,
  access: null as null | { people: string[] },
  ctx: null as null | { person: { id: string; role: string }; via: string },
  body: { stamp: "1-1", version: 1, body: '{"ok":true,"version":1,"files":{},"datasets":{"k_demo":[]}}' } as null | { stamp: string; version: number; body: string },
  reads: [] as string[],
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    person: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        state.reads.push(`person:${where.id}`);
        return state.people[where.id] ?? null;
      },
    },
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        state.reads.push(`setting:${where.key}`);
        return where.key === "market.access" && state.access ? { key: where.key, value: state.access } : null;
      },
    },
  },
}));
vi.mock("@/lib/auth", () => ({
  requireContext: async () => {
    if (!state.ctx) redirect("/login");
    return state.ctx;
  },
}));
vi.mock("@/lib/market/service", () => ({
  marketDataBody: async () => state.body,
  marketMeta: async () => (state.body ? { stamp: state.body.stamp, version: state.body.version, uploadedAt: "2026-10-22T10:00:00.000Z", uploadedBy: "Мурадян Арам" } : null),
}));
vi.mock("@/components/market/market-frame", () => ({ MarketFrame: function MarketFrame() { return null; } }));
vi.mock("@/components/market/market-upload", () => ({ MarketUpload: function MarketUpload() { return null; } }));

const { GET } = await import("@/app/api/market/data/route");
const { default: MarketPage } = await import("@/app/(app)/market/page");
const { canSeeMarket, canSeeMarketEvents } = await import("@/lib/market/access");
const { LEAVE_TEXT, isDirty, leavesPage, listDiff, marketCountText, marketSavedText, unsavedText } = await import("@/lib/market/draft");

/** Все элементы дерева страницы без отрисовки: тип и свойства */
function walk(node: ReactNode, out: { type: unknown; props: Record<string, unknown> }[] = []) {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (isValidElement(node)) {
    const props = node.props as Record<string, unknown>;
    out.push({ type: node.type, props });
    walk(props.children as ReactNode, out);
    for (const value of Object.values(props)) if (isValidElement(value)) walk(value, out);
  }
  return out;
}
const typeName = (t: unknown) => (typeof t === "function" ? t.name : String(t));
const page = async () => walk((await MarketPage({ searchParams: Promise.resolve({}) })) as ReactNode);

beforeEach(() => {
  state.people = {
    p1: { slug: "muradyan", role: "OWNER", active: true },
    p2: { slug: "reva", role: "LEADER", active: true },
    p3: { slug: "loginova", role: "LEADER", active: true },
    p4: { slug: "golovkin", role: "ADMIN", active: true },
    p5: { slug: "ceo", role: "OBSERVER", active: true },
    p6: { slug: "off", role: "LEADER", active: false },
  };
  state.access = { people: ["reva"] };
  state.ctx = null;
  state.reads = [];
  state.body = { stamp: "1-1", version: 1, body: '{"ok":true,"version":1,"files":{},"datasets":{"k_demo":[]}}' };
});

describe("правило по базе", () => {
  it("общий логин видит любым включённым профилем, список не читается; выключенный профиль нет", async () => {
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) expect(await canSeeMarket({ personId: id, via: "TEAM" }), id).toBe(true);
    expect(state.reads.filter((r) => r.startsWith("setting:"))).toEqual([]);
    expect(await canSeeMarket({ personId: "p6", via: "TEAM" })).toBe(false);
    expect(await canSeeMarket({ personId: "nobody", via: "TEAM" })).toBe(false);
  });

  it("личный вход: владелец и человек из списка, остальные нет; без способа входа нет", async () => {
    expect(await canSeeMarket({ personId: "p1", via: "PASSWORD" })).toBe(true);
    expect(await canSeeMarket({ personId: "p2", via: "EMAIL" })).toBe(true);
    expect(await canSeeMarket({ personId: "p3", via: "PASSWORD" })).toBe(false);
    expect(await canSeeMarket({ personId: "p4", via: "INVITE" })).toBe(false);
    expect(await canSeeMarket({ personId: "p5", via: "PASSWORD" })).toBe(false);
    expect(await canSeeMarket({ personId: "p1", via: null })).toBe(false);
    // Роль читается из базы на каждом запросе: сделали владельцем, видит сразу без списка
    state.people.p4 = { ...state.people.p4!, role: "OWNER" };
    expect(await canSeeMarket({ personId: "p4", via: "PASSWORD" })).toBe(true);
  });

  it("события рынка в журнале по правилу личного входа: общий логин их не видит", async () => {
    expect(await canSeeMarketEvents({ personId: "p1", via: "PASSWORD" })).toBe(true);
    expect(await canSeeMarketEvents({ personId: "p2", via: "PASSWORD" })).toBe(true);
    expect(await canSeeMarketEvents({ personId: "p1", via: "TEAM" })).toBe(false);
    expect(await canSeeMarketEvents({ personId: "p3", via: "PASSWORD" })).toBe(false);
  });
});

describe("обработчик данных и страница сами проверяют доступ", () => {
  it("общий логин: данные отдаются человеку не из списка; при личном входе ему 403 без цифр", async () => {
    state.ctx = { person: { id: "p3", role: "LEADER" }, via: "TEAM" };
    const open = await GET();
    expect(open.status).toBe(200);
    expect(open.headers.get("cache-control")).toBe("no-store");
    expect(await open.json()).toMatchObject({ ok: true, version: 1 });

    state.ctx = { person: { id: "p3", role: "LEADER" }, via: "PASSWORD" };
    const closed = await GET();
    expect(closed.status).toBe(403);
    expect(await closed.text()).not.toContain("k_demo");

    // Выключенный профиль по общему логину тоже 403
    state.ctx = { person: { id: "p6", role: "LEADER" }, via: "TEAM" };
    expect((await GET()).status).toBe(403);
  });

  it("страница: по общему логину дашборд без кнопки загрузки, даже у владельца; закрыто только при личном входе не из списка", async () => {
    state.ctx = { person: { id: "p3", role: "LEADER" }, via: "TEAM" };
    let tree = await page();
    expect(tree.some((e) => typeName(e.type) === "MarketFrame")).toBe(true);
    expect(tree.some((e) => e.props["data-testid"] === "market-closed")).toBe(false);
    expect(tree.some((e) => typeName(e.type) === "MarketUpload")).toBe(false);

    state.ctx = { person: { id: "p1", role: "OWNER" }, via: "TEAM" };
    tree = await page();
    expect(tree.some((e) => typeName(e.type) === "MarketFrame")).toBe(true);
    expect(tree.some((e) => typeName(e.type) === "MarketUpload")).toBe(false);

    state.ctx = { person: { id: "p1", role: "OWNER" }, via: "PASSWORD" };
    tree = await page();
    expect(tree.some((e) => typeName(e.type) === "MarketUpload")).toBe(true);

    state.ctx = { person: { id: "p3", role: "LEADER" }, via: "PASSWORD" };
    tree = await page();
    expect(tree.some((e) => e.props["data-testid"] === "market-closed")).toBe(true);
    expect(tree.some((e) => typeName(e.type) === "MarketFrame")).toBe(false);
    // Подписи «только при личном входе» больше нет
    expect(tree.some((e) => typeof e.props.stage === "string")).toBe(false);
  });
});

describe("строка «Не сохранено» и тексты", () => {
  it("считает добавленных и убранных без учёта порядка", () => {
    expect(listDiff(["a", "b", "c"], ["a"])).toEqual({ add: 2, remove: 0 });
    expect(listDiff(["b"], ["a", "b"])).toEqual({ add: 0, remove: 1 });
    expect(listDiff(["b", "a"], ["a", "b"])).toEqual({ add: 0, remove: 0 });
    expect(isDirty(listDiff(["b", "a"], ["a", "b"]))).toBe(false);
    expect(isDirty(listDiff(["x"], ["a"]))).toBe(true);
    expect(unsavedText({ add: 6, remove: 0 })).toBe("Не сохранено: добавить 6");
    expect(unsavedText({ add: 0, remove: 1 })).toBe("Не сохранено: убрать 1");
    expect(unsavedText({ add: 2, remove: 1 })).toBe("Не сохранено: добавить 2, убрать 1");
  });

  it("счётчик про личный вход, общий логин отдельно и только пока он включён; уведомление после сохранения", () => {
    expect(marketCountText(2, 1, true)).toBe("Сейчас раздел видят 2 человека, из них владельцев 1, плюс все, кто входит по общему логину.");
    expect(marketCountText(7, 1, false)).toBe("Сейчас раздел видят 7 человек, из них владельцев 1.");
    expect(marketCountText(1, 1, false)).toBe("Сейчас раздел видит 1 человек, из них владельцев 1.");
    expect(marketSavedText(7)).toBe("Доступ к рынку сохранён: раздел видят 7 человек");
    expect(marketSavedText(21)).toBe("Доступ к рынку сохранён: раздел видит 21 человек");
    for (const text of [marketCountText(2, 1, true), marketSavedText(3), unsavedText({ add: 1, remove: 1 }), LEAVE_TEXT]) expect(text).not.toMatch(/[—–→·]/);
  });

  it("со страницы уводят ссылки на другой путь или параметры этого сайта; якорь и чужой сайт нет", () => {
    const at = "http://localhost:3100/settings#market";
    expect(leavesPage("/tasks", at)).toBe(true);
    expect(leavesPage("http://localhost:3100/", at)).toBe(true);
    expect(leavesPage("/settings?tab=x", at)).toBe(true);
    expect(leavesPage("#people", at)).toBe(false);
    expect(leavesPage("/settings#login", at)).toBe(false);
    expect(leavesPage("https://example.com/", at)).toBe(false);
    expect(leavesPage("http://[bad", at)).toBe(false);
  });
});
