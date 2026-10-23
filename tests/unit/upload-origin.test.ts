// Этап 69: обработчики загрузок (пакет рынка и борд лидера) со своим адресом приложения. За прокси хостинга адрес
// запроса у Next внутренний (http://0.0.0.0:3000), поэтому страница с основного адреса из APP_URL и с технического
// адреса из APP_ALIASES проходит по списку, а чужой сайт и технический адрес без списка получают «Запрос с чужого
// сайта». Вход, права и сервисы подменены, адреса условные.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  assertWritable: () => undefined,
  requestViewAsTab: async () => null,
  readSession: async () => ({ personId: "p1", sid: "d1" }),
  requestIp: async () => "127.0.0.1",
}));
vi.mock("@/lib/action-runner", () => {
  const actor = async () => ({ personId: "p1", slug: "muradyan", fullName: "Мурадян Арам", role: "OWNER", management: "OWNER", ip: "127.0.0.1", via: "PASSWORD" });
  return { currentActor: actor, writingActor: actor };
});
vi.mock("@/lib/market/service", () => ({
  MARKET_UPLOAD_ONLY: "Пакет рынка загружает владелец при личном входе",
  uploadMarketBundle: async (_actor: unknown, bundle: { datasetsCount: number }) => ({ version: 1, uploadedAt: "2026-10-22T10:00:00.000Z", datasetsCount: bundle.datasetsCount, rowsTotal: 6 }),
}));
vi.mock("@/lib/goals/leader-board-service", () => ({
  LEADER_FILE_MAX: 9 * 1024 * 1024,
  LEADER_MANAGE_ONLY: "Цели из борда загружают владелец и администраторы в режиме управления",
  canLoadLeaderBoard: () => true,
  tabsFromXlsx: async () => [],
  previewLeaderBoard: async () => ({ tabs: [] }),
  applyLeaderBoard: async () => ({ tabs: [] }),
}));

const { POST: marketUpload } = await import("@/app/api/market/upload/route");
const { POST: leaderBoard } = await import("@/app/api/goals/leader-board/route");

const NEW = "https://weekly.example.ru";
const OLD = "https://app-1234.hosting.example";
const FIXTURE = readFileSync("tests/fixtures/market/bundle.json");
const DENIED = "Запрос с чужого сайта";

function market(origin: string) {
  return marketUpload(new Request("http://0.0.0.0:3000/api/market/upload", { method: "POST", headers: { origin, "content-type": "application/json", "content-length": String(FIXTURE.byteLength) }, body: FIXTURE }));
}

function board(origin: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "борд.xlsx"));
  form.set("mode", "preview");
  return leaderBoard(new Request("http://0.0.0.0:3000/api/goals/leader-board", { method: "POST", headers: { origin }, body: form }));
}

beforeEach(() => {
  vi.stubEnv("APP_URL", NEW);
  vi.stubEnv("APP_ALIASES", OLD);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("загрузки со своим адресом приложения", () => {
  it("основной адрес из APP_URL и технический из APP_ALIASES проходят в обоих обработчиках", async () => {
    for (const origin of [NEW, OLD]) {
      const m = await market(origin);
      expect(m.status, origin).toBe(200);
      expect((await m.json()).ok, origin).toBe(true);
      const b = await board(origin);
      expect(b.status, origin).toBe(200);
      expect(await b.json(), origin).toEqual({ ok: true, value: { tabs: [] } });
    }
  });

  it("чужой сайт, Origin: null и шаблон со звёздочкой в списке получают отказ", async () => {
    vi.stubEnv("APP_ALIASES", `${OLD}, https://*.hosting.example`);
    for (const origin of ["https://evil.example", "null", "https://other.hosting.example", "http://weekly.example.ru"]) {
      const m = await market(origin);
      expect(m.status, origin).toBe(403);
      expect((await m.json()).error, origin).toBe(DENIED);
      const b = await board(origin);
      expect(b.status, origin).toBe(403);
      expect((await b.json()).error, origin).toBe(DENIED);
    }
  });

  it("без APP_ALIASES технический адрес получает отказ, когда APP_URL уже указывает на новый адрес", async () => {
    vi.stubEnv("APP_ALIASES", "");
    expect((await market(OLD)).status).toBe(403);
    expect((await board(OLD)).status).toBe(403);
    expect((await market(NEW)).status).toBe(200);
  });
});
