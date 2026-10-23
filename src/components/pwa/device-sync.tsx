"use client";

// Оболочка приложения на устройстве (этап 26): черновики weekly, которые не дошли до сервера, уходят при открытии
// ресурса и когда возвращается связь, на любой странице. Подписка браузера на уведомления сверяется с текущим входом.

import { useEffect } from "react";
import { usePrototype } from "@/domain/store";
import { flushOfflineDrafts } from "@/lib/offline/outbox";
import { syncPushAction } from "@/app/(app)/profile/actions";
import { plural } from "@/lib/letters/phrases";

/** Метка на устройстве: кто включал уведомления. По ней подписка переходит к новому входу того же человека */
export const PUSH_OWNER_KEY = "weekly-push-owner";

function readOwner(): string | null {
  try {
    return localStorage.getItem(PUSH_OWNER_KEY);
  } catch {
    return null;
  }
}

async function syncPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const r = await syncPushAction(sub.toJSON(), readOwner());
  if (r.ok && !r.value.keep) await sub.unsubscribe().catch(() => undefined);
}

/**
 * push: сверять подписку браузера на уведомления с текущим входом. Во входе владельца в чужой профиль (этап 71) нет:
 * подписка принадлежит владельцу, сверка от имени человека сняла бы её
 */
export function DeviceSync({ push = true }: { push?: boolean }) {
  const { me, notify } = usePrototype();
  useEffect(() => {
    let alive = true;
    const flush = async () => {
      const r = await flushOfflineDrafts(me.slug).catch(() => null);
      if (!alive || !r) return;
      if (r.sent) notify(`Черновик weekly с этого устройства дошёл до сервера: ${r.sent} ${plural(r.sent, ["правка", "правки", "правок"])}`);
      for (const why of r.rejected) notify(`Черновик с этого устройства не отправлен. ${why}`, "error");
    };
    void flush();
    if (push) void syncPush().catch(() => undefined);
    window.addEventListener("online", flush);
    return () => {
      alive = false;
      window.removeEventListener("online", flush);
    };
  }, [me.slug, notify, push]);
  return null;
}
