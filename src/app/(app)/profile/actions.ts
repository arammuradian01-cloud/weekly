"use server";

// Профиль: свои устройства и «выйти везде» (этап 9)

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { baseUrl, clearSession, readSession, requestUserAgent, requireContext } from "@/lib/auth";
import { createFeed, feedUrl, revokeFeed, setFeedTitles } from "@/lib/calendar/service";
import { changePassword } from "@/lib/login/password";
import { runAction } from "@/lib/action-runner";
import { revokeAllDevices, revokeDevice } from "@/lib/login/service";
import { removeAbsence, setAbsence } from "@/lib/weekly/service";
import type { WeekKey } from "@/domain/types";
import { saveMailPrefs } from "@/lib/letters/service";
import { removeSubscription, removeSubscriptionById, savePushPrefs, saveSubscription, sendTestPush, syncSubscription } from "@/lib/push/service";

export async function revokeDeviceAction(id: string) {
  const session = await readSession();
  const result = await runAction("Выход на устройстве", (a) => revokeDevice(a, String(id)));
  if (result.ok && session?.sid === id) {
    await clearSession();
    redirect("/login");
  }
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function revokeAllMineAction() {
  const session = await readSession();
  const result = await runAction("Выход на всех устройствах", (a) => revokeAllDevices(a, a.slug));
  if (result.ok && session?.sid) {
    await clearSession();
    redirect("/login");
  }
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function setAbsenceAction(week: string, substitute: string | null) {
  const result = await runAction("Отсутствие", (a) => setAbsence(a, { slug: a.slug, week: String(week) as WeekKey, substitute: substitute ? String(substitute) : null }));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function removeAbsenceAction(week: string) {
  const result = await runAction("Отмена отсутствия", (a) => removeAbsence(a, a.slug, String(week) as WeekKey));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Какие письма приходят (этап 20). Только при личном входе */
export async function saveMailPrefsAction(prefs: Record<string, boolean>) {
  const result = await runAction("Настройки писем", (a) => saveMailPrefs(a, prefs));
  if (result.ok) revalidatePath("/profile");
  return result;
}

/** Смена своего пароля (этап 20а): при личном входе, с текущим паролем, если он уже есть */
export async function changePasswordAction(current: string, next: string, repeat: string) {
  const ctx = await requireContext();
  return runAction("Смена пароля", (a) => changePassword(a, ctx.deviceId, String(current ?? ""), String(next ?? ""), String(repeat ?? "")));
}

// ---------- Уведомления в браузере (этап 26). Только при личном входе ----------

/** Включить на этом устройстве: подписка от браузера привязывается к записи устройства */
export async function savePushSubscriptionAction(subscription: unknown) {
  const ctx = await requireContext();
  const ua = await requestUserAgent();
  const result = await runAction("Уведомления в браузере", (a) => saveSubscription(a, ctx.deviceId, subscription, ua));
  if (result.ok) revalidatePath("/profile");
  return result;
}

/** Выключить на этом устройстве */
export async function removePushSubscriptionAction(endpoint: string) {
  const result = await runAction("Уведомления в браузере", (a) => removeSubscription(a, String(endpoint ?? "")));
  if (result.ok) revalidatePath("/profile");
  return result;
}

/** Выключить на другом своём устройстве из списка */
export async function removePushDeviceAction(id: string) {
  const result = await runAction("Уведомления в браузере", (a) => removeSubscriptionById(a, String(id ?? "")));
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function savePushPrefsAction(prefs: Record<string, boolean>) {
  const result = await runAction("Настройки уведомлений", (a) => savePushPrefs(a, prefs));
  if (result.ok) revalidatePath("/profile");
  return result;
}

/** Проверка: уведомление на это устройство прямо сейчас */
export async function testPushAction() {
  const ctx = await requireContext();
  return runAction("Проверка уведомлений", (a) => sendTestPush(a, ctx.deviceId));
}

/** Сверка подписки браузера с текущим входом при открытии ресурса. keep: false значит снять подписку в браузере */
export async function syncPushAction(subscription: unknown, owner: string | null) {
  const ctx = await requireContext();
  return runAction("Сверка уведомлений", (a) => syncSubscription(a, ctx.deviceId, subscription, typeof owner === "string" ? owner : null));
}

// ---------- Календарь сроков (этап 29). Только при личном входе ----------

/** Новая ссылка на календарь: возвращает адрес подписки, его показывают один раз */
export async function createCalendarAction(withTitles: boolean) {
  const base = await baseUrl();
  const result = await runAction("Ссылка на календарь", async (a) => feedUrl(base, (await createFeed(a, withTitles === true)).token));
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function calendarTitlesAction(withTitles: boolean) {
  const result = await runAction("Названия в календаре", (a) => setFeedTitles(a, withTitles === true));
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function revokeCalendarAction() {
  const result = await runAction("Отключение календаря", (a) => revokeFeed(a));
  if (result.ok) revalidatePath("/profile");
  return result;
}
