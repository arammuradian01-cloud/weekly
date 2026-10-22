// Weekly-проекты руководителей (этап 57). Решение Арама 21.10: приложение для всей компании. Готовые команды
// департаментов собраны по структуре (страхование и инвестиции, Money, партнёрка и другие), и любой руководитель
// перетаскивает к себе готовую команду или отдельных людей, чтобы собрать свой weekly-проект. Люди своей ветки входят
// сразу, люди из других веток после согласия своего непосредственного руководителя по структуре (как в этапе 53).
//
// Проект это обычная команда (kind CUSTOM) со своим weekly и задачами: руководитель проекта ведёт её, видит weekly и
// задачи участников в ней. Проект встаёт под команду руководителя по структуре, иначе туда же, куда загрузка
// структуры ставит команды без команды выше (под команду генерального директора).
//
// Пачка людей добавляется одной транзакцией: права на команду проверяются один раз, ветка и согласующий считаются по
// карте руководителей в памяти, руководитель человека получает одно событие на пачку, а не по событию на человека.
// Параллельные пачки в одну команду идут по очереди (блокировка на команду), второй ожидающий запрос на того же
// человека запрещён уникальным индексом.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { canManagePeople } from "@/lib/admin/service";
import { notify } from "@/lib/inbox/notify";
import { TOP_TEAM } from "./scope";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const NAME_MAX = 120;
/** Сколько людей за раз: департамент целиком помещается, вся компания нет */
export const BATCH_MAX = 150;
/** Сколько своих проектов у руководителя одновременно */
export const PROJECTS_MAX = 20;

const teamLogin = (actor: Pick<Actor, "via" | "management">) => actor.via === "TEAM" && !actor.management;

/**
 * Кто собирает проекты: руководители (по роли, по команде или по подразделению в структуре), администраторы и
 * владельцы при личном входе. Руководители из загруженной структуры приходят с ролью сотрудника, поэтому для них
 * смотрим, руководят ли они командой или подразделением
 */
export async function canCreateProject(actor: Pick<Actor, "personId" | "role" | "via" | "management">, db: Tx | typeof prisma = prisma): Promise<boolean> {
  if (actor.role === "OBSERVER") return false;
  if (teamLogin(actor)) return false;
  if (actor.role !== "EMPLOYEE") return true;
  // По очереди: внутри транзакции это одно соединение
  const teams = await db.team.count({ where: { leaderId: actor.personId, active: true } });
  if (teams) return true;
  return (await db.orgUnit.count({ where: { headId: actor.personId, active: true } })) > 0;
}

/** Название: пробелы схлопнуты, длинное тире заменено, длина ограничена */
function cleanName(value: unknown): string {
  const name = String(value ?? "").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
  if (!name) fail("Напишите название команды");
  if (name.length > NAME_MAX) fail(`Название длиннее ${NAME_MAX} знаков`);
  return name;
}

async function audit(tx: Tx, actor: Actor, action: string, entityId: string, field: string, before: string | null, after: string | null) {
  await tx.auditLog.create({ data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "team", entityId, field, before: before ?? undefined, after: after ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null } });
}

/** Люди подразделения со всеми подразделениями ниже. Корень компании целиком не берётся: это не команда, а все */
export async function unitPeople(unitId: string): Promise<string[]> {
  const units = await prisma.orgUnit.findMany({ where: { active: true }, select: { id: true, parentId: true, kind: true } });
  const root = units.find((u) => u.id === unitId);
  if (!root) fail("Такого подразделения нет");
  if (root!.kind === "COMPANY") fail("Всю компанию в команду не добавить: выберите департамент или подразделение");
  const below = new Set<string>([unitId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units)
      if (u.parentId && below.has(u.parentId) && !below.has(u.id)) {
        below.add(u.id);
        grew = true;
      }
  }
  const people = await prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" }, unitId: { in: [...below] } }, select: { slug: true } });
  return people.map((p) => p.slug);
}

/** Куда встаёт новый проект: под команду его руководителя по структуре, иначе под команду генерального директора */
async function parentFor(tx: Tx, leaderId: string): Promise<string | null> {
  const own = await tx.team.findFirst({ where: { leaderId, active: true, kind: { in: ["TOP", "UNIT"] } }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }], select: { id: true } });
  if (own) return own.id;
  const company = await tx.orgUnit.findFirst({ where: { kind: "COMPANY", active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  // Структура одного департамента, как до этапа 53: команды без команды выше стоят под топ-командой
  if (!company) return TOP_TEAM;
  const companyTeam = await tx.team.findFirst({ where: { unitId: company.id, active: true, kind: "UNIT" }, select: { id: true } });
  return companyTeam?.id ?? null;
}

/**
 * Новый проект. Руководит им тот, кто создаёт, либо (этап 64) человек, которого сразу назначил владелец в режиме
 * управления: тогда место в дереве, дубль названия, предел своих команд и очередь считаются по руководителю, как
 * будто он создал команду сам
 */
async function createIn(tx: Tx, actor: Actor, rawName: unknown, leaderSlug?: string | null): Promise<{ id: string; name: string; leaderName: string }> {
  if (!(await canCreateProject(actor, tx))) fail(teamLogin(actor) ? "Команду собирают, войдя лично, со своим логином и паролем" : "Команды собирают руководители");
  const name = cleanName(rawName);
  let leader = { id: actor.personId, fullName: actor.fullName };
  if (leaderSlug && leaderSlug !== actor.slug) {
    if (!canManagePeople(actor)) fail("Другого руководителя назначает владелец в режиме управления: создайте команду и назначьте его в карточке");
    const p = await tx.person.findUnique({ where: { slug: String(leaderSlug) }, select: { id: true, fullName: true, active: true, role: true } });
    if (!p) fail("Такого человека нет");
    if (!p!.active) fail(`${p!.fullName} выключен`);
    if (p!.role === "OBSERVER") fail("Наблюдатель командой не руководит");
    leader = { id: p!.id, fullName: p!.fullName };
  }
  const own = leader.id === actor.personId;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`projects:${leader.id}`}))`;
  const same = await tx.team.findFirst({ where: { leaderId: leader.id, active: true, name } });
  if (same) fail(own ? `Команда «${name}» у вас уже есть` : `Команда «${name}» у ${leader.fullName} уже есть`);
  const mine = await tx.team.count({ where: { leaderId: leader.id, active: true, project: true } });
  if (mine >= PROJECTS_MAX) fail(own ? `У вас уже ${PROJECTS_MAX} своих команд: закройте те, что больше не нужны` : `У ${leader.fullName} уже ${PROJECTS_MAX} своих команд: пусть закроет те, что больше не нужны`);
  const count = await tx.team.count();
  const team = await tx.team.create({ data: { name, kind: "CUSTOM", project: true, leaderId: leader.id, parentId: await parentFor(tx, leader.id), sortOrder: (count + 1) * 10 } });
  await audit(tx, actor, "team.create", team.id, "Weekly-проект создан", null, `${name}, руководитель ${leader.fullName}`);
  return { id: team.id, name, leaderName: leader.fullName };
}

/** Новый weekly-проект: команда, которой руководит тот, кто её собирает */
export async function createProject(actor: Actor, input: { name: string }): Promise<{ id: string; name: string }> {
  return prisma.$transaction(async (tx) => {
    const { id, name } = await createIn(tx, actor, input?.name);
    return { id, name };
  });
}

export type AddPeopleResult = {
  added: string[];
  requested: { name: string; approver: string }[];
  /** Уже в проекте или уже ждут согласия: не ошибка, просто ничего не поменялось */
  already: string[];
  skipped: { name: string; reason: string }[];
};

type PersonRow = { id: string; slug: string; fullName: string; active: boolean; role: string; managerId: string | null; unitId: string | null };

async function addIn(tx: Tx, actor: Actor, teamId: string, slugs: string[], now: Date): Promise<AddPeopleResult> {
  const list = [...new Set((Array.isArray(slugs) ? slugs : []).map(String).filter(Boolean))];
  if (!list.length) fail("Выберите людей");
  if (list.length > BATCH_MAX) fail(`За раз можно добавить до ${BATCH_MAX} человек: выберите подразделение поменьше`);
  const owner = canManagePeople(actor);
  if (!owner) {
    if (actor.role === "OBSERVER") fail("Наблюдатель команды не меняет");
    if (teamLogin(actor)) fail("Состав команды руководитель меняет, войдя лично, со своим логином и паролем");
  }
  // Сначала блокировка, потом команда: закрытие проекта и другая пачка ждут, пока эта не закончится
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team:${String(teamId)}`}))`;
  // Права на команду один раз, до людей
  const team = await tx.team.findUnique({ where: { id: String(teamId) }, include: { leader: { select: { fullName: true } } } });
  if (!team || !team.active) fail("Такой команды нет или она закрыта");
  if (!owner && (team!.id === TOP_TEAM || team!.leaderId !== actor.personId)) fail("Состав команды меняют её руководитель и владелец в режиме управления");

  // По очереди: внутри транзакции запросы и так идут одним соединением
  const people = await tx.person.findMany({ select: { id: true, slug: true, fullName: true, active: true, role: true, managerId: true, unitId: true } });
  const units = await tx.orgUnit.findMany({ where: { active: true }, select: { id: true, parentId: true, headId: true } });
  const members = await tx.teamMember.findMany({ where: { teamId: team!.id }, select: { personId: true } });
  const waiting = await tx.teamJoinRequest.findMany({ where: { teamId: team!.id, status: "PENDING" }, select: { personId: true } });
  const byId = new Map(people.map((p) => [p.id, p]));
  const bySlug = new Map(people.map((p) => [p.slug, p]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const inTeam = new Set(members.map((m) => m.personId));
  const pending = new Set(waiting.map((w) => w.personId));
  const leaderId = team!.leaderId;

  /** В ветке руководителя команды: он выше по цепочке руководителей */
  const inBranch = (p: PersonRow) => {
    if (!leaderId) return false;
    const seen = new Set<string>();
    for (let cur = p.managerId; cur && !seen.has(cur); cur = byId.get(cur)?.managerId ?? null) {
      if (cur === leaderId) return true;
      seen.add(cur);
    }
    return false;
  };
  /** Кто соглашается: включённый руководитель человека, иначе руководитель подразделения выше */
  const approverOf = (p: PersonRow): PersonRow | null => {
    const m = p.managerId ? byId.get(p.managerId) : undefined;
    if (m?.active) return m;
    const seen = new Set<string>();
    for (let u = p.unitId ? unitById.get(p.unitId) : undefined; u && !seen.has(u.id); u = u.parentId ? unitById.get(u.parentId) : undefined) {
      seen.add(u.id);
      const h = u.headId && u.headId !== p.id ? byId.get(u.headId) : undefined;
      if (h?.active) return h;
    }
    return null;
  };

  const out: AddPeopleResult = { added: [], requested: [], already: [], skipped: [] };
  const join: { person: PersonRow; external: boolean }[] = [];
  const asks = new Map<string, { approver: PersonRow; people: PersonRow[] }>();
  for (const slug of list) {
    const p = bySlug.get(slug);
    if (!p) {
      out.skipped.push({ name: slug, reason: "Такого человека нет" });
      continue;
    }
    // Руководитель проекта в нём и так: молча пропускаем, это не ошибка копии подразделения
    if (p.id === leaderId) continue;
    if (!p.active) {
      out.skipped.push({ name: p.fullName, reason: `${p.fullName} выключен` });
      continue;
    }
    if (p.role === "OBSERVER") {
      out.skipped.push({ name: p.fullName, reason: "Наблюдатель в командах не состоит" });
      continue;
    }
    if (inTeam.has(p.id) || pending.has(p.id)) {
      out.already.push(p.fullName);
      continue;
    }
    // Команда без руководителя: ветки нет, как в addTeamMember пометку «из другой ветки» не ставим
    const external = leaderId ? !inBranch(p) : false;
    if (!external || owner) {
      join.push({ person: p, external });
      continue;
    }
    const approver = approverOf(p);
    if (!approver) {
      out.skipped.push({ name: p.fullName, reason: `У ${p.fullName} в структуре нет руководителя, согласовать некому` });
      continue;
    }
    // Добавляет сам руководитель человека: его согласие уже есть
    if (approver.id === actor.personId) {
      join.push({ person: p, external });
      continue;
    }
    const group = asks.get(approver.id) ?? { approver, people: [] };
    group.people.push(p);
    asks.set(approver.id, group);
  }

  const leaderName = team!.leader?.fullName ?? "руководитель не назначен";
  if (join.length) {
    await tx.teamMember.createMany({ data: join.map((j) => ({ teamId: team!.id, personId: j.person.id, addedById: actor.personId, external: j.external })), skipDuplicates: true });
    await tx.auditLog.createMany({
      data: join.map((j) => ({ action: "team.member.add", actorId: actor.personId, actorName: actor.fullName, source: "APP" as const, entity: "team", entityId: team!.id, field: `Участник добавлен: ${team!.name}`, after: j.external ? `${j.person.fullName} (из другой ветки)` : j.person.fullName, ip: actor.ip ?? null, via: actor.via ?? null })),
    });
    out.added.push(...join.map((j) => j.person.fullName));
    // Из другой ветки сразу (режим управления или согласие уже есть): каждый человек узнаёт в «Мне», а его
    // руководитель получает одно событие на пачку со списком
    const informed = new Map<string, { approver: PersonRow; people: PersonRow[] }>();
    for (const j of join.filter((x) => x.external)) {
      await notify(tx, { kind: "TEAM", recipients: [j.person.id], actor: { personId: actor.personId, fullName: actor.fullName }, subject: `team:${team!.id}:${j.person.id}`, text: `Вы в команде «${team!.name}», руководитель ${leaderName}` }, now);
      const a = approverOf(j.person);
      if (!a || a.id === leaderId || a.id === actor.personId) continue;
      const g = informed.get(a.id) ?? { approver: a, people: [] };
      g.people.push(j.person);
      informed.set(a.id, g);
    }
    for (const { approver, people: group } of informed.values()) {
      const names = group.filter((p) => p.id !== approver.id).map((p) => p.fullName);
      if (!names.length) continue;
      const who = names.length === 1 ? `${names[0]} в команде` : `Ваши сотрудники (${names.length}) в команде: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` и ещё ${names.length - 5}` : ""},`;
      await notify(tx, { kind: "TEAM", recipients: [approver.id], actor: { personId: actor.personId, fullName: actor.fullName }, subject: `team:${team!.id}:${group[0]!.id}`, text: `${who} «${team!.name}», руководитель ${leaderName}` }, now);
    }
  }
  for (const { approver, people: group } of asks.values()) {
    const created = await tx.teamJoinRequest.createManyAndReturn({
      data: group.map((p) => ({ teamId: team!.id, personId: p.id, requestedById: actor.personId, approverId: approver.id, createdAt: now })),
      select: { id: true },
    });
    await tx.auditLog.createMany({
      data: group.map((p) => ({ action: "team.join.request", actorId: actor.personId, actorName: actor.fullName, source: "APP" as const, entity: "team", entityId: team!.id, field: `Запрос в команду: ${team!.name}`, after: `${p.fullName}, согласует ${approver.fullName}`, ip: actor.ip ?? null, via: actor.via ?? null })),
    });
    const names = group.map((p) => p.fullName);
    const who = names.length === 1 ? `вашего сотрудника ${names[0]}` : `ваших сотрудников (${names.length}): ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` и ещё ${names.length - 5}` : ""}`;
    await notify(
      tx,
      { kind: "TEAM", recipients: [approver.id], actor: { personId: actor.personId, fullName: actor.fullName }, subject: `join:${created[0]!.id}`, text: `Просят добавить ${who} в команду «${team!.name}», руководитель ${leaderName}: согласуйте или откажите` },
      now,
    );
    out.requested.push(...group.map((p) => ({ name: p.fullName, approver: approver.fullName })));
  }
  return out;
}

/** Повтор в ту же секунду из другой вкладки: второй ожидающий запрос запрещён индексом, говорим понятно */
function concurrent(error: unknown): never {
  if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") fail("Состав команды только что поменялся: обновите страницу и повторите");
  throw error;
}

/** Люди в проект пачкой по правилам этапа 53: своя ветка сразу, чужая с согласия руководителя */
export async function addProjectPeople(actor: Actor, teamId: string, slugs: string[], now = new Date()): Promise<AddPeopleResult> {
  return prisma.$transaction((tx) => addIn(tx, actor, teamId, slugs, now), { timeout: 30_000 }).catch(concurrent);
}

/**
 * Новый проект сразу с людьми: одна транзакция, без пустого проекта при сбое. leader: другой руководитель (только
 * владелец в режиме управления, этап 64): команда сразу с ним, люди добавляются по его ветке, события называют его
 */
export async function createProjectWith(
  actor: Actor,
  name: string,
  slugs: string[],
  opts: { leader?: string | null; now?: Date } = {},
): Promise<{ id: string; name: string; leader: string; result: AddPeopleResult | null }> {
  const now = opts.now ?? new Date();
  return prisma
    .$transaction(
      async (tx) => {
        const team = await createIn(tx, actor, name, opts.leader);
        return { id: team.id, name: team.name, leader: team.leaderName, result: slugs.length ? await addIn(tx, actor, team.id, slugs, now) : null };
      },
      { timeout: 30_000 },
    )
    .catch(concurrent);
}

/** Свой проект: переименовать или закрыть. Только проекты (не команды по структуре), руководитель или режим управления */
async function ownProject(tx: Tx, actor: Actor, teamId: string) {
  // Та же блокировка, что у пачки людей: закрытие не разойдётся с добавлением
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team:${String(teamId)}`}))`;
  const team = await tx.team.findUnique({ where: { id: String(teamId) } });
  if (!team || !team.active || !team.project) fail("Такой команды нет или она закрыта");
  if (!canManagePeople(actor)) {
    if (teamLogin(actor)) fail("Команду меняют, войдя лично, со своим логином и паролем");
    if (team!.leaderId !== actor.personId) fail("Команду меняют её руководитель и владелец в режиме управления");
  }
  return team!;
}

export async function renameProject(actor: Actor, teamId: string, rawName: string): Promise<{ id: string; name: string }> {
  return prisma.$transaction(async (tx) => {
    const team = await ownProject(tx, actor, teamId);
    const name = cleanName(rawName);
    if (name === team.name) return { id: team.id, name };
    const same = await tx.team.findFirst({ where: { leaderId: team.leaderId, active: true, name, id: { not: team.id } } });
    if (same) fail(`Команда «${name}» у вас уже есть`);
    await tx.team.update({ where: { id: team.id }, data: { name } });
    await audit(tx, actor, "team.update", team.id, "Название проекта", team.name, name);
    return { id: team.id, name };
  });
}

/** Закрыть проект: открытые задачи сначала передают или закрывают, ожидающие запросы отменяются */
export async function closeProject(actor: Actor, teamId: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const team = await ownProject(tx, actor, teamId);
    const open = await tx.task.count({ where: { teamId: team.id, status: { in: ["IN_PROGRESS", "CLARIFY", "PROPOSED"] }, archivedAt: null } });
    if (open) fail(`В команде ${open} открытых задач: сначала передайте их в другую команду или закройте`);
    await tx.teamJoinRequest.updateMany({ where: { teamId: team.id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: now } });
    await tx.team.update({ where: { id: team.id }, data: { active: false } });
    await audit(tx, actor, "team.off", team.id, `Проект закрыт: ${team.name}`, null, null);
  });
}
