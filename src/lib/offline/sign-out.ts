// Выход на устройстве (этап 26): черновики weekly стираются, подписка на уведомления в браузере снимается.
// На общем устройстве следующий человек не увидит чужой черновик и не получит чужие уведомления

import { clearOfflineDrafts } from "./drafts";
import { flushOfflineDrafts } from "./outbox";
import { clearRecentTeams } from "@/domain/team-picker";

/**
 * person: кто выходит. Сначала отправляем его черновики, которые ещё не дошли (не дольше 5 секунд), потом стираем:
 * выход не теряет написанное, если есть сеть
 */
export async function forgetThisDevice(person?: string): Promise<void> {
  const flushed = person ? await Promise.race([flushOfflineDrafts(person).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 5000))]) : null;
  // Сервер отказал из-за просмотра «Смотреть как» (этап 63): черновики не стираем, иначе написанное пропадёт
  if (!flushed?.blocked) clearOfflineDrafts();
  // «Недавние» команды в окне выбора (этап 74): следующий человек на общем устройстве их не увидит
  clearRecentTeams();
  try {
    localStorage.removeItem("weekly-push-owner");
  } catch {
    // Хранилище запрещено
  }
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const reg = await Promise.race([navigator.serviceWorker.getRegistration(), new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))]);
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {
    // Браузер не дал снять подписку: сервер всё равно не шлёт на устройство после выхода
  }
}
