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
import type { Person } from "@/generated/prisma/client";

export function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? "";
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
};

/** Сессия без выбранного профиля: для экрана выбора себя */
export async function requireSignedIn(): Promise<SessionData> {
  const session = await readSession();
  const { epoch } = await getEpochs();
  if (!session || session.epoch !== epoch) redirect("/login");
  return session;
}

/** Полный контекст для рабочих страниц: вход, профиль, режим управления */
export async function requireContext(): Promise<AppContext> {
  const session = await readSession();
  const { epoch, managementEpoch } = await getEpochs();
  if (!session || session.epoch !== epoch) redirect("/login");
  if (!session.personId) redirect("/choose");
  const person = await prisma.person.findUnique({ where: { id: session.personId } });
  if (!person || !person.active) redirect("/choose");
  const managementRole = managementRoleFor(person.role);
  const grant = activeManagement(session, managementEpoch);
  // Режим управления действует, только если он выдан этой же роли профиля
  const management = grant && managementRole === grant.role ? grant : null;
  return { session, person, management, managementRole };
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
