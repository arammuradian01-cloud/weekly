// Смысловые блоки weekly команды (этап 66). Решение Арама 22.10: такие же смысловые блоки, как у weekly для CEO, может
// задать каждый руководитель для отчёта своему руководителю.
//
// - Шаблон: руководитель команды (руководитель выше, режим управления) выбирает блоки из стандартного набора и свои,
//   задаёт порядок. Нет шаблона: weekly команды как раньше. У команды страхования и инвестиций (топ-команда) шаблона нет:
//   её отчёт это отчёт CEO, он и так по смысловым блокам.
// - Участники сдают записи weekly по блокам шаблона: в форме записи «Блок отчёта», запись помнит блок (weekly_entries.section).
// - Руководитель видит собранный отчёт команды по блокам (автосборка из weekly своих людей, задач и целей команды, цифр и
//   новостей по продуктам команды), правит его и отправляет своему руководителю: событие в «Мне», как отправка CEO.
//
// Отдельный сервис и отдельный компонент (src/components/weekly-blocks/team-template.tsx), чтобы карточка команды
// могла встроить шаблон к себе.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate } from "@/lib/tasks/dates";
import { notify } from "@/lib/inbox/notify";
import { TOP_TEAM, loadTeamNodes, scopeOf, teamPeopleIds, type TeamNode } from "@/lib/org/scope";
import { expectingTeams } from "@/lib/org/rhythm";
import { ensureWeek } from "@/lib/weekly/service";
import { isWeekKey, weekNumberOf } from "@/lib/weekly/weeks";
import { assembleTeamBlocks, blocksMeta, type BlocksMeta } from "./sources";
import { cleanBlocks, cleanTemplate, hasBlocksText, lineText, orderedLines, type ReportBlock, type TemplateBlock } from "./types";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

type Access = { node: TeamNode; nodes: TeamNode[]; canLead: boolean; member: boolean };

/** Кто ведёт weekly команды: руководитель команды при личном входе, руководитель выше, режим управления */
async function access(actor: Actor, teamId: string): Promise<Access> {
  const nodes = await loadTeamNodes(prisma);
  const node = nodes.find((n) => n.id === String(teamId) && n.active);
  if (!node) return fail("Такой команды нет");
  const functional = (await prisma.person.findMany({ where: { functionalManagerId: actor.personId }, select: { id: true } })).map((p) => p.id);
  const scope = scopeOf(nodes, { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management }, functional);
  const member = scope.member.includes(node.id);
  if (!scope.all && !scope.visible.includes(node.id) && !member) fail("Weekly этой команды вы не видите");
  const canLead = actor.role !== "OBSERVER" && (!!actor.management || (actor.via !== "TEAM" && (node.leaderId === actor.personId || scope.leads.includes(node.id))));
  return { node, nodes, canLead, member };
}

const TOP_TEXT = "Weekly команды страхования и инвестиций это отчёт CEO: он уже по смысловым блокам, его собирают на странице «Отчёт CEO»";

function requireLead(a: Access, what: string) {
  if (a.node.id === TOP_TEAM) fail(TOP_TEXT);
  if (!a.canLead) fail(`${what}: руководитель команды при личном входе, руководитель выше или режим управления`);
}

async function audit(db: Prisma.TransactionClient, actor: Actor, action: string, entityId: string, field: string, before: string | null, after: string | null) {
  await db.auditLog.create({ data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "team", entityId, field, before: before ?? undefined, after: after ?? undefined, ip: actor.ip ?? null, via: actor.via ?? null } });
}

// ---------- Шаблон ----------

/** Шаблон блоков команды. null: шаблона нет, weekly как раньше */
export async function teamTemplate(teamId: string): Promise<TemplateBlock[] | null> {
  const row = await prisma.teamWeeklyTemplate.findUnique({ where: { teamId: String(teamId) } });
  const blocks = row ? cleanTemplate(row.blocks) : [];
  return blocks.length ? blocks : null;
}

export type TeamTemplateView = { teamId: string; teamName: string; blocks: TemplateBlock[] | null; canEdit: boolean; updatedAt: string | null };

export async function teamTemplateView(actor: Actor, teamId: string): Promise<TeamTemplateView> {
  const a = await access(actor, teamId);
  const row = await prisma.teamWeeklyTemplate.findUnique({ where: { teamId: a.node.id } });
  const blocks = row ? cleanTemplate(row.blocks) : [];
  return { teamId: a.node.id, teamName: a.node.name, blocks: blocks.length ? blocks : null, canEdit: a.canLead && a.node.id !== TOP_TEAM, updatedAt: row?.updatedAt.toISOString() ?? null };
}

const templateText = (list: TemplateBlock[] | null) => (list?.length ? list.map((b) => b.title).join(", ") : "");

/** Сохранить шаблон блоков команды. Пустой список: шаблон убран, weekly команды как раньше */
export async function saveTeamTemplate(actor: Actor, teamId: string, input: unknown): Promise<TeamTemplateView> {
  const a = await access(actor, teamId);
  requireLead(a, "Блоки weekly команды задаёт");
  const blocks = cleanTemplate(input);
  if (Array.isArray(input) && input.length && !blocks.length) fail("В шаблоне нет ни одного понятного блока");
  await prisma.$transaction(async (tx) => {
    const before = await tx.teamWeeklyTemplate.findUnique({ where: { teamId: a.node.id } });
    const old = before ? cleanTemplate(before.blocks) : null;
    if (!blocks.length) await tx.teamWeeklyTemplate.deleteMany({ where: { teamId: a.node.id } });
    else {
      const data = { blocks: blocks as unknown as Prisma.InputJsonValue, updatedById: actor.personId };
      await tx.teamWeeklyTemplate.upsert({ where: { teamId: a.node.id }, update: data, create: { ...data, teamId: a.node.id } });
    }
    if (templateText(old) !== templateText(blocks)) await audit(tx, actor, "team.weekly.template", a.node.id, `Блоки weekly команды «${a.node.name}»`, templateText(old) || null, templateText(blocks) || "Шаблон убран: weekly как раньше");
  });
  return teamTemplateView(actor, a.node.id);
}

/**
 * Шаблон, по которому человек сдаёт weekly: первая из команд, которые ждут его weekly, а без них первая из его команд,
 * где шаблон задан. Человек в нескольких командах сдаёт одну запись: свой блок другой команды в ней не понять, тогда
 * запись раскладывается по смыслу
 */
export async function templateForAuthor(personId: string): Promise<{ teamId: string; teamName: string; blocks: TemplateBlock[] } | null> {
  const nodes = await loadTeamNodes(prisma);
  const expecting = expectingTeams(personId, nodes).filter((n) => n.id !== TOP_TEAM);
  const member = nodes.filter((n) => n.active && n.id !== TOP_TEAM && n.members.includes(personId) && !expecting.some((e) => e.id === n.id));
  const order = [...expecting, ...member];
  if (!order.length) return null;
  const rows = await prisma.teamWeeklyTemplate.findMany({ where: { teamId: { in: order.map((n) => n.id) } } });
  for (const n of order) {
    const row = rows.find((r) => r.teamId === n.id);
    const blocks = row ? cleanTemplate(row.blocks) : [];
    if (blocks.length) return { teamId: n.id, teamName: n.name, blocks };
  }
  return null;
}

/** Блок шаблона, который человек может поставить записи: из шаблонов его команд. null: блок не задан или чужой */
export async function sectionForAuthor(personId: string, section: unknown): Promise<string | null> {
  if (typeof section !== "string" || !section) return null;
  const t = await templateForAuthor(personId);
  return t?.blocks.some((b) => b.key === section) ? section : null;
}

// ---------- Отчёт команды по блокам ----------

/**
 * Кому руководитель отправляет weekly своей команды: руководитель команды уровнем выше (туда он сдаёт свой weekly),
 * без неё административный руководитель руководителя команды
 */
async function recipientsOf(a: Access): Promise<{ id: string; fullName: string }[]> {
  const parent = a.node.parentId ? a.nodes.find((n) => n.id === a.node.parentId) : undefined;
  const ids = parent?.leaderId && parent.leaderId !== a.node.leaderId ? [parent.leaderId] : [];
  if (!ids.length && a.node.leaderId) {
    const leader = await prisma.person.findUnique({ where: { id: a.node.leaderId }, select: { managerId: true } });
    if (leader?.managerId) ids.push(leader.managerId);
  }
  if (!ids.length) return [];
  return prisma.person.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, fullName: true } });
}

export type TeamReportView = {
  team: { id: string; name: string };
  week: WeekKey;
  weekNumber: number;
  template: TemplateBlock[] | null;
  /** Сохранённый отчёт или свежая автосборка по шаблону */
  blocks: ReportBlock[];
  /** Свежая автосборка: «Собрать заново» */
  auto: ReportBlock[];
  saved: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  sent: { at: string; by: string | null; to: string[]; editedAfter: boolean; blocks: ReportBlock[] } | null;
  recipients: string[];
  canEdit: boolean;
  canSend: boolean;
  /** Почему отправить нельзя: подсказка вместо кнопки */
  sendHint: string | null;
  meta: BlocksMeta;
};

const names = (value: unknown) => (Array.isArray(value) ? value.map((v) => (v && typeof v === "object" ? String((v as { name?: unknown }).name ?? "") : "")).filter(Boolean) : []);

/**
 * Отчёт команды за неделю для экрана. Видят и правят руководитель команды, руководители выше и режим управления; тот,
 * кому отчёт отправили, видит его, даже если команда не в его ветке
 */
export async function teamReportView(actor: Actor, teamId: string, key: WeekKey): Promise<TeamReportView> {
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  const nodes = await loadTeamNodes(prisma);
  const node = nodes.find((n) => n.id === String(teamId) && n.active);
  if (!node) fail("Такой команды нет");
  if (node!.id === TOP_TEAM) fail(TOP_TEXT);
  const week = await prisma.week.findUnique({ where: { start: dbDate(key) }, select: { id: true } });
  const row = week ? await prisma.teamWeeklyReport.findUnique({ where: { teamId_weekId: { teamId: node!.id, weekId: week.id } } }) : null;
  const sentTo = Array.isArray(row?.sentTo) ? (row!.sentTo as { id?: string }[]) : [];
  let a: Access;
  try {
    a = await access(actor, node!.id);
  } catch (error) {
    // Получатель отправленного отчёта видит его и вне своей ветки
    if (!row?.sentAt || !sentTo.some((t) => t?.id === actor.personId)) throw error;
    a = { node: node!, nodes, canLead: false, member: false };
  }
  if (!a.canLead && !sentTo.some((t) => t?.id === actor.personId)) fail("Weekly команды по блокам видят руководитель команды, руководители выше и тот, кому отчёт отправили");
  const [template, meta, recipients] = await Promise.all([teamTemplate(node!.id), blocksMeta(), recipientsOf(a)]);
  const auto = template ? (await assembleTeamBlocks(actor, node!.id, teamPeopleIds(node!), template, key)).blocks : [];
  const saved = row ? cleanBlocks(row.blocks, null) : null;
  const people = await prisma.person.findMany({ where: { id: { in: [row?.updatedById, row?.sentById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const nameOf = (id: string | null | undefined) => people.find((p) => p.id === id)?.fullName ?? null;
  const canSend = a.canLead && actor.via !== "TEAM" && recipients.length > 0;
  return {
    team: { id: node!.id, name: node!.name },
    week: key,
    weekNumber: weekNumberOf(key),
    template,
    blocks: saved?.length ? saved : auto,
    auto,
    saved: !!saved?.length,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: nameOf(row?.updatedById),
    sent: row?.sentAt
      ? { at: row.sentAt.toISOString(), by: nameOf(row.sentById), to: names(row.sentTo), editedAfter: row.updatedAt.getTime() > row.sentAt.getTime(), blocks: cleanBlocks(row.sentSnapshot, null) }
      : null,
    recipients: recipients.map((r) => r.fullName),
    canEdit: a.canLead && !!template,
    canSend: canSend && !!template,
    sendHint: !a.canLead ? null : !template ? "Сначала задайте блоки weekly команды" : actor.via === "TEAM" ? "Отправить руководителю можно при личном входе: так он видит, кто отправил" : !recipients.length ? "Не найден руководитель: у команды нет команды выше с руководителем, а у руководителя команды не указан руководитель" : null,
    meta,
  };
}

const blocksLog = (blocks: ReportBlock[], meta: BlocksMeta) =>
  blocks
    .filter((b) => !b.hidden)
    .map((b) => `${b.title}: ${orderedLines(b, meta.order).map((l) => lineText(l, meta.labels)).join("; ")}`)
    .join("\n");

async function saveIn(tx: Prisma.TransactionClient, actor: Actor, a: Access, key: WeekKey, input: unknown, expected: string | null | undefined, meta: BlocksMeta) {
  const blocks = cleanBlocks(input, new Set(meta.order));
  if (!blocks.length) fail("В отчёте нет ни одного блока: обновите страницу");
  const week = await ensureWeek(tx, key);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team-report:${a.node.id}:${key}`}))`;
  const before = await tx.teamWeeklyReport.findUnique({ where: { teamId_weekId: { teamId: a.node.id, weekId: week.id } } });
  if (expected !== undefined && (before?.updatedAt.toISOString() ?? null) !== (expected ?? null)) {
    fail("Отчёт команды за эту неделю уже сохранён с другого устройства или другим человеком. Скопируйте свои правки и обновите страницу");
  }
  const data = { blocks: blocks as unknown as Prisma.InputJsonValue, updatedById: actor.personId };
  const saved = await tx.teamWeeklyReport.upsert({ where: { teamId_weekId: { teamId: a.node.id, weekId: week.id } }, update: data, create: { ...data, teamId: a.node.id, weekId: week.id } });
  const prev = before ? blocksLog(cleanBlocks(before.blocks, null), meta) : null;
  const next = blocksLog(blocks, meta);
  if ((prev ?? "") !== next) await audit(tx, actor, "team.weekly.report", a.node.id, `Weekly команды «${a.node.name}», неделя ${week.isoNumber}`, prev, next);
  return { saved, blocks, week };
}

/** Сохранить отчёт команды по блокам. expected: момент прошлого сохранения, который видел экран */
export async function saveTeamReport(actor: Actor, teamId: string, key: WeekKey, blocks: unknown, expected: string | null): Promise<TeamReportView> {
  const a = await access(actor, teamId);
  requireLead(a, "Weekly команды по блокам правит");
  if (!(await teamTemplate(a.node.id))) fail("Сначала задайте блоки weekly команды");
  const meta = await blocksMeta();
  await prisma.$transaction((tx) => saveIn(tx, actor, a, key, blocks, expected, meta));
  return teamReportView(actor, a.node.id, key);
}

/**
 * Отправить weekly команды своему руководителю: отчёт сохраняется, помечается отправленным (кто, когда, кому) со снимком
 * блоков, получатель видит событие в «Мне» и отчёт по ссылке из него. Только при личном входе
 */
export async function sendTeamReport(actor: Actor, teamId: string, key: WeekKey, blocks: unknown, expected: string | null, now = new Date()): Promise<TeamReportView> {
  const a = await access(actor, teamId);
  requireLead(a, "Weekly команды отправляет");
  if (actor.via === "TEAM") fail("Отправить руководителю можно при личном входе: так он видит, кто отправил");
  if (!(await teamTemplate(a.node.id))) fail("Сначала задайте блоки weekly команды");
  const meta = await blocksMeta();
  if (!hasBlocksText(cleanBlocks(blocks, new Set(meta.order)))) fail("Weekly команды пустой: в видимых блоках нет ни одной строки");
  const recipients = await recipientsOf(a);
  if (!recipients.length) fail("Не найден руководитель: у команды нет команды выше с руководителем, а у руководителя команды не указан руководитель");
  await prisma.$transaction(async (tx) => {
    const { saved, blocks: clean, week } = await saveIn(tx, actor, a, key, blocks, expected, meta);
    const to = recipients.map((r) => ({ id: r.id, name: r.fullName }));
    // Момент отправки тот же, что момент записи отчёта: правка после отправки видна по более позднему updatedAt
    await tx.$executeRaw`UPDATE team_weekly_reports SET "sentAt" = "updatedAt", "sentById" = ${actor.personId}, "sentTo" = ${JSON.stringify(to)}::jsonb, "sentSnapshot" = ${JSON.stringify(clean)}::jsonb WHERE id = ${saved.id}`;
    await notify(tx, { kind: "MEETING", recipients: recipients.map((r) => r.id), actor, subject: `team-report:${a.node.id}:${key}`, text: `${actor.fullName} отправил weekly команды «${a.node.name}» за неделю ${week.isoNumber}` }, now);
    await audit(tx, actor, "team.weekly.send", a.node.id, `Weekly команды «${a.node.name}», неделя ${week.isoNumber}`, null, `Отправлен в приложении: ${to.map((t) => t.name).join(", ")}`);
  });
  return teamReportView(actor, a.node.id, key);
}
