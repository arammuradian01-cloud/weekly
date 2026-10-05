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
