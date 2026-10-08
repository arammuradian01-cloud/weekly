import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_PREFS, PUSH_TTL_SEC, isAuthStatus, isGoneStatus, isPushHost, parseSubscription, pushPayload, pushPrefOfKind, pushPrefsOf, pushTtlSec } from "@/lib/push/rules";
import type { EventLine } from "@/lib/letters/phrases";

const at = (min: number) => new Date(Date.UTC(2026, 9, 12, 7, min));
const ev = (over: Partial<EventLine> & { subject: string; createdAt: Date }): EventLine & { subject: string; createdAt: Date } => ({
  kind: "TASK_COMMENT",
  actorName: "Рева Тарас",
  taskNumber: 47,
  entryId: null,
  commentId: null,
  requestNumber: null,
  ...over,
});

describe("текст уведомления в браузере", () => {
  it("один предмет: кто и что, ссылка на предмет, повтор по нему заменяет прежнее уведомление", () => {
    expect(pushPayload([ev({ subject: "task:47", createdAt: at(1) })])).toEqual({ title: "Weekly", body: "Рева Тарас: комментарий в задаче 47", url: "/tasks/47", tag: "task:47" });
    const two = pushPayload([ev({ subject: "task:47", createdAt: at(1) }), ev({ subject: "task:47", createdAt: at(2), kind: "TASK_ASSIGNED", actorName: "Мурадян Арам" })]);
    expect(two).toEqual({ title: "Weekly", body: "Мурадян Арам: вам поручена задача 47 (и ещё 1)", url: "/tasks/47", tag: "task:47" });
  });

  it("просьба ведёт на страницу просьбы, запись weekly на страницу записи", () => {
    expect(pushPayload([ev({ subject: "request:5", kind: "REQUEST", taskNumber: null, requestNumber: 5, createdAt: at(1) })])).toMatchObject({ body: "Рева Тарас: просьба к вам", url: "/requests/5" });
    expect(pushPayload([ev({ subject: "entry:e1", kind: "MENTION", taskNumber: null, entryId: "e1", createdAt: at(1) })])).toMatchObject({ body: "Рева Тарас: упоминание в записи weekly", url: "/weekly/entry/e1" });
  });

  it("несколько предметов: одно уведомление со счётом и ссылкой на «Мне», без содержимого", () => {
    const p = pushPayload([ev({ subject: "task:47", createdAt: at(1) }), ev({ subject: "task:48", taskNumber: 48, createdAt: at(2) }), ev({ subject: "request:5", kind: "REQUEST", requestNumber: 5, createdAt: at(3) })]);
    expect(p).toEqual({ title: "Weekly", body: "3 события ждут вас в «Мне»", url: "/me", tag: "inbox" });
    const five = Array.from({ length: 5 }, (_, i) => ev({ subject: `task:${i}`, taskNumber: i, createdAt: at(i) }));
    expect(pushPayload(five)?.body).toBe("5 событий ждут вас в «Мне»");
    expect(pushPayload([])).toBeNull();
  });
});

describe("настройки уведомлений", () => {
  it("по умолчанию всё включено, неизвестные ключи и не-булевы значения игнорируются", () => {
    expect(pushPrefsOf(undefined)).toEqual(DEFAULT_PUSH_PREFS);
    expect(pushPrefsOf({ reactions: false, digest: false, tasks: "нет" })).toEqual({ tasks: true, mentions: true, reactions: false });
  });

  it("группы событий те же, что у писем", () => {
    expect(pushPrefOfKind("REQUEST")).toBe("tasks");
    expect(pushPrefOfKind("UPDATE_REQUEST")).toBe("tasks");
    expect(pushPrefOfKind("MENTION")).toBe("mentions");
    expect(pushPrefOfKind("THANKS")).toBe("mentions");
    expect(pushPrefOfKind("REACTION")).toBe("reactions");
  });
});

describe("подписка от браузера", () => {
  const ok = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } };
  it("принимается только https и ключи в base64url нужной длины", () => {
    expect(parseSubscription(ok)).toEqual(ok);
    expect(parseSubscription({ ...ok, endpoint: "http://fcm.googleapis.com/x" })).toBeNull();
    // Только службы уведомлений браузеров: на внутренние адреса сервер не пойдёт
    expect(parseSubscription({ ...ok, endpoint: "https://10.0.0.5/admin" })).toBeNull();
    expect(parseSubscription({ ...ok, endpoint: "https://fcm.googleapis.com.evil.test/x" })).toBeNull();
    expect(parseSubscription({ ...ok, endpoint: "https://fcm.googleapis.com:8443/x" })).toBeNull();
    expect(parseSubscription({ ...ok, endpoint: "https://web.push.apple.com/QK" })).not.toBeNull();
    expect(parseSubscription({ ...ok, endpoint: "не адрес" })).toBeNull();
    expect(parseSubscription({ ...ok, keys: { p256dh: "коротко", auth: ok.keys.auth } })).toBeNull();
    expect(parseSubscription({ ...ok, keys: { p256dh: ok.keys.p256dh, auth: "with spaces !!" } })).toBeNull();
    expect(parseSubscription({ endpoint: ok.endpoint })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });

  it("подписка удаляется, только когда устройство отписалось; отказ в подписи копится как неудача", () => {
    expect([404, 410].every(isGoneStatus)).toBe(true);
    expect([undefined, 201, 401, 403, 413, 429, 500].some(isGoneStatus)).toBe(false);
    expect([401, 403].every(isAuthStatus)).toBe(true);
  });

  it("службы уведомлений браузеров по имени и поддоменам", () => {
    for (const h of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) expect(isPushHost(h), h).toBe(true);
    for (const h of ["localhost", "googleapis.com.evil.test", "evilgoogleapis.com", "push.example.test"]) expect(isPushHost(h), h).toBe(false);
  });
});

describe("срок хранения в службе уведомлений", () => {
  it("до 20:00 по Москве, не больше 12 часов и не меньше минуты", () => {
    // 11:00 по Москве: до конца рабочего дня 9 часов
    expect(pushTtlSec(new Date("2026-10-12T08:00:00Z"))).toBe(9 * 3600);
    // 19:59:30: минимум минута
    expect(pushTtlSec(new Date("2026-10-12T16:59:30Z"))).toBe(60);
    // 07:00 по Москве: 13 часов до 20:00, но не больше 12
    expect(pushTtlSec(new Date("2026-10-12T04:00:00Z"))).toBe(PUSH_TTL_SEC);
  });
});
