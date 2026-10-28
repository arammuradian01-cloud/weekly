// Личный вход (этап 28, с этапа 76 отдельным модулем): общий логин team не годится для личного, его знает вся
// топ-команда и профиль в нём выбирают сами. Календарь сроков, оценка встреч и названия владельца требуют личного входа

import type { LoginMethod } from "@/generated/prisma/enums";

/** Личный вход: любой способ, кроме общего логина team. Неизвестный способ входа личным не считается */
export function personalLogin(via: LoginMethod | null | undefined): boolean {
  return !!via && via !== "TEAM";
}
