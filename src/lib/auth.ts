import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { getEpochs } from "./settings";
import { managementRoleFor, managementRoleOf } from "./roles";
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
import {
  TEAM_VIEW_COOKIE,
  VIEW_AS_COOKIE,
  VIEW_AS_TAB_HEADER,
  ViewAsReadOnlyError,
  parseViewAsTab,
  signViewAs,
  verifyViewAs,
  viewAsEndReason,
  viewAsKeepUntil,
  viewAsOwnSession,
  viewAsWriteRefusal,
  type ViewAsEnd,
  type ViewAsTab,
  type ViewAsToken,
} from "./view-as";
import { endViewAs, viewAsEndRecorded } from "./view-as-service";
import { ownerAsEndReason, ownerAsReturnable, ownerAsWriteRefusal, type OwnerAsEnd } from "./owner-as";
import { endOwnerAs, ownerAsEndRecorded } from "./owner-as-service";
import { teamChoosable } from "./org/people";
import type { OwnerAsGrant } from "./session";
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
  /** Номер просмотра: метка вкладки и связь начала и конца в журнале */
  id: string;
  owner: { id: string; slug: string; fullName: string };
  /** До какого момента действует просмотр, мс с 1970 года */
  until: number;
  /** Сколько просмотру осталось по часам сервера: страница ставит таймер по остатку, а не по часам устройства */
  remainingMs: number;
};

/** Просмотр этой сессии закончился сам, а cookie ещё есть: кого смотрели и почему кончилось */
export type ViewAsEndedInfo = { id: string; target: { id: string; fullName: string } | null; reason: ViewAsEnd };

/** Владелец вошёл в профиль другого человека (этап 71): кто из владельцев и до какого момента */
export type OwnerAsInfo = {
  /** Номер входа: метка вкладки и связь начала и конца в журнале */
  id: string;
  owner: { id: string; slug: string; fullName: string; shortName: string };
  /** До какого момента действует вход, мс с 1970 года */
  until: number;
  /** Сколько входу осталось по часам сервера: страница ставит таймер по остатку, а не по часам устройства */
  remainingMs: number;
};

/** Вход владельца в чужой профиль закончился сам (срок, человека выключили или сделали владельцем), а владелец не вернулся */
export type OwnerAsEndedInfo = { id: string; target: { id: string; fullName: string } | null; reason: OwnerAsEnd };

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
  /**
   * Вход владельца в профиль другого человека (этап 71): person это тот человек, права и правки его, via OWNER_AS,
   * режима управления нет, deviceId null (запись устройства принадлежит владельцу). Иначе null
   */
  ownerAs: OwnerAsInfo | null;
  /**
   * Вход владельца закончился сам (срок, человека выключили или сделали владельцем), а владелец ещё не вернулся в свой
   * профиль: person это сам владелец, но изменения закрыты, пока он не нажмёт «Вернуться в свой профиль». Иначе null
   */
  ownerAsEnded: OwnerAsEndedInfo | null;
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
    if (!device || device.personId !== session.personId || !device.person.active) {
      // Этап 71: вход владельца в чужой профиль кончается вместе с его собственным входом, причина в журнале
      if (session.ownerAs) await closeOwnerAsWithSession(session, session.ownerAs);
      redirect("/login?ended=1");
    }
    await touchDevice(device.id, device.lastSeenAt);
    person = device.person;
    via = device.method;
    deviceId = device.id;
  } else {
    if (session.epoch !== epoch) redirect("/login");
    if ((await getTeamLogin()) === "off") redirect("/login?team=off");
    if (!session.personId) redirect("/choose");
    const found = await prisma.person.findUnique({ where: { id: session.personId } });
    // Этап 71: по общему логину только люди без личного пароля. Человек задал пароль: профиль, выбранный раньше на этом
    // устройстве, больше не открывается, выбор заново
    if (!found || !found.active || !teamChoosable(found)) redirect("/choose");
    person = found;
  }

  // Вход владельца в профиль другого человека (этап 71): проверяется на каждом запросе. Владельца выключили или сняли с
  // него роль: возврата нет, вход на устройстве завершается. Срок вышел, человека выключили или сделали владельцем:
  // владелец снова видит себя, изменения закрыты, пока он не вернётся в свой профиль
  if (session.ownerAs && deviceId) {
    const grant = session.ownerAs;
    const target = await prisma.person.findUnique({ where: { id: grant.targetId } });
    const reason = ownerAsEndReason(grant, person, target) ?? (await ownerAsEndRecorded(person.id, grant));
    if (!reason && target) {
      const info: OwnerAsInfo = { id: grant.id, owner: { id: person.id, slug: person.slug, fullName: person.fullName, shortName: person.shortName }, until: grant.until, remainingMs: grant.until - Date.now() };
      return { session, person: target, management: null, managementRole: null, via: "OWNER_AS", deviceId: null, viewAs: null, viewAsEnded: null, ownerAs: info, ownerAsEnded: null };
    }
    const ended = reason ?? "inactive";
    const meta = { ip: await requestIp(), via };
    if (!ownerAsReturnable(ended)) {
      await prisma.deviceSession.updateMany({ where: { id: deviceId, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: "owner-as" } });
      await endOwnerAs(person, grant, ended, meta);
      redirect("/login?ended=1");
    }
    // Конец пишется первым запросом, который его увидел; повтор исключён по номеру входа
    await endOwnerAs(person, grant, ended, meta);
    return {
      session,
      person,
      management: null,
      managementRole: null,
      via,
      deviceId,
      viewAs: null,
      viewAsEnded: null,
      ownerAs: null,
      ownerAsEnded: { id: grant.id, target: target ? { id: target.id, fullName: target.fullName } : null, reason: ended },
    };
  }

  // Этап 71: режим управления только при личном входе. По общему логину профиль выбирают из списка (там бывает и
  // владелец без личного пароля), поэтому режима управления у такого входа нет, даже если он остался в cookie
  const managementRole = managementRoleOf(person.role, via);
  const grant = activeManagement(session, managementEpoch);
  // Режим управления действует, только если он выдан этой же роли профиля
  const management = grant && managementRole === grant.role ? grant : null;
  // «Смотреть как» (этап 63): проверяется на каждом запросе. Владелец потерял роль или режим управления, выбранного
  // человека выключили, срок вышел: человек снова видит себя, но изменения закрыты, пока он не вернётся к себе
  const state = await viewAsState(session, person, via, management);
  if (state.kind === "active") {
    const target = state.target;
    return { session, person: target, management: null, managementRole: managementRoleFor(target.role), via, deviceId: null, viewAs: state.info, viewAsEnded: null, ownerAs: null, ownerAsEnded: null };
  }
  if (state.kind === "ended") {
    // Конец просмотра пишется первым запросом, который его увидел; повтор исключён по номеру просмотра
    await endViewAs(person, state.token, state.ended.reason, { ip: await requestIp(), via });
  }
  return { session, person, management, managementRole, via, deviceId, viewAs: null, viewAsEnded: state.kind === "ended" ? state.ended : null, ownerAs: null, ownerAsEnded: null };
}

/**
 * Вход владельца в чужой профиль кончается вместе с его собственным входом (этап 71): запись устройства завершена
 * (выход везде, владельца выключили, новый вход в этом браузере) или cookie сменилась. В журнале причина: владелец
 * выключен или вход завершён. Один раз на вход
 */
async function closeOwnerAsWithSession(session: SessionData, grant: OwnerAsGrant, fallback: OwnerAsEnd = "session"): Promise<void> {
  if (!session.personId) return;
  const owner = await prisma.person.findUnique({ where: { id: session.personId }, select: { id: true, fullName: true, active: true } });
  if (!owner) return;
  await endOwnerAs(owner, grant, owner.active ? fallback : "owner", { ip: await requestIp(), via: session.via ?? null });
}

/**
 * Снять вход владельца в чужой профиль из сессии этого браузера при выходе и при новом входе (этап 71): в журнал конец
 * входа с причиной how, если он ещё не записан. Саму cookie сессии меняет или стирает тот, кто вызвал
 */
export async function closeOwnerAs(how: "logout" | "session"): Promise<void> {
  const session = await readSession();
  if (session?.ownerAs) await closeOwnerAsWithSession(session, session.ownerAs, how);
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
  const reason = deviceOk ? (viewAsEndReason(token, who, !!target?.active) ?? (await viewAsEndRecorded(owner.id, token))) : "session";
  if (!reason && target) return { kind: "active", token, target, info: { id: token.id, owner: { id: owner.id, slug: owner.slug, fullName: owner.fullName }, until: token.until, remainingMs: token.until - Date.now() } };
  return { kind: "ended", token, ended: { id: token.id, target: target ? { id: target.id, fullName: target.fullName } : null, reason: reason ?? "inactive" } };
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
export function assertWritable(ctx: Pick<AppContext, "viewAs" | "viewAsEnded"> & Partial<Pick<AppContext, "ownerAs" | "ownerAsEnded">>, tab: ViewAsTab | null = null): void {
  // Этап 71: вход владельца в чужой профиль. Вкладка, показанная для другого профиля, не пишет от имени этого: правка
  // ушла бы не от того имени. После конца входа, пока владелец не вернулся, изменения закрыты
  const own = ownerAsWriteRefusal({ active: ctx.ownerAs?.id ?? null, ended: ctx.ownerAsEnded?.id ?? null }, tab);
  if (own) throw new ViewAsReadOnlyError(own);
  const refusal = viewAsWriteRefusal({ viewing: ctx.viewAs?.id ?? null, ended: ctx.viewAsEnded?.id ?? null }, tab);
  if (refusal) throw new ViewAsReadOnlyError(refusal);
}

/** Метка вкладки из заголовка запроса X-Weekly-View: её добавляет страница (ViewAsSync) к действиям и изменениям через /api */
export async function requestViewAsTab(): Promise<ViewAsTab | null> {
  return parseViewAsTab((await headers()).get(VIEW_AS_TAB_HEADER));
}

/** Контекст для действий, которые меняют данные: в режиме «Смотреть как» и из вкладки, оставшейся от просмотра, отказ */
export async function requireWriteContext(): Promise<AppContext> {
  const ctx = await requireContext();
  assertWritable(ctx, await requestViewAsTab());
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
  // Команда, выбранная в просмотре, живёт отдельно от команды владельца и уходит вместе с просмотром
  store.delete(TEAM_VIEW_COOKIE);
}

/**
 * Владелец или администратор выбран по общему логину (этап 71): режима управления у такого входа нет, и страницы
 * управления не уходят молча на главную, а ведут на /manage с объяснением (MANAGEMENT_TEAM_REFUSAL)
 */
export function teamManagementRefused(ctx: Pick<AppContext, "via" | "person">): boolean {
  return ctx.via === "TEAM" && managementRoleFor(ctx.person.role) !== null;
}

/** Страницы режима управления. roles сужает доступ, например только владельцу */
export async function requireManagement(roles: ManagementRole[] = ["OWNER", "ADMIN"], next = "/"): Promise<AppContext> {
  const ctx = await requireContext();
  if (!ctx.management) {
    if (!ctx.managementRole && !teamManagementRefused(ctx)) redirect("/");
    redirect(`/manage?next=${encodeURIComponent(next)}`);
  }
  if (!roles.includes(ctx.management.role)) redirect("/");
  return ctx;
}
