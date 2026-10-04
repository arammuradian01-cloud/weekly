import { getSetting } from "./settings";
import { PASSWORD_SETTING_KEYS, type PasswordKind } from "./passwords";

const KINDS: PasswordKind[] = ["team", "owner", "admin"];

/** Какие пароли ещё не заданы */
export async function missingPasswords(): Promise<PasswordKind[]> {
  const result: PasswordKind[] = [];
  for (const kind of KINDS) {
    if (!(await getSetting<string | null>(PASSWORD_SETTING_KEYS[kind], null))) result.push(kind);
  }
  return result;
}

/** Первичная настройка в браузере включена ключом SETUP_TOKEN из окружения */
export function setupEnabled(): boolean {
  return (process.env.SETUP_TOKEN ?? "").length >= 16;
}
