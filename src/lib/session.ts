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

export type SessionData = {
  /** Номер поколения общего пароля: после смены пароля все выходят */
  epoch: number;
  personId?: string;
  management?: ManagementGrant;
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
