"use server";

// «Сменить профиль» у владельца (этап 71): владелец при личном входе выбирает человека и входит в его профиль, правки
// идут от имени человека с пометкой в журнале, кто из владельцев вошёл. Выбор, вход и возврат. Правила в
// src/lib/owner-as.ts, журнал начала и конца в src/lib/owner-as-service.ts.

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { clearSession, closeViewAs, readSession, requestIp, requireContext, writeSession, type AppContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadDevice } from "@/lib/login/service";
import { TaskRuleError } from "@/lib/rule-error";
import { OWNER_AS_TEXTS } from "@/lib/owner-as";
import { TEAM_VIEW_COOKIE } from "@/lib/view-as";
import { beginOwnerAs, endOwnerAs, ownerAsPeople, ownerAsTarget, type OwnerAsOwner } from "@/lib/owner-as-service";
import type { ViewAsPerson } from "@/lib/view-as-service";

export type OwnerAsResult<T> = { ok: true; value: T } | { ok: false; error: string };

function ownerOf(ctx: AppContext, ip: string): OwnerAsOwner {
  return { person: ctx.person, sid: ctx.session.sid, via: ctx.via, viewing: !!ctx.viewAs, inside: !!ctx.ownerAs || !!ctx.ownerAsEnded, ip };
}

function failure(what: string, error: unknown): { ok: false; error: string } {
  unstable_rethrow(error);
  if (error instanceof TaskRuleError) return { ok: false, error: error.message };
  console.error(`${what}: не прошло`, error);
  return { ok: false, error: "Не получилось. Обновите страницу и попробуйте ещё раз" };
}

/** Люди для выбора: все включённые люди структуры, кроме самого владельца и других владельцев. Только владельцу при личном входе */
export async function ownerAsPeopleAction(): Promise<OwnerAsResult<ViewAsPerson[]>> {
  try {
    const ctx = await requireContext();
    return { ok: true, value: await ownerAsPeople(ownerOf(ctx, await requestIp())) };
  } catch (error) {
    return failure("Список для «Сменить профиль»", error);
  }
}

/**
 * Войти в профиль выбранного человека: подписанная cookie сессии с номером входа, человеком и сроком (12 часов), режим
 * управления владельца выключается, в журнал «Вход владельца в профиль». Перехода нет: экран сам перезагружает
 * страницу на «Моей неделе», чтобы ни одна отправка прежней страницы не ушла уже от имени выбранного человека
 */
export async function startOwnerAsAction(personId: string): Promise<OwnerAsResult<null>> {
  try {
    const ctx = await requireContext();
    const owner = ownerOf(ctx, await requestIp());
    const target = await ownerAsTarget(owner, String(personId ?? ""));
    // Просмотр «Смотреть как», который закончился сам и ещё не снят, закрывается: он держится на режиме управления
    await closeViewAs("start");
    const grant = await beginOwnerAs(owner, target);
    const { management: _management, ownerAs: _ownerAs, ...rest } = ctx.session;
    await writeSession({ ...rest, ownerAs: grant });
    // Команда, выбранная во входе, живёт в своей cookie: человек начинает со своей команды, выбор владельца не меняется
    (await cookies()).delete(TEAM_VIEW_COOKIE);
    return { ok: true, value: null };
  } catch (error) {
    return failure("Вход в профиль", error);
  }
}

/**
 * «Вернуться в свой профиль»: без пароля, только из сессии этого браузера и только к тому владельцу, который вошёл (он в
 * подписанной сессии и в записи его устройства). В журнал конец входа, если он ещё не записан. Владельца выключили, сняли
 * с него роль или вход на устройстве завершён: возврата нет, сессия заканчивается, экран входа. Удачный возврат без
 * перехода: экран сам перезагружает главную страницу
 */
export async function returnToOwnProfileAction(): Promise<OwnerAsResult<null>> {
  const session = await readSession();
  const grant = session?.ownerAs;
  if (!session || !grant || !session.sid || !session.personId) return { ok: false, error: OWNER_AS_TEXTS.notInside };
  const ip = await requestIp();
  const device = await loadDevice(session.sid);
  const owner = await prisma.person.findUnique({ where: { id: session.personId } });
  if (!owner) {
    await clearSession();
    redirect("/login?ended=1");
  }
  if (!device || device.personId !== owner.id || !owner.active || owner.role !== "OWNER") {
    const reason = !owner.active ? "owner" : !device || device.personId !== owner.id ? "session" : "role";
    await endOwnerAs(owner, grant, reason, { ip, via: session.via ?? null });
    if (device && device.personId === owner.id) await prisma.deviceSession.updateMany({ where: { id: device.id, revokedAt: null }, data: { revokedAt: new Date(), revokedBy: "owner-as" } });
    await clearSession();
    redirect("/login?ended=1");
  }
  await endOwnerAs(owner, grant, "return", { ip, via: device.method });
  const { ownerAs: _ownerAs, management: _management, ...rest } = session;
  await writeSession(rest);
  (await cookies()).delete(TEAM_VIEW_COOKIE);
  return { ok: true, value: null };
}
