import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { getSetting, setSetting } from "./settings";
import { PASSWORD_SETTING_KEYS, type PasswordKind } from "./passwords";

const KINDS: PasswordKind[] = ["team", "owner", "admin"];

/** Хэш одноразового кода первичной настройки. Сам код живёт только в журнале запуска */
export const SETUP_CODE_KEY = "setup.codeHash";

// Без похожих друг на друга символов: 0 и O, 1 и I и L
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Какие пароли ещё не заданы */
export async function missingPasswords(): Promise<PasswordKind[]> {
  const result: PasswordKind[] = [];
  for (const kind of KINDS) {
    if (!(await getSetting<string | null>(PASSWORD_SETTING_KEYS[kind], null))) result.push(kind);
  }
  return result;
}

function envToken(): string {
  const token = process.env.SETUP_TOKEN ?? "";
  return token.length >= 16 ? token : "";
}

/** Код вида K7M2-QX9R-T4HB-8NWC: 16 знаков, около 79 бит случайности */
export function generateSetupCode(): string {
  const chars = Array.from({ length: 16 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Регистр, пробелы и дефисы при вводе не важны */
export function hashSetupCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return createHash("sha256").update(normalized).digest("hex");
}

function sameDigest(a: string, b: string): boolean {
  // Сравниваем хэши одинаковой длины, чтобы время ответа не выдавало ключ
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * Первичная настройка в браузере включена, если есть код из журнала запуска
 * или задан SETUP_TOKEN в окружении (не короче 16 символов).
 */
export async function setupEnabled(): Promise<boolean> {
  if (envToken()) return true;
  return Boolean(await getSetting<string | null>(SETUP_CODE_KEY, null));
}

/** Подходит ли введённый код: одноразовый код из журнала или SETUP_TOKEN */
export async function setupCodeMatches(given: string): Promise<boolean> {
  const token = envToken();
  const stored = await getSetting<string | null>(SETUP_CODE_KEY, null);
  // Обе проверки выполняются всегда, чтобы время ответа не зависело от способа
  const byToken = token ? sameDigest(given, token) : false;
  const byCode = stored ? sameDigest(hashSetupCode(given), stored) : false;
  return byToken || byCode;
}

/**
 * Вызывается при каждом запуске. Пока пароли не заданы и SETUP_TOKEN нет, выпускает новый код,
 * сохраняет его хэш и возвращает сам код для журнала запуска. Когда пароли заданы, код удаляется.
 */
export async function issueSetupCode(): Promise<string | null> {
  if ((await missingPasswords()).length === 0 || envToken()) {
    await clearSetupCode();
    return null;
  }
  const code = generateSetupCode();
  await setSetting(SETUP_CODE_KEY, hashSetupCode(code));
  return code;
}

export async function clearSetupCode(): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: SETUP_CODE_KEY } });
}
