// Сессия в подписанной cookie. Модуль без обращений к базе: его использует и proxy, и серверный код.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "wk_session";
/** Сессия и выбор профиля живут 30 дней */
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
/** Режим управления действует 12 часов */
export const MANAGEMENT_TTL_MS = 12 * 60 * 60 * 1000;

export type ManagementRole = "OWNER" | "ADMIN";

export type ManagementGrant = {
  role: ManagementRole;
  /** До какого момента действует режим, мс с 1970 года */
  until: number;
  /** Номер поколения паролей управления: после смены пароля старые режимы гаснут */
  epoch: number;
};

/** Как вошли: общий логин team с выбором профиля, личная ссылка (на почту или приглашение владельца) или личный пароль */
export type SessionVia = "TEAM" | "EMAIL" | "INVITE" | "PASSWORD";

export type SessionData = {
  /** Номер поколения общего пароля: после смены пароля выходят все, кто вошёл по общему логину */
  epoch: number;
  personId?: string;
  management?: ManagementGrant;
  /** Личный вход (этап 9): запись устройства в базе. Пока она не завершена, вход действует */
  sid?: string;
  via?: SessionVia;
};

function keyFrom(secret: string) {
  if (!secret || secret.length < 32) {
    throw new Error("Ключ сессий не задан или короче 32 символов: задайте SESSION_SECRET или пароль базы. Запустите npm run setup");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(data: SessionData, secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ ...data })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SEC)
    .sign(keyFrom(secret));
}

export async function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<SessionData | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret), {
      algorithms: ["HS256"],
      currentDate: new Date(now),
    });
    if (typeof payload.epoch !== "number") return null;
    const data: SessionData = { epoch: payload.epoch };
    if (typeof payload.personId === "string") data.personId = payload.personId;
    if (typeof payload.sid === "string" && payload.sid) data.sid = payload.sid;
    if (payload.via === "TEAM" || payload.via === "EMAIL" || payload.via === "INVITE" || payload.via === "PASSWORD") data.via = payload.via;
    const m = payload.management as Partial<ManagementGrant> | undefined;
    if (
      m &&
      (m.role === "OWNER" || m.role === "ADMIN") &&
      typeof m.until === "number" &&
      typeof m.epoch === "number"
    ) {
      data.management = { role: m.role, until: m.until, epoch: m.epoch };
    }
    return data;
  } catch {
    return null;
  }
}

/** Режим управления активен, если не истёк и пароль управления с тех пор не меняли */
export function activeManagement(
  session: SessionData,
  managementEpoch: number,
  now = Date.now(),
): ManagementGrant | null {
  const m = session.management;
  if (!m) return null;
  if (m.until <= now) return null;
  if (m.epoch !== managementEpoch) return null;
  return m;
}

/** Через сколько после подписи сессию продлевать: раз в сутки, чтобы не подписывать на каждом запросе */
export const SESSION_REFRESH_SEC = 24 * 60 * 60;

/**
 * Скользящая сессия: если cookie подписана больше суток назад, та же сессия подписывается заново на 30 дней.
 * Кто заходит, тот не вылетает; кто не заходил 30 дней, входит заново. null: продлевать не нужно или cookie чужая
 */
export async function refreshSessionToken(token: string | undefined, secret: string, now = Date.now()): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, keyFrom(secret), { algorithms: ["HS256"], currentDate: new Date(now) });
    if (typeof payload.iat !== "number" || now / 1000 - payload.iat < SESSION_REFRESH_SEC) return null;
    const data = await verifySession(token, secret, now);
    return data ? signSession(data, secret, now) : null;
  } catch {
    return null;
  }
}
