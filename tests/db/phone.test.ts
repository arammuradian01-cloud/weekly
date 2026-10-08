// Телефон и уведомления в браузере на настоящей базе (этап 26): подписки устройств, проход отправки, черновик weekly
// без сети (повтор с ключом черновика не создаёт вторую запись).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as tasks from "@/lib/tasks/service";
import * as svc from "@/lib/weekly/service";
import * as push from "@/lib/push/service";
import type { PushPayload } from "@/lib/push/rules";

// Понедельник 12.10.2026, 11:00 по Москве: рабочее время
const NOW = new Date("2026-10-12T08:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

const sub = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
  keys: { p256dh: `BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1Xbjhaz${n}kj7I99e8QcYP7DkM`, auth: "tBHItJI5svbpez7KI4CCXg" },
});

type Sent = { endpoint: string; payload: PushPayload };
let sent: Sent[] = [];
let reply: (endpoint: string) => number | undefined = () => 201;

async function personal(slug: string) {
  const a = await tasks.actorFor(slug);
  const device = await prisma.deviceSession.create({ data: { personId: a.personId, method: "PASSWORD", expiresAt: new Date(NOW.getTime() + 30 * 24 * 3_600_000) } });
  return { actor: { ...a, via: "PASSWORD" as const }, deviceId: device.id };
}

async function event(recipient: string, data: { kind?: "TASK_COMMENT" | "REQUEST" | "REACTION" | "MENTION"; subject: string; createdAt: Date; seenAt?: Date; snoozeUntil?: Date; text?: string }) {
  const r = await prisma.person.findUniqueOrThrow({ where: { slug: recipient } });
  return prisma.inboxEvent.create({
    data: { recipientId: r.id, kind: data.kind ?? "TASK_COMMENT", actorName: "Рева Тарас", subject: data.subject, text: data.text ?? "Комментарий", createdAt: data.createdAt, seenAt: data.seenAt, snoozeUntil: data.snoozeUntil },
  });
}

beforeEach(async () => {
  sent = [];
  reply = () => 201;
  push.setPushSender(async (target, payload) => {
    sent.push({ endpoint: target.endpoint, payload });
    return { status: reply(target.endpoint) };
  });
  await prisma.inboxEvent.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.deviceSession.deleteMany();
  await prisma.person.updateMany({ data: { pushPrefs: {} } });
});
afterEach(() => push.setPushSender(null));
afterAll(() => prisma.$disconnect());

describe("подписка устройства", () => {
  it("только при личном входе: по общему логину и без записи устройства нельзя", async () => {
    const reva = await tasks.actorFor("reva");
    await expect(push.saveSubscription({ ...reva, via: "TEAM" }, "x", sub(1), null)).rejects.toThrow(/личном входе/);
    const { actor } = await personal("reva");
    await expect(push.saveSubscription(actor, null, sub(1), null)).rejects.toThrow(/личном входе/);
  });

  it("включается на устройстве, называет устройство по браузеру, пишется в журнал; плохая подписка не принимается", async () => {
    const { actor, deviceId } = await personal("reva");
    const r = await push.saveSubscription(actor, deviceId, sub(1), "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36");
    expect(r.label).toBe("Chrome, Android");
    expect(await push.pushDevices(actor.personId, deviceId)).toEqual([expect.objectContaining({ label: "Chrome, Android", current: true, endpoint: sub(1).endpoint })]);
    expect(await prisma.auditLog.count({ where: { action: "settings.push", actorId: actor.personId } })).toBeGreaterThan(0);
    await expect(push.saveSubscription(actor, deviceId, { endpoint: "http://bad", keys: {} }, null)).rejects.toThrow(/неполную подписку/);
    // Адрес не службы уведомлений: сервер туда не пойдёт
    await expect(push.saveSubscription(actor, deviceId, { ...sub(9), endpoint: "https://intranet.local/hook" }, null)).rejects.toThrow(/неполную подписку/);
  });

  it("тот же адрес службы с другого входа переходит новому человеку; выключить можно только своё", async () => {
    const reva = await personal("reva");
    const loginova = await personal("loginova");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    await push.saveSubscription(loginova.actor, loginova.deviceId, sub(1), null);
    expect(await prisma.pushSubscription.findMany({ select: { personId: true } })).toEqual([{ personId: loginova.actor.personId }]);
    expect(await push.removeSubscription(reva.actor, sub(1).endpoint)).toBe(0);
    expect(await push.removeSubscription(loginova.actor, sub(1).endpoint)).toBe(1);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("настройки уведомлений сохраняются при личном входе", async () => {
    const { actor } = await personal("reva");
    expect(await push.savePushPrefs(actor, { reactions: false })).toEqual({ tasks: true, mentions: true, reactions: false });
    expect(await push.pushPrefsFor(actor.personId)).toEqual({ tasks: true, mentions: true, reactions: false });
    await expect(push.savePushPrefs({ ...actor, via: "TEAM" }, { tasks: false })).rejects.toThrow(/личном входе/);
  });

  it("проверка уходит на это устройство в любое время; без подписки понятный отказ", async () => {
    const { actor, deviceId } = await personal("reva");
    await expect(push.sendTestPush(actor, deviceId, NOW)).rejects.toThrow(/ещё не включены/);
    await push.saveSubscription(actor, deviceId, sub(1), null);
    expect(await push.sendTestPush(actor, deviceId, NOW)).toEqual({ sent: 1 });
    expect(sent[0]!.payload).toMatchObject({ url: "/profile", tag: "test" });
  });

  it("ключи VAPID создаются один раз и одинаковы при повторном чтении", async () => {
    const a = await push.vapidKeys();
    const b = await push.vapidKeys();
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
  });
});

describe("проход отправки", () => {
  it("новые события человека уходят одним уведомлением на все его устройства, второй раз не уходят", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    const phone = await prisma.deviceSession.create({ data: { personId: reva.actor.personId, method: "PASSWORD", expiresAt: new Date(NOW.getTime() + 3_600_000) } });
    await push.saveSubscription(reva.actor, phone.id, sub(2), null);
    await event("reva", { subject: "task:47", createdAt: ago(3 * MIN) });
    await event("reva", { subject: "request:5", kind: "REQUEST", createdAt: ago(2 * MIN) });
    expect(await push.pushPass(NOW)).toEqual({ sent: 2, skipped: 0, failed: 0 });
    expect(sent.map((s) => s.endpoint).sort()).toEqual([sub(1).endpoint, sub(2).endpoint]);
    expect(sent[0]!.payload).toEqual({ title: "Weekly", body: "2 события ждут вас в «Мне»", url: "/me", tag: "inbox" });
    expect(await prisma.inboxEvent.count({ where: { pushedAt: null } })).toBe(0);
    sent = [];
    expect(await push.pushPass(new Date(NOW.getTime() + MIN))).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(sent).toEqual([]);
  });

  it("свежее событие ждёт минуту: серия правок уходит одним уведомлением", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    await event("reva", { subject: "task:47", createdAt: ago(10_000) });
    expect((await push.pushPass(NOW)).sent).toBe(0);
    expect(await prisma.inboxEvent.count({ where: { pushedAt: null } })).toBe(1);
    expect((await push.pushPass(new Date(NOW.getTime() + MIN))).sent).toBe(1);
  });

  it("увиденное, старое и отложенное не уходят; отложенное уходит, когда срок прошёл", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    await event("reva", { subject: "task:1", createdAt: ago(5 * MIN), seenAt: ago(MIN) });
    await event("reva", { subject: "task:2", createdAt: ago(13 * 3_600_000) });
    await event("reva", { subject: "task:3", createdAt: ago(5 * MIN), snoozeUntil: new Date(NOW.getTime() + 30 * MIN) });
    expect((await push.pushPass(NOW)).sent).toBe(0);
    expect(await prisma.inboxEvent.count({ where: { pushedAt: null } })).toBe(1);
    expect((await push.pushPass(new Date(NOW.getTime() + 31 * MIN))).sent).toBe(1);
    expect(sent[0]!.payload.tag).toBe("task:3");
  });

  it("вне рабочего времени проход ничего не трогает", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    await event("reva", { subject: "task:47", createdAt: new Date("2026-10-12T18:00:00Z") });
    // 22:00 по Москве
    expect(await push.pushPass(new Date("2026-10-12T19:00:00Z"))).toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(await prisma.inboxEvent.count({ where: { pushedAt: null } })).toBe(1);
  });

  it("выключенный тип и человек без подписок: событие отмечено, уведомления нет", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    await push.savePushPrefs(reva.actor, { reactions: false });
    await event("reva", { subject: "entry:e1", kind: "REACTION", createdAt: ago(2 * MIN) });
    await event("loginova", { subject: "task:47", createdAt: ago(2 * MIN) });
    expect(await push.pushPass(NOW)).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(await prisma.inboxEvent.count({ where: { pushedAt: null } })).toBe(0);
  });

  it("устройство отписалось (410): подписка удаляется; сбой сети: считается неудача", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    const other = await prisma.deviceSession.create({ data: { personId: reva.actor.personId, method: "PASSWORD", expiresAt: new Date(NOW.getTime() + 3_600_000) } });
    await push.saveSubscription(reva.actor, other.id, sub(2), null);
    reply = (endpoint) => (endpoint === sub(1).endpoint ? 410 : undefined);
    await event("reva", { subject: "task:47", createdAt: ago(2 * MIN) });
    expect(await push.pushPass(NOW)).toEqual({ sent: 0, skipped: 0, failed: 2 });
    expect(await prisma.pushSubscription.findMany({ select: { endpoint: true, failures: true } })).toEqual([{ endpoint: sub(2).endpoint, failures: 1 }]);
  });

  it("отказ в подписи (403) копится как неудача, подписка не удаляется сразу", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    reply = () => 403;
    await event("reva", { subject: "task:47", createdAt: ago(2 * MIN) });
    expect(await push.pushPass(NOW)).toEqual({ sent: 0, skipped: 0, failed: 1 });
    expect(await prisma.pushSubscription.findMany({ select: { failures: true } })).toEqual([{ failures: 1 }]);
  });

  it("служба хранит недоставленное только до конца рабочего дня", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    let ttl = 0;
    push.setPushSender(async (_t, _p, t) => {
      ttl = t;
      return { status: 201 };
    });
    await event("reva", { subject: "task:47", createdAt: ago(2 * MIN) });
    await push.pushPass(NOW);
    expect(ttl).toBe(9 * 3600);
  });

  it("вышли на устройстве: подписка удаляется, туда ничего не уходит", async () => {
    const reva = await personal("reva");
    await push.saveSubscription(reva.actor, reva.deviceId, sub(1), null);
    await prisma.deviceSession.update({ where: { id: reva.deviceId }, data: { revokedAt: ago(MIN), revokedBy: "self" } });
    await event("reva", { subject: "task:47", createdAt: ago(2 * MIN) });
    expect((await push.pushPass(NOW)).sent).toBe(0);
    expect(await prisma.pushSubscription.count()).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe("сверка подписки при открытии ресурса", () => {
  it("тот же человек вошёл заново: подписка переходит к новому входу; другой человек или общий логин её снимают", async () => {
    const first = await personal("reva");
    await push.saveSubscription(first.actor, first.deviceId, sub(1), null);
    // Новый вход того же человека в том же браузере: прежняя запись устройства завершена, строка подписки ещё есть
    const again = await personal("reva");
    expect(await push.syncSubscription(again.actor, again.deviceId, sub(1), "reva")).toEqual({ keep: true });
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: sub(1).endpoint } })).deviceId).toBe(again.deviceId);

    // Коллега вошёл лично в этом браузере: уведомления прежнего человека сюда больше не идут
    const other = await personal("loginova");
    expect(await push.syncSubscription(other.actor, other.deviceId, sub(1), "reva")).toEqual({ keep: false });
    expect(await prisma.pushSubscription.count()).toBe(0);

    // Строки нет: подписку возвращаем, только если её включал этот же человек
    expect(await push.syncSubscription(again.actor, again.deviceId, sub(1), "loginova")).toEqual({ keep: false });
    expect(await push.syncSubscription(again.actor, again.deviceId, sub(1), "reva")).toEqual({ keep: true });

    // Общий логин в этом браузере: подписка снимается
    const team = { ...(await tasks.actorFor("fatyanov")), via: "TEAM" as const };
    expect(await push.syncSubscription(team, null, sub(1), "reva")).toEqual({ keep: false });
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

describe("черновик weekly с телефона", () => {
  const draft = async (patch: Partial<svc.EntryInput> = {}): Promise<svc.EntryInput> => ({
    week: await svc.currentReportingKey(new Date()),
    direction: "osago",
    block: "product",
    type: "event",
    what: "Запустили AB-тест рекомендаций",
    ...patch,
  });

  beforeEach(async () => {
    await prisma.weeklyEntry.deleteMany({ where: { clientKey: { not: null } } });
  });

  it("повтор с тем же ключом черновика правит запись, а не создаёт вторую", async () => {
    const reva = await tasks.actorFor("reva");
    const first = await svc.saveEntry(reva, await draft({ clientKey: "draft-key-0001" }));
    const again = await svc.saveEntry(reva, await draft({ clientKey: "draft-key-0001", what: "Запустили AB-тест, первые цифры в четверг" }));
    expect(again.id).toBe(first.id);
    expect(await prisma.weeklyEntry.findMany({ where: { clientKey: "draft-key-0001" }, select: { what: true } })).toEqual([{ what: "Запустили AB-тест, первые цифры в четверг" }]);
  });

  it("две одновременные отправки одного черновика дают одну запись", async () => {
    const reva = await tasks.actorFor("reva");
    const input = await draft({ clientKey: "draft-key-race1" });
    const [a, b] = await Promise.all([svc.saveEntry(reva, input), svc.saveEntry(reva, input)]);
    expect(a.id).toBe(b.id);
    expect(await prisma.weeklyEntry.count({ where: { clientKey: "draft-key-race1" } })).toBe(1);
  });

  it("черновик со старой версии записи поверх более новой не пишется; тот же текст после потерянного ответа проходит", async () => {
    const reva = await tasks.actorFor("reva");
    const created = await svc.saveEntry(reva, await draft({ clientKey: "draft-key-base1" }));
    const base = created.updatedAt!;
    // На ноутбуке запись поправили позже
    await new Promise((r) => setTimeout(r, 15));
    await svc.saveEntry(reva, { ...(await draft()), id: created.id, what: "Поправили на ноутбуке" });
    await expect(svc.saveEntry(reva, { ...(await draft()), id: created.id, what: "Старый черновик с телефона", baseUpdatedAt: base })).rejects.toThrow(svc.ENTRY_CONFLICT);
    expect((await prisma.weeklyEntry.findUniqueOrThrow({ where: { id: created.id } })).what).toBe("Поправили на ноутбуке");
    // Тот же текст, что уже на сервере: это повтор, а не конфликт
    const same = await svc.saveEntry(reva, { ...(await draft()), id: created.id, what: "Поправили на ноутбуке", baseUpdatedAt: base });
    expect(same.id).toBe(created.id);
  });

  it("главная фраза с устройства не пишется поверх изменённой на другом устройстве", async () => {
    const reva = await tasks.actorFor("reva");
    const week = await svc.currentReportingKey(new Date());
    await svc.saveHeadline(reva, week, "С ноутбука");
    await expect(svc.saveHeadline(reva, week, "С телефона", "Было раньше")).rejects.toThrow(svc.HEADLINE_CONFLICT);
    expect((await svc.saveHeadline(reva, week, "С телефона", "С ноутбука")).headline).toBe("С телефона");
    // Повтор того же текста после потерянного ответа: не конфликт
    expect((await svc.saveHeadline(reva, week, "С телефона", "С ноутбука")).headline).toBe("С телефона");
  });

  it("ключ другого человека и негодный ключ не склеивают записи", async () => {
    const reva = await tasks.actorFor("reva");
    const loginova = await tasks.actorFor("loginova");
    const a = await svc.saveEntry(reva, await draft({ clientKey: "draft-key-share" }));
    const b = await svc.saveEntry(loginova, await draft({ clientKey: "draft-key-share" }));
    expect(a.id).not.toBe(b.id);
    const c = await svc.saveEntry(reva, await draft({ clientKey: "плохой ключ" }));
    const d = await svc.saveEntry(reva, await draft({ clientKey: "плохой ключ" }));
    expect(c.id).not.toBe(d.id);
    await prisma.weeklyEntry.deleteMany({ where: { id: { in: [c.id, d.id] } } });
  });
});
