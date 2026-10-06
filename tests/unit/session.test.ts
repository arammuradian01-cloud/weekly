import { describe, expect, it } from "vitest";
import { activeManagement, MANAGEMENT_TTL_MS, signSession, verifySession, SESSION_TTL_SEC } from "@/lib/session";

const secret = "test-secret-0123456789-0123456789-abcdef";

describe("сессия в подписанной cookie", () => {
  it("подпись и проверка возвращают те же данные", async () => {
    const token = await signSession({ epoch: 3, personId: "p1" }, secret);
    expect(await verifySession(token, secret)).toEqual({ epoch: 3, personId: "p1" });
  });

  it("подделанная или чужая cookie не принимается", async () => {
    const token = await signSession({ epoch: 1, personId: "p1" }, secret);
    const [h, , s] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ epoch: 1, personId: "owner" })).toString("base64url");
    expect(await verifySession(`${h}.${forgedPayload}.${s}`, secret)).toBeNull();
    expect(await verifySession(token, `${secret}-other`)).toBeNull();
    expect(await verifySession(undefined, secret)).toBeNull();
  });

  it("сессия живёт 30 дней", async () => {
    const now = Date.now();
    const token = await signSession({ epoch: 1 }, secret, now);
    expect(await verifySession(token, secret, now + (SESSION_TTL_SEC - 60) * 1000)).not.toBeNull();
    expect(await verifySession(token, secret, now + (SESSION_TTL_SEC + 60) * 1000)).toBeNull();
  });

  it("короткий ключ подписи не допускается", async () => {
    await expect(signSession({ epoch: 1 }, "short")).rejects.toThrow();
  });
});

describe("режим управления", () => {
  const now = Date.now();
  const grant = { role: "OWNER" as const, until: now + MANAGEMENT_TTL_MS, epoch: 2 };

  it("действует 12 часов", () => {
    expect(activeManagement({ epoch: 1, management: grant }, 2, now)).toEqual(grant);
    expect(activeManagement({ epoch: 1, management: grant }, 2, now + MANAGEMENT_TTL_MS + 1)).toBeNull();
  });

  it("гаснет после смены пароля управления", () => {
    expect(activeManagement({ epoch: 1, management: grant }, 3, now)).toBeNull();
  });
});

describe("ключ сессий и токен отмены удаления записи (этап 7)", () => {
  it("видно, откуда взят ключ: свой SESSION_SECRET, из пароля базы или никакого", async () => {
    const { sessionSecretSource } = await import("@/lib/database-url");
    expect(sessionSecretSource({ SESSION_SECRET: secret })).toBe("env");
    expect(sessionSecretSource({ DB_HOST: "h", DB_PASSWORD: "p@ss word" })).toBe("derived");
    expect(sessionSecretSource({})).toBe("none");
  });

  it("токен отмены возвращает запись только автору и только в течение минуты, подделку не принимает", async () => {
    process.env.SESSION_SECRET = secret;
    const { issueEntryUndoToken, readEntryUndoToken, ENTRY_UNDO_TTL_MS } = await import("@/lib/weekly/undo");
    const snapshot = {
      id: "e1", weekId: "w1", authorId: "p1", directionId: "d", blockId: "b", typeId: "t", what: "Запись с кириллицей",
      details: null, impact: null, fact: null, next: null, help: null, links: [], ceo: false, sortOrder: 2, importBatch: null,
      createdAt: "2026-10-06T06:00:00.000Z", taskIds: ["t1"],
    };
    const now = Date.now();
    const token = issueEntryUndoToken(snapshot, "p1", now);
    expect(readEntryUndoToken(token, "p1", now + 1000)).toEqual(snapshot);
    expect(readEntryUndoToken(token, "p2", now + 1000)).toBeNull();
    expect(readEntryUndoToken(token, "p1", now + ENTRY_UNDO_TTL_MS + 1)).toBeNull();
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ snapshot: { ...snapshot, authorId: "p9" }, by: "p1", exp: now + 60_000 })).toString("base64url");
    expect(readEntryUndoToken(`${forged}.${mac}`, "p1", now)).toBeNull();
    expect(readEntryUndoToken(`${body}`, "p1", now)).toBeNull();
    expect(readEntryUndoToken("", "p1", now)).toBeNull();
  });
});
