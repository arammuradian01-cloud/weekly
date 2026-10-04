import bcrypt from "bcryptjs";

const COST = 12;
export const MIN_PASSWORD_LENGTH = 12;

export type PasswordKind = "team" | "owner" | "admin";

export const PASSWORD_SETTING_KEYS: Record<PasswordKind, string> = {
  team: "auth.team.hash",
  owner: "auth.owner.hash",
  admin: "auth.admin.hash",
};

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

let dummyHash: string | null = null;

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    // Сравнение с фиктивным хэшем, чтобы время ответа не выдавало, задан ли пароль
    dummyHash ??= await bcrypt.hash("weekly-dummy-password", COST);
    await bcrypt.compare(password, dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** Проверка нового пароля: длина и отсутствие пробелов по краям */
export function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Пароль должен быть не короче ${MIN_PASSWORD_LENGTH} символов`;
  }
  if (password.trim() !== password) {
    return "Пароль не должен начинаться или заканчиваться пробелом";
  }
  if (password === "1234" || /^(\d)\1+$/.test(password)) {
    return "Слишком простой пароль";
  }
  return null;
}
