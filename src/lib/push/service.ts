// Уведомления в браузере (этап 26): подписки устройств, настройки и проход отправки в минутном цикле писем.
//
// - Подписаться можно только при личном входе: по общему логину можно выбрать чужой профиль.
// - Подписка привязана к записи устройства: вышли на устройстве или «выйти везде», и уведомления туда не идут.
// - Ключи VAPID: из переменных WEB_PUSH_PUBLIC_KEY и WEB_PUSH_PRIVATE_KEY, иначе ресурс сам создаёт пару один раз
//   и хранит в базе. Наружу уходит только открытый ключ.
// - Отправка под той же арендой, что и письма: во время выкладки два контейнера не шлют одно уведомление дважды.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { inWorkHours } from "@/lib/letters/schedule";
import {
  PUSH_DELAY_MS,
  PUSH_LABELS,
  PUSH_MAX_AGE_MS,
  PUSH_MAX_FAILURES,
  PUSH_PREF_ORDER,
  PUSH_TTL_SEC,
  deviceLabel,
  isGoneStatus,
  parseSubscription,
  pushPayload,
  pushPrefOfKind,
  pushPrefsOf,
  type PushPayload,
  type PushPrefs,
} from "./rules";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

const KEYS_SETTING = "push.vapid";

type VapidKeys = { publicKey: string; privateKey: string };

const g = globalThis as unknown as { __pushKeys?: VapidKeys; __pushSender?: PushSender | null };

/** Ключи VAPID. Пара создаётся один раз: два процесса при выкладке получат одну и ту же */
export async function vapidKeys(): Promise<VapidKeys> {
  const envPublic = process.env.WEB_PUSH_PUBLIC_KEY?.trim();
  const envPrivate = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) return { publicKey: envPublic, privateKey: envPrivate };
  if (g.__pushKeys) return g.__pushKeys;
  const found = await prisma.setting.findUnique({ where: { key: KEYS_SETTING } });
  let keys = found?.value as VapidKeys | undefined;
  if (!keys?.publicKey || !keys?.privateKey) {
    const webpush = (await import("web-push")).default;
    const fresh = webpush.generateVAPIDKeys();
    await prisma.$executeRaw`
      INSERT INTO "settings" ("key", "value", "updatedAt")
      VALUES (${KEYS_SETTING}, jsonb_build_object('publicKey', ${fresh.publicKey}::text, 'privateKey', ${fresh.privateKey}::text), now())
      ON CONFLICT ("key") DO NOTHING`;
    keys = (await prisma.setting.findUnique({ where: { key: KEYS_SETTING } }))!.value as VapidKeys;
  }
  g.__pushKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  return g.__pushKeys;
}

export async function pushPublicKey(): Promise<string> {
  return (await vapidKeys()).publicKey;
}

function vapidSubject(): string {
  const url = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  return url.startsWith("https://") ? url : "mailto:weekly@localhost";
}

// ---------- Отправка ----------

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
/** Ответ службы уведомлений: код или ошибка сети (status не задан) */
export type PushSendResult = { status?: number };
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<PushSendResult>;

/** Подмена отправки для тестов: настоящие службы уведомлений из тестов не трогаем */
export function setPushSender(sender: PushSender | null): void {
  g.__pushSender = sender;
}

async function webPushSender(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
  const webpush = (await import("web-push")).default;
  const keys = await vapidKeys();
  try {
    const res = await webpush.sendNotification(target, JSON.stringify(payload), {
      vapidDetails: { subject: vapidSubject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: PUSH_TTL_SEC,
      urgency: "normal",
      // Тема заменяет недоставленное уведомление по тому же предмету: телефон после сети покажет одно, а не пачку
      topic: createHash("sha256").update(payload.tag).digest("base64url").slice(0, 32),
      timeout: 10_000,
    });
    return { status: res.statusCode };
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    return { status: typeof status === "number" ? status : undefined };
  }
}

function sender(): PushSender {
  return g.__pushSender ?? webPushSender;
}

/** Отправить на подписки и разобрать ответы: ушедшие устройства удаляем, неудачи считаем */
async function deliver(subs: { id: string; endpoint: string; p256dh: string; auth: string; failures: number }[], payload: PushPayload, now: Date): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    const res = await sender()({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
    if (res.status && res.status >= 200 && res.status < 300) {
      sent += 1;
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSentAt: now, failures: 0 } });
      continue;
    }
    failed += 1;
    if (isGoneStatus(res.status) || s.failures + 1 >= PUSH_MAX_FAILURES) await prisma.pushSubscription.deleteMany({ where: { id: s.id } });
    else await prisma.pushSubscription.update({ where: { id: s.id }, data: { failures: { increment: 1 } } });
  }
  return { sent, failed };
}

export type PushPassResult = { sent: number; skipped: number; failed: number };

/**
 * Уведомления о новых событиях «Мне». Событие берётся один раз: ему ставится отметка «уведомление ушло или не нужно».
 * Не уходит уведомление о том, что человек уже видел, разобрал или отложил, о старом, без подписок и при выключенной
 * настройке. Вне рабочего времени проход ничего не делает: события ждут утра, а утром старше 12 часов не уходят
 */
export async function pushPass(now = new Date()): Promise<PushPassResult> {
  const zero = { sent: 0, skipped: 0, failed: 0 };
  if (!inWorkHours(now)) return zero;
  // Вышли на устройстве или вход истёк: подписка больше не нужна
  await prisma.pushSubscription.deleteMany({ where: { device: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }] } } });
  const ready = new Date(now.getTime() - PUSH_DELAY_MS);
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "inbox_events" SET "pushedAt" = ${now}
      WHERE "pushedAt" IS NULL AND ("seenAt" IS NOT NULL OR "doneAt" IS NOT NULL OR "createdAt" < ${new Date(now.getTime() - PUSH_MAX_AGE_MS)})`;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "inbox_events"
      WHERE "pushedAt" IS NULL AND "createdAt" <= ${ready} AND ("snoozeUntil" IS NULL OR "snoozeUntil" <= ${now})
      ORDER BY "createdAt" LIMIT 2000 FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await tx.inboxEvent.updateMany({ where: { id: { in: ids } }, data: { pushedAt: now } });
    return tx.inboxEvent.findMany({
      where: { id: { in: ids } },
      include: { task: { select: { number: true } }, request: { select: { number: true } }, recipient: { select: { id: true, active: true, pushPrefs: true } } },
    });
  });
  if (!claimed.length) return zero;
  const people = [...new Set(claimed.map((e) => e.recipientId))];
  const subs = await prisma.pushSubscription.findMany({ where: { personId: { in: people } } });
  const total = { ...zero };
  for (const personId of people) {
    const events = claimed.filter((e) => e.recipientId === personId);
    const mine = subs.filter((s) => s.personId === personId);
    const person = events[0]!.recipient;
    const prefs = pushPrefsOf(person.pushPrefs);
    const wanted = person.active && mine.length ? events.filter((e) => prefs[pushPrefOfKind(e.kind)]) : [];
    total.skipped += events.length - wanted.length;
    const payload = pushPayload(
      wanted.map((e) => ({
        kind: e.kind,
        actorName: e.actorName,
        taskNumber: e.task?.number ?? null,
        entryId: e.entryId,
        commentId: e.commentId ?? e.entryCommentId,
        requestNumber: e.request?.number ?? null,
        subject: e.subject,
        createdAt: e.createdAt,
      })),
    );
    if (!payload) continue;
    const r = await deliver(mine, payload, now);
    total.sent += r.sent;
    total.failed += r.failed;
  }
  return total;
}

// ---------- Подписки и настройки ----------

function personalOnly(actor: Actor, deviceId: string | null): string {
  if (actor.via === "TEAM" || !deviceId) fail("Уведомления в браузере включаются при личном входе: по общему логину можно выбрать чужой профиль");
  return deviceId!;
}

async function audit(actor: Actor, field: string, before: string | null, after: string | null) {
  await prisma.auditLog.create({
    data: {
      action: "settings.push",
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP",
      entity: "person",
      entityId: actor.slug,
      field,
      before: before ?? undefined,
      after: after ?? undefined,
      ip: actor.ip ?? null,
      via: actor.via ?? null,
    },
  });
}

/** Включить уведомления на этом устройстве. Тот же адрес службы с другого входа переходит к этому человеку и устройству */
export async function saveSubscription(actor: Actor, deviceId: string | null, input: unknown, userAgent: string | null): Promise<{ label: string }> {
  const device = personalOnly(actor, deviceId);
  const sub = parseSubscription(input);
  if (!sub) fail("Браузер прислал неполную подписку. Обновите страницу и включите уведомления ещё раз");
  const label = deviceLabel(userAgent);
  const data = { personId: actor.personId, deviceId: device, p256dh: sub!.keys.p256dh, auth: sub!.keys.auth, label, failures: 0 };
  const before = await prisma.pushSubscription.findUnique({ where: { endpoint: sub!.endpoint } });
  await prisma.pushSubscription.upsert({ where: { endpoint: sub!.endpoint }, update: data, create: { ...data, endpoint: sub!.endpoint } });
  if (!before || before.personId !== actor.personId) await audit(actor, "Уведомления в браузере", null, `Включены: ${label}`);
  return { label };
}

/** Выключить на этом устройстве. Чужую подписку так не удалить */
export async function removeSubscription(actor: Actor, endpoint: string): Promise<number> {
  const found = await prisma.pushSubscription.findMany({ where: { endpoint: String(endpoint ?? ""), personId: actor.personId } });
  if (!found.length) return 0;
  await prisma.pushSubscription.deleteMany({ where: { id: { in: found.map((s) => s.id) } } });
  await audit(actor, "Уведомления в браузере", `Включены: ${found[0]!.label ?? "устройство"}`, "Выключены");
  return found.length;
}

/** Выключить на устройстве из списка в профиле */
export async function removeSubscriptionById(actor: Actor, id: string): Promise<number> {
  const found = await prisma.pushSubscription.findFirst({ where: { id: String(id ?? ""), personId: actor.personId } });
  if (!found) fail("Это устройство уже не получает уведомления");
  await prisma.pushSubscription.delete({ where: { id: found!.id } });
  await audit(actor, "Уведомления в браузере", `Включены: ${found!.label ?? "устройство"}`, "Выключены");
  return 1;
}

export type PushDevice = { id: string; label: string; createdAt: string; current: boolean; endpoint: string | null };

/** Устройства человека с включёнными уведомлениями. Адрес службы виден только у текущего устройства */
export async function pushDevices(personId: string, deviceId: string | null): Promise<PushDevice[]> {
  const rows = await prisma.pushSubscription.findMany({ where: { personId, device: { revokedAt: null } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, label: r.label ?? "Устройство", createdAt: r.createdAt.toISOString(), current: r.deviceId === deviceId, endpoint: r.deviceId === deviceId ? r.endpoint : null }));
}

export async function pushPrefsFor(personId: string): Promise<PushPrefs> {
  const p = await prisma.person.findUnique({ where: { id: personId }, select: { pushPrefs: true } });
  return pushPrefsOf(p?.pushPrefs);
}

export async function savePushPrefs(actor: Actor, input: unknown): Promise<PushPrefs> {
  if (actor.via === "TEAM") fail("Уведомления настраиваются при личном входе: по общему логину можно выбрать чужой профиль");
  const prefs = pushPrefsOf(input);
  const before = await pushPrefsFor(actor.personId);
  const changed = PUSH_PREF_ORDER.filter((k) => prefs[k] !== before[k]);
  await prisma.person.update({ where: { id: actor.personId }, data: { pushPrefs: prefs } });
  if (changed.length) {
    await audit(
      actor,
      "Уведомления в браузере",
      changed.map((k) => `${PUSH_LABELS[k].title}: ${before[k] ? "да" : "нет"}`).join(", "),
      changed.map((k) => `${PUSH_LABELS[k].title}: ${prefs[k] ? "да" : "нет"}`).join(", "),
    );
  }
  return prefs;
}

/** Проверка: уведомление на это устройство прямо сейчас, без учёта рабочих часов */
export async function sendTestPush(actor: Actor, deviceId: string | null, now = new Date()): Promise<{ sent: number }> {
  const device = personalOnly(actor, deviceId);
  const subs = await prisma.pushSubscription.findMany({ where: { personId: actor.personId, deviceId: device } });
  if (!subs.length) fail("На этом устройстве уведомления ещё не включены");
  const r = await deliver(subs, { title: "Weekly", body: "Проверка: уведомления на этом устройстве работают", url: "/profile", tag: "test" }, now);
  if (!r.sent) fail("Служба уведомлений браузера не приняла сообщение. Выключите и включите уведомления ещё раз");
  return { sent: r.sent };
}
