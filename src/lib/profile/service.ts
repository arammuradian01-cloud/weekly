// Фото и «О себе» в профиле (этап 80) на базе. Меняет сам человек при личном входе или владелец в режиме управления
// (правило в rules.ts), каждая правка в журнале: у фото только «загружено» и «убрано», без самой картинки, у текстов
// было и стало. Видят все, кто вошёл: тексты в карточке человека, фото везде, где аватар.

import { prisma } from "@/lib/db";
import { TaskRuleError } from "@/lib/rule-error";
import type { Actor } from "@/lib/tasks/service";
import type { Prisma } from "@/generated/prisma/client";
import { ABOUT_LABELS, PROFILE_TEXTS, parseAbout, profileEditRefusal, type ProfileAbout } from "./rules";

export type AvatarSize = "large" | "small";

/** Чьё фото меняем: человек по короткому имени или сам действующий. Права проверяются до обработки картинки */
export async function profileTarget(actor: Actor, slug?: string | null): Promise<{ id: string; slug: string; fullName: string }> {
  const wanted = slug && slug.trim() ? slug.trim() : actor.slug;
  const person = await prisma.person.findUnique({ where: { slug: wanted }, select: { id: true, slug: true, fullName: true } });
  if (!person) throw new TaskRuleError(PROFILE_TEXTS.noPerson);
  const refusal = profileEditRefusal(actor, person.id);
  if (refusal) throw new TaskRuleError(refusal);
  return person;
}

const auditBase = (actor: Actor, slug: string) => ({
  actorId: actor.personId,
  actorName: actor.fullName,
  source: "APP" as const,
  entity: "person",
  entityId: slug,
  ip: actor.ip ?? null,
  via: actor.via ?? null,
});

/** Загрузить или заменить фото. Возвращает новую версию для адреса картинки */
export async function savePhoto(actor: Actor, slug: string | null | undefined, input: Uint8Array): Promise<{ version: number }> {
  const target = await profileTarget(actor, slug);
  // sharp подгружается только при загрузке фото: снимок людей на каждой странице берёт из этого модуля лишь версии
  const { makeAvatar } = await import("./image");
  const images = await makeAvatar(input);
  const bytes = images.large.byteLength + images.small.byteLength;
  return prisma.$transaction(async (tx) => {
    const before = await tx.personAvatar.findUnique({ where: { personId: target.id }, select: { bytes: true } });
    const data = { large: images.large, small: images.small, bytes, updatedById: actor.personId };
    const row = await tx.personAvatar.upsert({
      where: { personId: target.id },
      create: { personId: target.id, version: 1, ...data },
      update: { version: { increment: 1 }, ...data },
      select: { version: true },
    });
    await tx.auditLog.create({ data: { ...auditBase(actor, target.slug), action: "profile.photo.upload", field: "Фото", before: before?.bytes ? "было фото" : "без фото", after: "новое фото" } });
    return { version: row.version };
  });
}

/** Убрать фото: снова инициалы. Строка остаётся с новой версией, чтобы браузер не взял прежнее фото из кэша */
export async function removePhoto(actor: Actor, slug?: string | null): Promise<{ version: number }> {
  const target = await profileTarget(actor, slug);
  return prisma.$transaction(async (tx) => {
    const row = await tx.personAvatar.findUnique({ where: { personId: target.id }, select: { bytes: true } });
    if (!row?.bytes) throw new TaskRuleError(PROFILE_TEXTS.noPhoto);
    const next = await tx.personAvatar.update({
      where: { personId: target.id },
      data: { version: { increment: 1 }, large: null, small: null, bytes: 0, updatedById: actor.personId },
      select: { version: true },
    });
    await tx.auditLog.create({ data: { ...auditBase(actor, target.slug), action: "profile.photo.remove", field: "Фото", before: "было фото", after: "без фото" } });
    return { version: next.version };
  });
}

const shown = (key: keyof ProfileAbout, value: string | null): Prisma.InputJsonValue | undefined => (value === null ? undefined : key === "telegram" ? `@${value}` : value);

/** Сохранить «О себе», «Чем могу помочь коллегам» и Telegram. В журнал по записи на каждое изменённое поле */
export async function saveAbout(actor: Actor, slug: string | null | undefined, input: unknown): Promise<ProfileAbout> {
  const target = await profileTarget(actor, slug);
  const parsed = parseAbout(input);
  if (!parsed.ok) throw new TaskRuleError(parsed.error);
  const next = parsed.value;
  return prisma.$transaction(async (tx) => {
    const before = await tx.person.findUniqueOrThrow({ where: { id: target.id }, select: { about: true, helpWith: true, telegram: true } });
    const changed = (Object.keys(ABOUT_LABELS) as (keyof ProfileAbout)[]).filter((k) => (before[k] ?? null) !== next[k]);
    if (!changed.length) return next;
    await tx.person.update({ where: { id: target.id }, data: next });
    for (const k of changed) {
      await tx.auditLog.create({ data: { ...auditBase(actor, target.slug), action: "profile.about", field: ABOUT_LABELS[k], before: shown(k, before[k] ?? null), after: shown(k, next[k]) } });
    }
    return next;
  });
}

/** Карточка человека: фото и тексты «О себе». Видит любой, кто вошёл; выключенного человека нет */
export type PersonProfile = ProfileAbout & { slug: string; fullName: string; avatar: number | null };

export async function personProfile(slug: string): Promise<PersonProfile | null> {
  const person = await prisma.person.findUnique({
    where: { slug: String(slug ?? "") },
    select: { slug: true, fullName: true, active: true, about: true, helpWith: true, telegram: true, avatar: { select: { version: true, bytes: true } } },
  });
  if (!person || !person.active) return null;
  return { slug: person.slug, fullName: person.fullName, about: person.about, helpWith: person.helpWith, telegram: person.telegram, avatar: person.avatar?.bytes ? person.avatar.version : null };
}

/** Версии фото всех людей с фото по id: для снимка людей на экранах */
export async function avatarVersions(): Promise<Map<string, number>> {
  const rows = await prisma.personAvatar.findMany({ where: { bytes: { gt: 0 } }, select: { personId: true, version: true } });
  return new Map(rows.map((r) => [r.personId, r.version]));
}

/** Картинка фото для отдачи: текущая версия и байты нужного размера, или null, если фото нет */
export async function avatarImage(slug: string, size: AvatarSize): Promise<{ personId: string; version: number; data: Uint8Array } | null> {
  const row = await prisma.personAvatar.findFirst({
    where: { person: { slug }, bytes: { gt: 0 } },
    select: { personId: true, version: true, large: size === "large", small: size === "small" },
  });
  const data = row ? (size === "large" ? row.large : row.small) : null;
  if (!row || !data) return null;
  return { personId: row.personId, version: row.version, data };
}
