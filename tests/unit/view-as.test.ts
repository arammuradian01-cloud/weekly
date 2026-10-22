// Этап 63: «Смотреть как» без базы. Подпись и срок cookie просмотра, привязка к сессии владельца, правила начала,
// отказ записи ошибкой правила. Плюс проверка по тексту кода: обработчики, которые меняют данные, идут через проверку
// записи, а серверные действия не берут вход в обход неё.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANAGEMENT_TTL_MS, signSession, verifySession } from "@/lib/session";
import { TaskRuleError } from "@/lib/rule-error";
import { labelRequest } from "@/lib/view-as-fetch";
import { isViewAsRefusal } from "@/lib/view-as-texts";
import {
  VIEW_AS_DENIED,
  VIEW_AS_ENDED,
  VIEW_AS_KEEP_AFTER_MS,
  VIEW_AS_TEXTS,
  VIEW_AS_TTL_MS,
  ViewAsReadOnlyError,
  signViewAs,
  verifyViewAs,
  viewAsEndReason,
  viewAsHolds,
  viewAsKeepUntil,
  viewAsOwnSession,
  viewAsStartError,
  viewAsUntil,
  parseViewAsTab,
  viewAsTabState,
  viewAsWriteRefusal,
  type ViewAsHolder,
  type ViewAsStarter,
  type ViewAsToken,
} from "@/lib/view-as";

const secret = "test-secret-0123456789-0123456789-abcdef";
const now = Date.UTC(2026, 9, 22, 9, 0);
const grant = now + MANAGEMENT_TTL_MS;
const token: ViewAsToken = { id: "view-1", ownerId: "owner", sid: "device-1", targetId: "reva", until: now + VIEW_AS_TTL_MS, grant };

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

  it("живёт до конца режима управления и ещё 12 часов, а не до конца просмотра: закончившийся просмотр видно", async () => {
    const signed = await signViewAs(token, secret, now);
    expect(viewAsKeepUntil(token)).toBe(grant + VIEW_AS_KEEP_AFTER_MS);
    expect(await verifyViewAs(signed, secret, token.until + 1000)).toEqual(token);
    expect(await verifyViewAs(signed, secret, grant + VIEW_AS_KEEP_AFTER_MS - 1000)).toEqual(token);
    expect(await verifyViewAs(signed, secret, grant + VIEW_AS_KEEP_AFTER_MS + 1000)).toBeNull();
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

  it("причина конца для журнала и плашки; cookie другой сессии не считается закончившимся просмотром", () => {
    expect(viewAsEndReason(token, holder, true, now)).toBeNull();
    expect(viewAsEndReason(token, holder, true, token.until)).toBe("expired");
    expect(viewAsEndReason(token, { ...holder, role: "ADMIN" }, true, now)).toBe("role");
    expect(viewAsEndReason(token, { ...holder, management: null, managementUntil: null }, true, now)).toBe("management");
    expect(viewAsEndReason(token, { ...holder, managementUntil: grant + 60_000 }, true, now)).toBe("management");
    expect(viewAsEndReason(token, holder, false, now)).toBe("inactive");
    expect(viewAsOwnSession(token, holder)).toBe(true);
    expect(viewAsOwnSession(token, { sid: "device-2", personId: "owner" })).toBe(false);
    expect(viewAsOwnSession(token, { sid: "device-1", personId: "reva" })).toBe(false);
    expect(viewAsOwnSession(token, { sid: undefined, personId: "owner" })).toBe(false);
  });
});

describe("отказ записи", () => {
  it("ошибка правила с общим текстом: экраны показывают её как есть", () => {
    const error = new ViewAsReadOnlyError();
    expect(error).toBeInstanceOf(TaskRuleError);
    expect(error.message).toBe("В режиме «Смотреть как» изменения недоступны");
    expect(VIEW_AS_DENIED).toBe(error.message);
    const ended = new ViewAsReadOnlyError(VIEW_AS_ENDED);
    expect(ended).toBeInstanceOf(TaskRuleError);
    expect(ended.message).toBe("Просмотр закончился, обновите страницу");
  });
});

describe("метка вкладки (второй круг)", () => {
  const viewing = { viewing: "v1", ended: null };
  const ended = { viewing: null, ended: "v1" };
  const none = { viewing: null, ended: null };

  it("разбор и сборка метки", () => {
    expect(parseViewAsTab("self")).toEqual({ kind: "self" });
    expect(parseViewAsTab("view:3f2a-11")).toEqual({ kind: "view", id: "3f2a-11" });
    expect(parseViewAsTab("ended:3f2a")).toEqual({ kind: "ended", id: "3f2a" });
    for (const bad of [null, "", "view:", "view:a b", "other:1", "self "]) expect(parseViewAsTab(bad)).toBeNull();
    expect(viewAsTabState(viewing)).toBe("view:v1");
    expect(viewAsTabState(ended)).toBe("ended:v1");
    expect(viewAsTabState(none)).toBe("self");
  });

  it("кто может записывать: вкладка просмотра, закончившегося просмотра, обычная и без метки", () => {
    // Идёт просмотр v1
    expect(viewAsWriteRefusal(viewing, { kind: "view", id: "v1" })).toBe(VIEW_AS_DENIED);
    expect(viewAsWriteRefusal(viewing, { kind: "view", id: "old" })).toBe(VIEW_AS_ENDED);
    expect(viewAsWriteRefusal(viewing, { kind: "self" })).toBe(VIEW_AS_DENIED);
    expect(viewAsWriteRefusal(viewing, null)).toBe(VIEW_AS_DENIED);
    // Просмотр v1 закончился сам, cookie ещё есть: блокируются только вкладки просмотра
    expect(viewAsWriteRefusal(ended, { kind: "view", id: "v1" })).toBe(VIEW_AS_ENDED);
    expect(viewAsWriteRefusal(ended, { kind: "ended", id: "v1" })).toBe(VIEW_AS_ENDED);
    expect(viewAsWriteRefusal(ended, { kind: "self" })).toBeNull();
    expect(viewAsWriteRefusal(ended, null)).toBe(VIEW_AS_ENDED);
    // Просмотра нет совсем (вышли кнопкой в другой вкладке): старая вкладка просмотра всё равно не пишет
    expect(viewAsWriteRefusal(none, { kind: "view", id: "v1" })).toBe(VIEW_AS_ENDED);
    expect(viewAsWriteRefusal(none, { kind: "ended", id: "v1" })).toBe(VIEW_AS_ENDED);
    expect(viewAsWriteRefusal(none, { kind: "self" })).toBeNull();
    expect(viewAsWriteRefusal(none, null)).toBeNull();
  });

  it("метка уходит с серверными действиями и изменениями через /api, но не с чтением и не на чужой адрес", () => {
    const page = { origin: "https://weekly.example.ru", href: "https://weekly.example.ru/tasks" };
    const action = labelRequest("https://weekly.example.ru/tasks", { method: "POST", headers: { "next-action": "abc", Accept: "text/x-component" }, body: "[]" }, "view:v1", page);
    expect(new Headers(action!.headers).get("x-weekly-view")).toBe("view:v1");
    expect(new Headers(action!.headers).get("next-action")).toBe("abc");
    expect(action!.body).toBe("[]");
    const upload = labelRequest("/api/market/upload", { method: "POST", body: "{}" }, "self", page);
    expect(new Headers(upload!.headers).get("x-weekly-view")).toBe("self");
    const fromRequest = labelRequest(new Request("https://weekly.example.ru/api/goals/leader-board", { method: "POST", headers: { origin: page.origin } }), undefined, "ended:v1", page);
    expect(new Headers(fromRequest!.headers).get("x-weekly-view")).toBe("ended:v1");
    expect(new Headers(fromRequest!.headers).get("origin")).toBe(page.origin);
    expect(labelRequest("/api/inbox/count", undefined, "view:v1", page)).toBeNull();
    expect(labelRequest("https://example.com/api/x", { method: "POST" }, "view:v1", page)).toBeNull();
    expect(labelRequest("/tasks?_rsc=1", { headers: { RSC: "1" } }, "view:v1", page)).toBeNull();
    expect(labelRequest("/api/market/upload", { method: "POST" }, null, page)).toBeNull();
  });

  it("отказ просмотра отличается от отказа правила: черновик с устройства не выбрасывается", () => {
    expect(isViewAsRefusal(VIEW_AS_DENIED)).toBe(true);
    expect(isViewAsRefusal(VIEW_AS_ENDED)).toBe(true);
    expect(isViewAsRefusal("Неделя закрыта")).toBe(false);
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

  it("серверные действия: вход для чтения (requireContext, reader, runRead) только у перечисленных функций", () => {
    // Чтение в просмотре работает, поэтому каждое действие, которое берёт вход без проверки записи, перечислено здесь
    // по имени. Новая функция с requireContext, reader() или runRead падает в этом тесте, даже если файл уже есть в
    // списке. То же поведение проверяет tests/db/view-as.test.ts, вызывая каждое действие в режиме просмотра
    const READ_FUNCTIONS = new Set([
      // requireContext напрямую
      "setTeamAction",
      "searchAction",
      "weekViewAction",
      "viewAsPeopleAction",
      "startViewAsAction",
      // reader() в задачах
      "getTaskAction",
      "taskHistoryAction",
      "taskExtrasAction",
      "taskLinksAction",
      // runRead
      "goalOptionsAction",
      "suggestGoalsAction",
      "meetingAction",
      "searchDecisionsAction",
      "myForecastAction",
      "planPeopleAction",
      "taskRequestsAction",
      // Этап 80: фото и «О себе» в карточке человека
      "personProfileAction",
      // Режим управления: свой отказ во время просмотра в managementContext, после конца просмотра можно (этап 63)
      "enterManagement",
      "exitManagement",
      "requestStepUpAction",
      "confirmStepUpAction",
    ]);
    /** Помощники внутри файла, которые читают вход без проверки записи: их вызов тоже чтение */
    const READ_HELPERS = new Set(["reader", "managementContext"]);
    const actions = files("src", (n) => /\.(ts|tsx)$/.test(n)).filter((f) => /^"use server";/m.test(readFileSync(f, "utf8")));
    expect(actions.length).toBeGreaterThan(10);
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const file of actions) {
      const code = readFileSync(file, "utf8");
      if (/\bcurrentActor\b/.test(code)) problems.push(`${file}: currentActor в серверном действии, нужен writingActor или runRead`);
      // Функции верхнего уровня: от объявления до следующего объявления
      const marks = [...code.matchAll(/^(export\s+)?(?:async\s+)?function\s+(\w+)|^(export\s+)?const\s+(\w+)\s*=/gm)].map((m) => ({ at: m.index!, name: (m[2] ?? m[4])!, exported: !!(m[1] ?? m[3]) }));
      marks.forEach((m, i) => {
        const body = code.slice(m.at, marks[i + 1]?.at ?? code.length);
        const reads = /\brequireContext\(/.test(body) || /\brunRead\(/.test(body) || [...READ_HELPERS].some((h) => new RegExp(`\\b${h}\\(\\)`).test(body.replace(new RegExp(`function\\s+${h}\\b`), "")));
        if (!reads) return;
        if (!m.exported) {
          if (!READ_HELPERS.has(m.name)) problems.push(`${file} ${m.name}: помощник читает вход без проверки записи`);
          return;
        }
        seen.add(m.name);
        if (!READ_FUNCTIONS.has(m.name)) problems.push(`${file} ${m.name}: вход для чтения в действии, которое не перечислено как чтение`);
      });
    }
    expect(problems).toEqual([]);
    // Список не устарел: каждое имя действительно читает вход
    for (const name of READ_FUNCTIONS) expect(seen.has(name), name).toBe(true);
    // Помощник режима управления сам отказывает во время просмотра
    const auth = readFileSync("src/app/actions/auth.ts", "utf8");
    const helper = auth.slice(auth.indexOf("async function managementContext"), auth.indexOf("export async function enterManagement"));
    expect(helper).toMatch(/if \(ctx\.viewAs\) return \{ error: VIEW_AS_DENIED \}/);
  });
});
