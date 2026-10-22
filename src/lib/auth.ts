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
import { VIEW_AS_COOKIE, VIEW_AS_ENDED, ViewAsReadOnlyError, signViewAs, verifyViewAs, viewAsEndReason, viewAsKeepUntil, viewAsOwnSession, type ViewAsEnd, type ViewAsToken } from "./view-as";
import { endViewAs } from "./view-as-service";
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

/** Кто смотрит в режиме «Смотреть как» (этап 63) и до какого момента */
export type ViewAsInfo = {
  owner: { id: string; slug: string; fullName: string };
  /** До какого момента действует просмотр, мс с 1970 года */
  until: number;
};

/** Просмотр этой сессии закончился сам, а cookie ещё есть: кого смотрели и почему кончилось */
export type ViewAsEndedInfo = { target: { id: string; fullName: string } | null; reason: ViewAsEnd };

export type AppContext = {
  session: SessionData;
  /** Чьими глазами показывается приложение: вошедший профиль, а в режиме «Смотреть как» выбранный человек */
  person: Person;
  /** Активный режим управления или null. В режиме «Смотреть как» всегда null */
  management: ManagementGrant | null;
  /** Роль, которую может включить профиль, или null для лидеров и наблюдателей */
  managementRole: ManagementRole | null;
  /** Как вошли: общий логин team или личная ссылка (этап 9). В режиме «Смотреть как» личный вход владельца */
  via: LoginMethod;
  /** Запись устройства при личном входе, иначе null. В режиме «Смотреть как» null: устройство не выбранного человека */
  deviceId: string | null;
  /** Режим «Смотреть как» (этап 63): владелец смотрит глазами person, изменения недоступны. Иначе null */
  viewAs: ViewAsInfo | null;
  /**
   * Просмотр закончился сам (срок, режим управления, роль, человека выключили), а владелец ещё не вернулся к себе:
   * person это сам владелец, но изменения недоступны, пока он не нажмёт «Вернуться к себе». Так вкладка, оставшаяся
   * от просмотра, не запишет ничего от его имени. Иначе null
   */
  viewAsEnded: ViewAsEndedInfo | null;
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
  // «Смотреть как» (этап 63): проверяется на каждом запросе. Владелец потерял роль или режим управления, выбранного
  // человека выключили, срок вышел: человек снова видит себя, но изменения закрыты, пока он не вернётся к себе
  const state = await viewAsState(session, person, via, management);
  if (state.kind === "active") {
    const target = state.target;
    return { session, person: target, management: null, managementRole: managementRoleFor(target.role), via, deviceId: null, viewAs: state.info, viewAsEnded: null };
  }
  return { session, person, management, managementRole, via, deviceId, viewAs: null, viewAsEnded: state.kind === "ended" ? state.ended : null };
}

/** Подписанная cookie просмотра, если она есть и подпись верна. Чья она и действует ли, решает viewAsState */
export async function readViewAsToken(): Promise<ViewAsToken | null> {
  const store = await cookies();
  return verifyViewAs(store.get(VIEW_AS_COOKIE)?.value, sessionSecret());
}

type ViewAsState =
  | { kind: "none" }
  | { kind: "active"; token: ViewAsToken; target: Person; info: ViewAsInfo }
  | { kind: "ended"; token: ViewAsToken; ended: ViewAsEndedInfo };

/** Состояние просмотра для этой сессии. cookie от другой сессии (прежний вход в этом браузере) не в счёт */
async function viewAsState(session: SessionData, owner: Person, via: LoginMethod, management: ManagementGrant | null, deviceOk = true): Promise<ViewAsState> {
  const token = await readViewAsToken();
  if (!token || !viewAsOwnSession(token, { sid: session.sid, personId: owner.id })) return { kind: "none" };
  const target = await prisma.person.findUnique({ where: { id: token.targetId } });
  const who = { sid: session.sid, personId: owner.id, role: owner.role, personal: !!session.sid && via !== "TEAM", management: management?.role ?? null, managementUntil: management?.until ?? null };
  const reason = deviceOk ? viewAsEndReason(token, who, !!target?.active) : "session";
  if (!reason && target) return { kind: "active", token, target, info: { owner: { id: owner.id, slug: owner.slug, fullName: owner.fullName }, until: token.until } };
  return { kind: "ended", token, ended: { target: target ? { id: target.id, fullName: target.fullName } : null, reason: reason ?? "inactive" } };
}

/**
 * Снять cookie просмотра: «Выйти из просмотра» и «Вернуться к себе», выход из ресурса, новый вход, новый просмотр.
 * Если cookie этой сессии и конец просмотра ещё не записан, пишет «viewAs.stop»: при живом просмотре с причиной how,
 * а если просмотр уже закончился сам, с его причиной (срок, режим управления, роль, человек выключен, вход завершён).
 * Вход здесь не требуется: работает и для завершённого входа
 */
export async function closeViewAs(how: "stop" | "logout" | "login" | "start"): Promise<void> {
  const token = await readViewAsToken();
  if (!token) return;
  const session = await readSession();
  if (session?.sid && session.personId && viewAsOwnSession(token, { sid: session.sid, personId: session.personId })) {
    const owner = await prisma.person.findUnique({ where: { id: session.personId } });
    if (owner) {
      const device = await loadDevice(session.sid);
      const deviceOk = !!device && device.personId === owner.id && owner.active;
      const { managementEpoch } = await getEpochs();
      const grant = activeManagement(session, managementEpoch);
      const management = grant && managementRoleFor(owner.role) === grant.role ? grant : null;
      const state = await viewAsState(session, owner, device?.method ?? session.via ?? "TEAM", management, deviceOk);
      const reason: ViewAsEnd = state.kind === "ended" ? state.ended.reason : how === "stop" ? "stop" : how === "login" ? "session" : "logout";
      if (state.kind !== "none") await endViewAs(owner, token, reason, { ip: await requestIp(), via: device?.method ?? null });
    }
  }
  await clearViewAs();
}

/**
 * Единственная проверка записи в режиме «Смотреть как» (этап 63): всё, что меняет данные, проходит через неё
 * (runAction и writingActor в src/lib/action-runner.ts, requireWriteContext, обработчики загрузок). Отказ ошибкой
 * правила, экраны показывают текст как есть. Просмотр идёт: «изменения недоступны». Просмотр закончился, а cookie
 * этой сессии ещё есть: «просмотр закончился, обновите страницу», иначе вкладка, оставшаяся от просмотра, записала бы
 * правку выбранного человека от имени владельца
 */
export function assertWritable(ctx: Pick<AppContext, "viewAs" | "viewAsEnded">): void {
  if (ctx.viewAs) throw new ViewAsReadOnlyError();
  if (ctx.viewAsEnded) throw new ViewAsReadOnlyError(VIEW_AS_ENDED);
}

/** Контекст для действий, которые меняют данные: в режиме «Смотреть как» отказ */
export async function requireWriteContext(): Promise<AppContext> {
  const ctx = await requireContext();
  assertWritable(ctx);
  return ctx;
}

/** cookie просмотра: подписана как сессия, живёт до конца режима управления и ещё VIEW_AS_KEEP_AFTER_MS (не до конца просмотра) */
export async function writeViewAs(token: ViewAsToken, now = Date.now()): Promise<void> {
  const value = await signViewAs(token, sessionSecret(), now);
  const store = await cookies();
  store.set(VIEW_AS_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(),
    path: "/",
    maxAge: Math.max(1, Math.ceil((viewAsKeepUntil(token) - now) / 1000)),
  });
}

export async function clearViewAs(): Promise<void> {
  const store = await cookies();
  store.delete(VIEW_AS_COOKIE);
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
