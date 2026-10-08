import { describe, expect, it } from "vitest";
import { DEFAULT_PUSH_PREFS, deviceLabel, isGoneStatus, parseSubscription, pushPayload, pushPrefOfKind, pushPrefsOf } from "@/lib/push/rules";
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
    expect(parseSubscription({ ...ok, endpoint: "не адрес" })).toBeNull();
    expect(parseSubscription({ ...ok, keys: { p256dh: "коротко", auth: ok.keys.auth } })).toBeNull();
    expect(parseSubscription({ ...ok, keys: { p256dh: ok.keys.p256dh, auth: "with spaces !!" } })).toBeNull();
    expect(parseSubscription({ endpoint: ok.endpoint })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });

  it("ответы, после которых подписка удаляется: устройство отписалось или ключи сменились", () => {
    expect([404, 410, 401, 403].every(isGoneStatus)).toBe(true);
    expect([undefined, 201, 413, 429, 500].some(isGoneStatus)).toBe(false);
  });
});

describe("название устройства в профиле", () => {
  it("браузер и система без точности до модели", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")).toBe("Chrome на Android");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")).toBe("Safari на iPhone");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 YaBrowser/24.10 Safari/537.36")).toBe("Яндекс Браузер на Mac");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0")).toBe("Edge на Windows");
    expect(deviceLabel(null)).toBe("Браузер");
  });
});
