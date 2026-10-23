import type { LoginMethod } from "@/generated/prisma/enums";

/** Как вошёл человек, словами: для профиля и журнала */
export const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  TEAM: "общий логин",
  EMAIL: "ссылка на почту",
  INVITE: "ссылка от владельца",
  PASSWORD: "личный логин и пароль",
  // Этап 71: владелец вошёл в профиль человека из своего личного входа
  OWNER_AS: "вход владельца в профиль",
};
