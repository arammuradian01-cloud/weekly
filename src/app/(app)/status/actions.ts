"use server";

// Действия страницы «Состояние» (этап 86). Права проверяет сервис: только владелец в режиме управления.

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-runner";
import { clearErrors } from "@/lib/status-service";

export async function clearErrorsAction() {
  const result = await runAction("Очистка списка сбоев", (a) => clearErrors(a));
  if (result.ok) revalidatePath("/status");
  return result;
}
