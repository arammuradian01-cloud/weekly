// Этап 63: «Смотреть как» без базы. Подпись и срок cookie просмотра, привязка к сессии владельца, правила начала,
// отказ записи ошибкой правила. Плюс проверка по тексту кода: обработчики, которые меняют данные, идут через проверку
// записи, а серверные действия не берут вход в обход неё.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGEMENT_TTL_MS, signSession, verifySession } from "@/lib/session";
import { TaskRuleError } from "@/lib/rule-error";
import {
  VIEW_AS_DENIED,
  VIEW_AS_TEXTS,
  VIEW_AS_TTL_MS,
  ViewAsReadOnlyError,
  signViewAs,
  verifyViewAs,
  viewAsHolds,
  viewAsStartError,
  viewAsUntil,
  type ViewAsHolder,
  type ViewAsStarter,
  type ViewAsToken,
} from "@/lib/view-as";

const secret = "test-secret-0123456789-0123456789-abcdef";
const now = Date.UTC(2026, 9, 22, 9, 0);
const grant = now + MANAGEMENT_TTL_MS;
const token: ViewAsToken = { ownerId: "owner", sid: "device-1", targetId: "reva", until: now + VIEW_AS_TTL_MS, grant };

describe("cookie просмотра", () => {
  it("подпись и проверка возвращают те же данные", async () => {
    const signed = await signViewAs(token, secret, now);
    expect(await verifyViewAs(signed, secret, now)).toEqual(token);
  });

  it("подделанная, чужая или пустая cookie не принимается", async () => {
    const signed = await signViewAs(token, secret, now);
    const [h, , s] = signed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...token, targetId: "ceo", aud: "weekly:view-as" })).toString("base64url");
    expect(await verifyViewAs(`${h}.${forged}.${s}`, secret, now)).toBeNull();
    expect(await verifyViewAs(signed, `${secret}-other`, now)).toBeNull();
    expect(await verifyViewAs(undefined, secret, now)).toBeNull();
    expect(await verifyViewAs("мусор", secret, now)).toBeNull();
  });

  it("cookie сессии не годится как cookie просмотра, и наоборот", async () => {
    const session = await signSession({ epoch: 1, personId: "owner", sid: "device-1", via: "PASSWORD" }, secret, now);
    expect(await verifyViewAs(session, secret, now)).toBeNull();
    expect(await verifySession(await signViewAs(token, secret, now), secret, now)).toBeNull();
  });

  it("живёт до своего срока и не дольше", async () => {
    const signed = await signViewAs(token, secret, now);
    expect(await verifyViewAs(signed, secret, token.until - 1000)).not.toBeNull();
    expect(await verifyViewAs(signed, secret, token.until + 1000)).toBeNull();
  });

  it("срок: 2 часа, но не дольше режима управления", () => {
    expect(viewAsUntil(now, now + MANAGEMENT_TTL_MS)).toBe(now + 2 * 60 * 60 * 1000);
    expect(viewAsUntil(now, now + 30 * 60 * 1000)).toBe(now + 30 * 60 * 1000);
  });

  it("короткий ключ подписи не допускается", async () => {
    await expect(signViewAs(token, "short", now)).rejects.toThrow();
  });
});

describe("кто начинает просмотр", () => {
  const owner: ViewAsStarter = { personId: "owner", role: "OWNER", personal: true, management: "OWNER", viewing: false };
  const reva = { id: "reva", active: true };

  it("владелец при личном входе в режиме управления, только включённого человека и не себя", () => {
    expect(viewAsStartError(owner, reva)).toBeNull();
    expect(viewAsStartError({ ...owner, role: "ADMIN", management: "ADMIN" }, reva)).toBe(VIEW_AS_TEXTS.ownerOnly);
    expect(viewAsStartError({ ...owner, role: "LEADER", management: null }, reva)).toBe(VIEW_AS_TEXTS.ownerOnly);
    expect(viewAsStartError({ ...owner, personal: false }, reva)).toBe(VIEW_AS_TEXTS.personal);
    expect(viewAsStartError({ ...owner, management: null }, reva)).toBe(VIEW_AS_TEXTS.management);
    expect(viewAsStartError({ ...owner, viewing: true }, reva)).toBe(VIEW_AS_TEXTS.viewing);
    expect(viewAsStartError(owner, null)).toBe(VIEW_AS_TEXTS.missing);
    expect(viewAsStartError(owner, { id: "reva", active: false })).toBe(VIEW_AS_TEXTS.inactive);
    expect(viewAsStartError(owner, { id: "owner", active: true })).toBe(VIEW_AS_TEXTS.self);
  });
});

describe("просмотр держится, пока жива сессия владельца", () => {
  const holder: ViewAsHolder = { sid: "device-1", personId: "owner", role: "OWNER", personal: true, management: "OWNER", managementUntil: grant };

  it("та же запись устройства, тот же владелец в режиме управления, срок не вышел", () => {
    expect(viewAsHolds(token, holder, now)).toBe(true);
  });

  it("гаснет: другое устройство, вышел, другой профиль, потерял роль или режим управления, режим включили заново, общий логин, срок", () => {
    expect(viewAsHolds(token, { ...holder, sid: "device-2" }, now)).toBe(false);
    expect(viewAsHolds(token, { ...holder, sid: undefined }, now)).toBe(false);
    expect(viewAsHolds(token, { ...holder, personId: "reva" }, now)).toBe(false);
    expect(viewAsHolds(token, { ...holder, role: "ADMIN" }, now)).toBe(false);
    expect(viewAsHolds(token, { ...holder, management: null }, now)).toBe(false);
    expect(viewAsHolds(token, { ...holder, management: "ADMIN" }, now)).toBe(false);
    // Режим управления погас и его включили снова: старая cookie просмотра не оживает
    expect(viewAsHolds(token, { ...holder, managementUntil: grant + 60_000 }, now)).toBe(false);
    expect(viewAsHolds(token, { ...holder, managementUntil: null }, now)).toBe(false);
    expect(viewAsHolds(token, { ...holder, personal: false }, now)).toBe(false);
    expect(viewAsHolds(token, holder, token.until)).toBe(false);
    expect(viewAsHolds({ ...token, targetId: "owner" }, holder, now)).toBe(false);
  });
});

describe("отказ записи", () => {
  it("ошибка правила с общим текстом: экраны показывают её как есть", () => {
    const error = new ViewAsReadOnlyError();
    expect(error).toBeInstanceOf(TaskRuleError);
    expect(error.message).toBe("В режиме «Смотреть как» изменения недоступны");
    expect(VIEW_AS_DENIED).toBe(error.message);
  });
});

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, test);
    return test(name) ? [path] : [];
  });
}

describe("по коду: изменения идут через проверку записи", () => {
  it("обработчики POST, PUT, PATCH, DELETE берут того, кто меняет, через writingActor или requireWriteContext", () => {
    const routes = files("src/app", (n) => n === "route.ts" || n === "route.tsx");
    const mutating = routes.filter((f) => /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\b/.test(readFileSync(f, "utf8")));
    expect(mutating.length).toBeGreaterThan(0);
    for (const file of mutating) {
      const code = readFileSync(file, "utf8");
      expect(/writingActor|requireWriteContext/.test(code), `${file}: изменение без проверки «Смотреть как»`).toBe(true);
      expect(/\bcurrentActor\b|\brequireContext\b/.test(code), `${file}: вход для чтения в обработчике, который меняет данные`).toBe(false);
    }
  });

  it("серверные действия берут вход через runAction, runRead или проверку записи; чтение напрямую только у перечисленных", () => {
    // Действия, которые сами читают вход без проверки записи: только чтение, переключатель команды и сам просмотр.
    // В профиле вход читается ради записи устройства, а изменение всё равно идёт через runAction с отказом.
    // Остальное поведение проверяет tests/db/view-as.test.ts, вызывая каждое действие в режиме просмотра
    const DIRECT_READ = new Set([
      "src/app/actions/team.ts",
      "src/app/actions/view-as.ts",
      "src/app/(app)/search/actions.ts",
      "src/app/(app)/weekly/actions.ts",
      "src/app/(app)/tasks/actions.ts",
      "src/app/(app)/profile/actions.ts",
    ]);
    const actions = files("src", (n) => /\.(ts|tsx)$/.test(n)).filter((f) => /^"use server";/m.test(readFileSync(f, "utf8")));
    expect(actions.length).toBeGreaterThan(10);
    for (const file of actions) {
      const code = readFileSync(file, "utf8");
      if (/\bcurrentActor\b/.test(code)) expect.fail(`${file}: currentActor в серверном действии, нужен writingActor или runRead`);
      if (/\brequireContext\(/.test(code) && !DIRECT_READ.has(file)) expect.fail(`${file}: requireContext в серверном действии, нужен requireWriteContext`);
    }
  });
});
