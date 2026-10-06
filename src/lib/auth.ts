import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { getEpochs } from "./settings";
import { managementRoleFor } from "./roles";
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  activeManagement,
  signSession,
  verifySession,
  type ManagementGrant,
  type ManagementRole,
  type SessionData,
} from "./session";
import { clientIp } from "./client-ip";
import { sessionSecretFromEnv } from "./database-url";
import { getTeamLogin, loadDevice, touchDevice } from "./login/service";
import type { LoginMethod, Person } from "@/generated/prisma/client";

export function sessionSecret(): string {
  return sessionSecretFromEnv();
}

function secureCookie(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https://");
}

export async function readSession(): Promise<SessionData | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, sessionSecret());
}

export async function writeSession(data: SessionData): Promise<void> {
  const token = await signSession(data, sessionSecret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

export type AppContext = {
  session: SessionData;
  person: Person;
  /** Активный режим управления или null */
  management: ManagementGrant | null;
  /** Роль, которую может включить профиль, или null для лидеров и наблюдателей */
  managementRole: ManagementRole | null;
  /** Как вошли: общий логин team или личная ссылка (этап 9) */
  via: LoginMethod;
  /** Запись устройства при личном входе, иначе null */
  deviceId: string | null;
};

/** Адрес ресурса для ссылок в письмах и приглашениях: APP_URL или адрес текущего запроса */
export async function baseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function requestUserAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/** Сессия общего логина без выбранного профиля: для экрана выбора себя. Личный вход профиль не выбирает */
export async function requireSignedIn(): Promise<SessionData> {
  const session = await readSession();
  if (session?.sid) redirect("/");
  const { epoch } = await getEpochs();
  if (!session || session.epoch !== epoch) redirect("/login");
  if ((await getTeamLogin()) === "off") redirect("/login");
  return session;
}

/**
 * Полный контекст для рабочих страниц: вход, профиль, режим управления.
 * Личный вход держится на записи устройства в базе: завершили в профиле или у владельца, и cookie больше не работает.
 * Общий логин держится на поколении общего пароля и работает, пока владелец его не выключил
 */
export async function requireContext(): Promise<AppContext> {
  const session = await readSession();
  if (!session) redirect("/login");
  const { epoch, managementEpoch } = await getEpochs();

  let person: Person;
  let via: LoginMethod = "TEAM";
  let deviceId: string | null = null;
  if (session.sid) {
    const device = await loadDevice(session.sid);
    if (!device || device.personId !== session.personId || !device.person.active) redirect("/login?ended=1");
    await touchDevice(device.id, device.lastSeenAt);
    person = device.person;
    via = device.method;
    deviceId = device.id;
  } else {
    if (session.epoch !== epoch) redirect("/login");
    if ((await getTeamLogin()) === "off") redirect("/login?team=off");
    if (!session.personId) redirect("/choose");
    const found = await prisma.person.findUnique({ where: { id: session.personId } });
    if (!found || !found.active) redirect("/choose");
    person = found;
  }

  const managementRole = managementRoleFor(person.role);
  const grant = activeManagement(session, managementEpoch);
  // Режим управления действует, только если он выдан этой же роли профиля
  const management = grant && managementRole === grant.role ? grant : null;
  return { session, person, management, managementRole, via, deviceId };
}

/** Страницы режима управления. roles сужает доступ, например только владельцу */
export async function requireManagement(roles: ManagementRole[] = ["OWNER", "ADMIN"], next = "/"): Promise<AppContext> {
  const ctx = await requireContext();
  if (!ctx.management) {
    if (!ctx.managementRole) redirect("/");
    redirect(`/manage?next=${encodeURIComponent(next)}`);
  }
  if (!roles.includes(ctx.management.role)) redirect("/");
  return ctx;
}
