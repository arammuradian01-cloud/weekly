// Настройки ресурса: люди и роли, справочники, ритм недели (разделы 2, 3 и 6 ТЗ).
// Права по матрице раздела 2: справочники и ритм недели правят владелец и администраторы в режиме управления,
// людей и роли меняет только владелец. Каждая правка пишется в журнал с тем, что было и что стало.

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { slugify, uniqueSlug } from "@/lib/translit";
import { ROLE_LABELS } from "@/lib/roles";
import { DICT_TITLES, WEEKDAYS } from "./labels";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { deadlineOf, meetingOf } from "@/lib/weekly/weeks";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import type { DeadlineSetting } from "@/lib/week";
import type { MeetingSetting } from "@/lib/weekly/weeks";
import type { EditableDictKind } from "@/domain/dictionaries";
import type { Prisma, Role } from "@/generated/prisma/client";
import { ReloadProblemsError, planReload, reloadFromBord, type ReloadPlan, type ReloadResult } from "./reload";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};


const LIMITS = { label: 60, fullName: 80, shortName: 30, zone: 120 };

/** Справочники и ритм недели: владелец и администраторы в режиме управления */
export function canEditDictionaries(actor: Pick<Actor, "management" | "role">): boolean {
  return actor.role !== "OBSERVER" && actor.management !== null;
}

/** Люди, роли, пароли и синхронизация: только владелец в режиме управления */
export function canManagePeople(actor: Pick<Actor, "management" | "role">): boolean {
  return actor.role !== "OBSERVER" && actor.management === "OWNER";
}

function requireDictionaries(actor: Actor) {
  if (!canEditDictionaries(actor)) fail("Справочники и ритм недели меняют владелец и администраторы в режиме управления");
}

function requirePeople(actor: Actor) {
  if (!canManagePeople(actor)) fail("Людей и роли меняет только владелец в режиме управления");
}

function text(value: string | null | undefined, max: number, emptyMessage: string, field: string): string {
  const v = (value ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
  if (!v) fail(emptyMessage);
  if (v.length > max) fail(`${field} длиннее ${max} знаков`);
  return v;
}

async function audit(tx: Tx, actor: Actor, action: string, entity: string, entityId: string, field: string, before?: string | null, after?: string | null) {
  await tx.auditLog.create({
    data: {
      action,
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP",
      entity,
      entityId,
      field,
      before: before ?? undefined,
      after: after ?? undefined,
      ip: actor.ip ?? null,
    },
  });
}

// Справочники

export type DictItemView = { code: string; label: string; active: boolean; used: number };

/** Справочники для экрана настроек: значения со счётчиком, сколько записей и задач на них ссылается */
export async function listDictionaries(): Promise<Record<EditableDictKind, DictItemView[]>> {
  const items = await prisma.dictionaryItem.findMany({
    where: { kind: { in: Object.keys(DICT_TITLES) as EditableDictKind[] } },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    include: { _count: { select: { tasks: true, entriesByDirection: true, entriesByBlock: true, entriesByType: true, people: true } } },
  });
  const sources = await prisma.task.groupBy({ by: ["sourceCode"], _count: { _all: true } });
  const result = { DIRECTION: [], WEEKLY_BLOCK: [], ENTRY_TYPE: [], TASK_SOURCE: [] } as Record<EditableDictKind, DictItemView[]>;
  for (const i of items) {
    const c = i._count;
    const used =
      i.kind === "TASK_SOURCE"
        ? (sources.find((s) => s.sourceCode === i.code)?._count._all ?? 0)
        : c.tasks + c.entriesByDirection + c.entriesByBlock + c.entriesByType + c.people;
    result[i.kind as EditableDictKind].push({ code: i.code, label: i.label, active: i.active, used });
  }
  return result;
}

function checkKind(kind: string): EditableDictKind {
  if (!(kind in DICT_TITLES)) fail("Такого справочника нет");
  return kind as EditableDictKind;
}

export async function addDictItem(actor: Actor, kindInput: string, labelInput: string) {
  requireDictionaries(actor);
  const kind = checkKind(kindInput);
  if (kind === "ENTRY_TYPE") fail("Новые типы записей не добавляются: на них держатся разделы отчёта CEO. Тип можно переименовать или скрыть");
  const label = text(labelInput, LIMITS.label, "Напишите название", "Название");
  return prisma.$transaction(async (tx) => {
    const items = await tx.dictionaryItem.findMany({ where: { kind } });
    if (items.some((i) => i.label.toLowerCase() === label.toLowerCase())) fail(`«${label}» уже есть в справочнике`);
    const code = uniqueSlug(slugify(label), items.map((i) => i.code));
    const sortOrder = Math.max(0, ...items.map((i) => i.sortOrder)) + 10;
    await tx.dictionaryItem.create({ data: { kind, code, label, sortOrder, active: true } });
    await audit(tx, actor, "settings.dict.create", "dict", `${kind}/${code}`, DICT_TITLES[kind], null, label);
    return { code, label };
  });
}

export async function renameDictItem(actor: Actor, kindInput: string, code: string, labelInput: string) {
  requireDictionaries(actor);
  const kind = checkKind(kindInput);
  const label = text(labelInput, LIMITS.label, "Напишите название", "Название");
  return prisma.$transaction(async (tx) => {
    const items = await tx.dictionaryItem.findMany({ where: { kind } });
    const item = items.find((i) => i.code === code);
    if (!item) return fail("Такого значения уже нет");
    if (item.label === label) return { code, label };
    if (items.some((i) => i.code !== code && i.label.toLowerCase() === label.toLowerCase())) fail(`«${label}» уже есть в справочнике`);
    await tx.dictionaryItem.update({ where: { id: item.id }, data: { label } });
    await audit(tx, actor, "settings.dict.rename", "dict", `${kind}/${code}`, `${DICT_TITLES[kind]}: название`, item.label, label);
    return { code, label };
  });
}

export async function setDictItemActive(actor: Actor, kindInput: string, code: string, active: boolean) {
  requireDictionaries(actor);
  const kind = checkKind(kindInput);
  return prisma.$transaction(async (tx) => {
    const items = await tx.dictionaryItem.findMany({ where: { kind } });
    const item = items.find((i) => i.code === code);
    if (!item) return fail("Такого значения уже нет");
    if (item.active === active) return { code, active };
    if (!active && items.filter((i) => i.active).length <= 1) fail("Последнее видимое значение скрыть нельзя: из списка нечего будет выбрать");
    await tx.dictionaryItem.update({ where: { id: item.id }, data: { active } });
    await audit(
      tx,
      actor,
      active ? "settings.dict.show" : "settings.dict.hide",
      "dict",
      `${kind}/${code}`,
      `${DICT_TITLES[kind]}: «${item.label}»`,
      active ? "скрыто" : "в списке",
      active ? "в списке" : "скрыто",
    );
    return { code, active };
  });
}

// Люди и роли

export type PersonView = {
  slug: string;
  fullName: string;
  shortName: string;
  role: Role;
  zone: string;
  direction: string;
  active: boolean;
  openTasks: number;
};

export async function listPeople(): Promise<PersonView[]> {
  const people = await prisma.person.findMany({
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { fullName: "asc" }],
    include: { defaultDirection: true, _count: { select: { ownedTasks: { where: { status: { in: ["IN_PROGRESS", "CLARIFY", "PROPOSED"] }, archivedAt: null } } } } },
  });
  return people.map((p) => ({
    slug: p.slug,
    fullName: p.fullName,
    shortName: p.shortName,
    role: p.role,
    zone: p.zone,
    direction: p.defaultDirection?.code ?? "",
    active: p.active,
    openTasks: p._count.ownedTasks,
  }));
}

export type PersonInput = { fullName: string; shortName?: string; role: string; zone: string; direction: string };

const ROLES: Role[] = ["OWNER", "ADMIN", "LEADER", "OBSERVER"];

function checkRole(role: string): Role {
  if (!ROLES.includes(role as Role)) fail("Выберите роль из списка");
  return role as Role;
}

async function directionOf(tx: Tx, code: string, currentId?: string | null) {
  const d = await tx.dictionaryItem.findFirst({ where: { kind: "DIRECTION", code } });
  if (!d || (!d.active && d.id !== currentId)) fail("Выберите направление из списка");
  return d!;
}

/** Без владельца в ресурсе некому менять людей и роли: последнего владельца выключить или понизить нельзя */
async function keepOwner(tx: Tx, slug: string) {
  const owners = await tx.person.count({ where: { role: "OWNER", active: true, slug: { not: slug } } });
  if (owners === 0) fail("В ресурсе должен остаться хотя бы один включённый владелец");
}

export async function createPerson(actor: Actor, input: PersonInput) {
  requirePeople(actor);
  const fullName = text(input.fullName, LIMITS.fullName, "Напишите фамилию и имя", "Фамилия и имя");
  const [last, first] = fullName.split(" ");
  const shortName = text(input.shortName || first || last, LIMITS.shortName, "Напишите короткое имя", "Короткое имя");
  const zone = text(input.zone, LIMITS.zone, "Напишите зону ответственности", "Зона");
  const role = checkRole(input.role);
  return prisma.$transaction(async (tx) => {
    const direction = await directionOf(tx, input.direction);
    const all = await tx.person.findMany({ select: { slug: true, fullName: true, sortOrder: true, active: true } });
    if (all.some((p) => p.active && p.fullName.toLowerCase() === fullName.toLowerCase())) fail(`${fullName} уже есть в команде`);
    // «all» и «system» заняты: так ресурс помечает «Все лидеры» и события системы
    const slug = uniqueSlug(slugify(last ?? fullName, 24), [...all.map((p) => p.slug), "all", "system"]);
    const sortOrder = Math.max(0, ...all.map((p) => p.sortOrder)) + 10;
    await tx.person.create({ data: { slug, fullName, shortName, role, zone, defaultDirectionId: direction.id, sortOrder, active: true } });
    await audit(tx, actor, "settings.person.create", "person", slug, "Человек добавлен", null, `${fullName}, ${ROLE_LABELS[role].toLowerCase()}, ${zone}`);
    return { slug };
  });
}

export async function updatePerson(actor: Actor, slug: string, input: Partial<PersonInput>) {
  requirePeople(actor);
  return prisma.$transaction(async (tx) => {
    const p = await tx.person.findUnique({ where: { slug }, include: { defaultDirection: true } });
    if (!p) return fail("Такого человека уже нет");
    const data: Prisma.PersonUncheckedUpdateInput = {};
    const changes: [string, string | null, string][] = [];
    if (input.fullName !== undefined) {
      const v = text(input.fullName, LIMITS.fullName, "Напишите фамилию и имя", "Фамилия и имя");
      if (v !== p.fullName) {
        data.fullName = v;
        changes.push(["Фамилия и имя", p.fullName, v]);
      }
    }
    if (input.shortName !== undefined) {
      const v = text(input.shortName, LIMITS.shortName, "Напишите короткое имя", "Короткое имя");
      if (v !== p.shortName) {
        data.shortName = v;
        changes.push(["Короткое имя", p.shortName, v]);
      }
    }
    if (input.zone !== undefined) {
      const v = text(input.zone, LIMITS.zone, "Напишите зону ответственности", "Зона");
      if (v !== p.zone) {
        data.zone = v;
        changes.push(["Зона", p.zone, v]);
      }
    }
    if (input.role !== undefined) {
      const role = checkRole(input.role);
      if (role !== p.role) {
        if (p.role === "OWNER") await keepOwner(tx, slug);
        data.role = role;
        changes.push(["Роль", ROLE_LABELS[p.role], ROLE_LABELS[role]]);
      }
    }
    if (input.direction !== undefined && input.direction !== p.defaultDirection?.code) {
      const d = await directionOf(tx, input.direction, p.defaultDirectionId);
      data.defaultDirectionId = d.id;
      changes.push(["Направление по умолчанию", p.defaultDirection?.label ?? null, d.label]);
    }
    if (!changes.length) return { slug, changed: 0 };
    await tx.person.update({ where: { slug }, data });
    for (const [field, before, after] of changes) await audit(tx, actor, "settings.person.update", "person", slug, field, before, after);
    return { slug, changed: changes.length };
  });
}

export async function setPersonActive(actor: Actor, slug: string, active: boolean) {
  requirePeople(actor);
  if (!active && slug === actor.slug) fail("Себя выключить нельзя");
  return prisma.$transaction(async (tx) => {
    const p = await tx.person.findUnique({ where: { slug } });
    if (!p) return fail("Такого человека уже нет");
    if (p.active === active) return { slug, active };
    if (!active && p.role === "OWNER") await keepOwner(tx, slug);
    await tx.person.update({ where: { slug }, data: { active } });
    await audit(tx, actor, active ? "settings.person.enable" : "settings.person.disable", "person", slug, "В команде", active ? "выключен" : "да", active ? "да" : "выключен");
    return { slug, active };
  });
}

// Ритм недели

export type Rhythm = { deadlineWeekday: number; deadlineTime: string; meetingWeekday: number; staleDays: number };

export async function getRhythm(): Promise<Rhythm> {
  const [deadline, meeting, staleDays] = await Promise.all([
    getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" }),
    getSetting<MeetingSetting>("week.meeting", { weekday: 2 }),
    getSetting<number>("tasks.staleDays", 14),
  ]);
  return { deadlineWeekday: deadline.weekday, deadlineTime: deadline.time, meetingWeekday: meeting.weekday, staleDays };
}

const weekdayWord = (n: number) => WEEKDAYS[n - 1] ?? String(n);

/**
 * Новый срок сдачи и день встречи действуют для недель, срок которых ещё не прошёл: их срок и встреча пересчитываются.
 * Прошедшие и закрытые недели остаются как были, чтобы «сдан с опозданием» не менялся задним числом
 */
export async function saveRhythm(actor: Actor, input: Rhythm, now = new Date()) {
  requireDictionaries(actor);
  const okDay = (n: number) => Number.isInteger(n) && n >= 1 && n <= 7;
  if (!okDay(input.deadlineWeekday) || !okDay(input.meetingWeekday)) fail("Выберите день недели из списка");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.deadlineTime)) fail("Время сдачи пишется как 18:00");
  if (!Number.isInteger(input.staleDays) || input.staleDays < 1 || input.staleDays > 90) fail("Порог «давно не обновлялась»: от 1 до 90 дней");
  const before = await getRhythm();
  const changes: [string, string, string][] = [];
  if (before.deadlineWeekday !== input.deadlineWeekday || before.deadlineTime !== input.deadlineTime)
    changes.push(["Срок сдачи weekly", `${weekdayWord(before.deadlineWeekday)}, ${before.deadlineTime}`, `${weekdayWord(input.deadlineWeekday)}, ${input.deadlineTime}`]);
  if (before.meetingWeekday !== input.meetingWeekday) changes.push(["День встречи", weekdayWord(before.meetingWeekday), weekdayWord(input.meetingWeekday)]);
  if (before.staleDays !== input.staleDays) changes.push(["Давно не обновлялась, дней", String(before.staleDays), String(input.staleDays)]);
  if (!changes.length) return { changed: 0, weeks: 0 };

  const deadline: DeadlineSetting = { weekday: input.deadlineWeekday, time: input.deadlineTime };
  const meeting: MeetingSetting = { weekday: input.meetingWeekday };
  return prisma.$transaction(async (tx) => {
    const put = (key: string, value: Prisma.InputJsonValue) => tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    await put("week.deadline", deadline as unknown as Prisma.InputJsonValue);
    await put("week.meeting", meeting as unknown as Prisma.InputJsonValue);
    await put("tasks.staleDays", input.staleDays);
    const open = await tx.week.findMany({ where: { closedAt: null, deadline: { gt: now } } });
    for (const w of open) {
      const key = isoFromDbDate(w.start);
      await tx.week.update({ where: { id: w.id }, data: { deadline: deadlineOf(key, deadline), meetingDate: dbDate(meetingOf(key, meeting)) } });
    }
    for (const [field, b, a] of changes) await audit(tx, actor, "settings.update", "settings", "rhythm", field, b, a);
    return { changed: changes.length, weeks: open.length };
  });
}

/** Плашка над страницами: тестовый стенд, пилот или без плашки. Меняет только владелец */
export const STAND_BANNERS = ["test", "pilot", "off"] as const;
export type StandBanner = (typeof STAND_BANNERS)[number];
const STAND_BANNER_LABELS: Record<StandBanner, string> = { test: "Тестовый стенд", pilot: "Пилот", off: "Без плашки" };

export async function getStandBanner(): Promise<StandBanner> {
  const value = await getSetting<string>("stand.banner", "test");
  return (STAND_BANNERS as readonly string[]).includes(value) ? (value as StandBanner) : "test";
}

export async function saveStandBanner(actor: Actor, mode: StandBanner): Promise<StandBanner> {
  requirePeople(actor);
  if (!(STAND_BANNERS as readonly string[]).includes(mode)) fail("Выберите вид плашки из списка");
  const before = await getStandBanner();
  if (before === mode) return mode;
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { key: "stand.banner" }, update: { value: mode }, create: { key: "stand.banner", value: mode } });
    await audit(tx, actor, "settings.banner", "settings", "stand.banner", "Плашка над страницами", STAND_BANNER_LABELS[before], STAND_BANNER_LABELS[mode]);
  });
  return mode;
}

// Перезаливка из выгрузки Bord: только владелец и только до пилота, пока плашка «Тестовый стенд»

/** Слово, которое владелец вводит перед перезаливкой */
export const RELOAD_CONFIRM_WORD = "перезалить";
const RELOAD_LIMIT = 2_000_000;

async function requireReload(actor: Actor, tasksText: string, weeklyText: string) {
  requirePeople(actor);
  if ((await getStandBanner()) !== "test") {
    fail("Перезаливка доступна только до пилота, пока в настройках выбрана плашка «Тестовый стенд»");
  }
  if (!tasksText.trim() || !weeklyText.trim()) fail("Выберите оба файла: CSV вкладки «Задачи» и CSV вкладки «Weekly CEO»");
  if (tasksText.length > RELOAD_LIMIT || weeklyText.length > RELOAD_LIMIT) fail("Файл больше 2 МБ: скачайте только одну вкладку, «Файл», «Скачать», «CSV»");
}

/** Пробный запуск: что сейчас в базе, сколько строк в выгрузке и почему её не загрузить */
export async function previewReload(actor: Actor, tasksText: string, weeklyText: string): Promise<ReloadPlan> {
  await requireReload(actor, tasksText, weeklyText);
  return planReload(prisma, tasksText, weeklyText);
}

export async function runReload(actor: Actor, tasksText: string, weeklyText: string, confirm: string, now = new Date()): Promise<ReloadResult> {
  await requireReload(actor, tasksText, weeklyText);
  if (confirm.trim().toLowerCase() !== RELOAD_CONFIRM_WORD) fail(`Чтобы перезалить, введите слово «${RELOAD_CONFIRM_WORD}»`);
  try {
    return await reloadFromBord(prisma, tasksText, weeklyText, {
      batch: `bord-${now.toISOString().slice(0, 10)}`,
      actor: { personId: actor.personId, name: actor.fullName, source: "APP", ip: actor.ip ?? null },
    });
  } catch (error) {
    if (error instanceof ReloadProblemsError) fail(`Выгрузку не загрузить, база не тронута: ${error.problems.slice(0, 5).join("; ")}`);
    throw error;
  }
}
