"use server";

// Профиль: свои устройства и «выйти везде» (этап 9)

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearSession, readSession } from "@/lib/auth";
import { runAction } from "@/lib/action-runner";
import { revokeAllDevices, revokeDevice } from "@/lib/login/service";
import { removeAbsence, setAbsence } from "@/lib/weekly/service";
import type { WeekKey } from "@/domain/types";

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
