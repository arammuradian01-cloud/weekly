// Выход на устройстве (этап 26): черновики weekly стираются, подписка на уведомления в браузере снимается.
// На общем устройстве следующий человек не увидит чужой черновик и не получит чужие уведомления

import { clearOfflineDrafts } from "./drafts";

export async function forgetThisDevice(): Promise<void> {
  clearOfflineDrafts();
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]);
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {
    // Браузер не дал снять подписку: сервер всё равно не шлёт на устройство после выхода
  }
}
