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
import { ensureWeek } from "@/lib/weekly/service";
import { isWeekKey, weekNumberOf } from "@/lib/weekly/weeks";
import { numbersLevel } from "@/lib/plan/access";
import { assembleTeamBlocks, blocksMeta, type BlocksMeta } from "./sources";
import { alignToTemplate, blocksForLevel, cleanBlocks, cleanTemplate, hasBlocksText, lineText, orderedLines, restoreHiddenFigures, withLiveFigures, type ReportBlock, type TemplateBlock, type ViewerLevel } from "./types";

// Шаблон автора записи живёт отдельно (его читает и сохранение записи weekly): отсюда он доступен как раньше
export { sectionForAuthor, templateForAuthor } from "./author";

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

// ---------- Отчёт команды по блокам ----------

/**
 * Кому руководитель отправляет weekly своей команды (решение Арама 22.10): руководителю команды уровнем выше (туда он
 * сдаёт свой weekly). Команда выше выключена, у неё нет руководителя или он выключен: административному руководителю
 * руководителя команды. Самому себе отчёт не уходит: тогда следующий по порядку или никто
 */
async function recipientsOf(a: Access, actor: Pick<Actor, "personId">): Promise<{ id: string; fullName: string }[]> {
  const parent = a.node.parentId ? a.nodes.find((n) => n.id === a.node.parentId) : undefined;
  const candidates: string[] = [];
  if (parent?.active && parent.leaderId && parent.leaderId !== a.node.leaderId) candidates.push(parent.leaderId);
  if (a.node.leaderId) {
    const leader = await prisma.person.findUnique({ where: { id: a.node.leaderId }, select: { managerId: true } });
    if (leader?.managerId) candidates.push(leader.managerId);
  }
  const ids = [...new Set(candidates)].filter((id) => id !== actor.personId && id !== a.node.leaderId);
  if (!ids.length) return [];
  const people = await prisma.person.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, fullName: true } });
  const first = ids.map((id) => people.find((p) => p.id === id)).find((p) => !!p);
  return first ? [first] : [];
}

const NO_RECIPIENT = "Не найден руководитель: команда выше выключена или без руководителя, у руководителя команды не указан руководитель, а себе отчёт не отправляется";

/** Люди команды для автосборки: записи weekly всех, задачи и цели без внешних участников */
const peopleOf = (node: TeamNode) => {
  const people = teamPeopleIds(node);
  return { people, owners: people.filter((id) => !(node.external ?? []).includes(id)) };
};

export type TeamReportView = {
  team: { id: string; name: string };
  week: WeekKey;
  weekNumber: number;
  template: TemplateBlock[] | null;
  /**
   * Сохранённый отчёт (выровненный по текущему шаблону, с живыми цифрами) или свежая автосборка по шаблону. Цифры по
   * уровню зрителя. Получателю пусто: ему только отправленная версия
   */
  blocks: ReportBlock[];
  /** Свежая автосборка: «Собрать заново». Получателю пусто */
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

/** Уровень цифр зрителя (этап 57) */
const levelOf = (actor: Actor): Promise<ViewerLevel> => numbersLevel({ personId: actor.personId, role: actor.role, management: actor.management });

/**
 * Отчёт команды за неделю для экрана. Видят и правят руководитель команды, руководители выше и режим управления; тот,
 * кому отчёт отправили, видит его при личном входе, даже если команда не в его ветке, и только отправленную версию.
 * Цифры в блоках по уровню зрителя: без доступа к цифрам строка «Цифры видны только с доступом к цифрам»
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
  // Получатель: только при личном входе, как у отчёта CEO. Под общим логином можно выбрать чужой профиль
  const recipient = actor.via !== "TEAM" && !!row?.sentAt && sentTo.some((t) => t?.id === actor.personId);
  let a: Access;
  try {
    a = await access(actor, node!.id);
  } catch (error) {
    // Получатель отправленного отчёта видит его и вне своей ветки
    if (!recipient) throw error;
    a = { node: node!, nodes, canLead: false, member: false };
  }
  if (!a.canLead && !recipient) fail("Weekly команды по блокам видят руководитель команды, руководители выше и тот, кому отчёт отправили");
  const [template, meta, level] = await Promise.all([teamTemplate(node!.id), blocksMeta(), levelOf(actor)]);
  const people = await prisma.person.findMany({ where: { id: { in: [row?.updatedById, row?.sentById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const nameOf = (id: string | null | undefined) => people.find((p) => p.id === id)?.fullName ?? null;
  const sent = row?.sentAt
    ? { at: row.sentAt.toISOString(), by: nameOf(row.sentById), to: names(row.sentTo), editedAfter: row.updatedAt.getTime() > row.sentAt.getTime(), blocks: blocksForLevel(cleanBlocks(row.sentSnapshot, null), level) }
    : null;
  const head = { team: { id: node!.id, name: node!.name }, week: key, weekNumber: weekNumberOf(key), template, updatedAt: row?.updatedAt.toISOString() ?? null, updatedBy: nameOf(row?.updatedById), sent, meta };
  // Получатель без прав руководителя: автосборку не считаем, в данные страницы уходит только отправленная версия
  if (!a.canLead) return { ...head, blocks: [], auto: [], saved: !!row, recipients: [], canEdit: false, canSend: false, sendHint: null };
  const recipients = await recipientsOf(a, actor);
  const { people: who, owners } = peopleOf(node!);
  const auto = template ? (await assembleTeamBlocks(actor, node!.id, who, template, key, owners)).blocks : [];
  const saved = row ? cleanBlocks(row.blocks, null) : [];
  // Сохранённый отчёт по текущему шаблону (новые блоки добавлены, убранные скрыты), цифры недели и месяца живые
  const blocks = saved.length && template ? withLiveFigures(alignToTemplate(saved, template, auto), auto) : saved.length ? saved : auto;
  const canSend = actor.via !== "TEAM" && recipients.length > 0;
  return {
    ...head,
    blocks: blocksForLevel(blocks, level),
    auto: blocksForLevel(auto, level),
    saved: saved.length > 0,
    recipients: recipients.map((r) => r.fullName),
    canEdit: !!template,
    canSend: canSend && !!template,
    sendHint: !template ? "Сначала задайте блоки weekly команды" : actor.via === "TEAM" ? "Отправить руководителю можно при личном входе: так он видит, кто отправил" : !recipients.length ? NO_RECIPIENT : null,
  };
}

const blocksLog = (blocks: ReportBlock[], meta: BlocksMeta) =>
  blocks
    .filter((b) => !b.hidden)
    .map((b) => `${b.title}: ${orderedLines(b, meta.order).map((l) => lineText(l, meta.labels)).join("; ")}`)
    .join("\n");

/**
 * Сохранение внутри транзакции. level: уровень цифр того, кто сохраняет. Цифры, которых ему не показали, возвращаются в
 * свои блоки из прежней версии: правка текста не стирает чужие цифры
 */
async function saveIn(tx: Prisma.TransactionClient, actor: Actor, a: Access, key: WeekKey, input: unknown, expected: string | null | undefined, meta: BlocksMeta, level: ViewerLevel) {
  const clean = cleanBlocks(input, new Set(meta.order));
  if (!clean.length) fail("В отчёте нет ни одного блока: обновите страницу");
  const week = await ensureWeek(tx, key);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team-report:${a.node.id}:${key}`}))`;
  const before = await tx.teamWeeklyReport.findUnique({ where: { teamId_weekId: { teamId: a.node.id, weekId: week.id } } });
  if (expected !== undefined && (before?.updatedAt.toISOString() ?? null) !== (expected ?? null)) {
    fail("Отчёт команды за эту неделю уже сохранён с другого устройства или другим человеком. Скопируйте свои правки и обновите страницу");
  }
  const blocks = restoreHiddenFigures(clean, before ? cleanBlocks(before.blocks, null) : [], level);
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
  const [meta, level] = await Promise.all([blocksMeta(), levelOf(actor)]);
  await prisma.$transaction((tx) => saveIn(tx, actor, a, key, blocks, expected, meta, level));
  return teamReportView(actor, a.node.id, key);
}

/**
 * Отправить weekly команды своему руководителю: отчёт сохраняется, помечается отправленным (кто, когда, кому) со снимком
 * блоков, получатель видит событие в «Мне» и отчёт по ссылке из него. Только при личном входе. Цифры недели и месяца,
 * которые не правили руками, уходят свежими
 */
export async function sendTeamReport(actor: Actor, teamId: string, key: WeekKey, blocks: unknown, expected: string | null, now = new Date()): Promise<TeamReportView> {
  const a = await access(actor, teamId);
  requireLead(a, "Weekly команды отправляет");
  if (actor.via === "TEAM") fail("Отправить руководителю можно при личном входе: так он видит, кто отправил");
  const template = await teamTemplate(a.node.id);
  if (!template) fail("Сначала задайте блоки weekly команды");
  const [meta, level] = await Promise.all([blocksMeta(), levelOf(actor)]);
  const { people: who, owners } = peopleOf(a.node);
  const auto = (await assembleTeamBlocks(actor, a.node.id, who, template!, key, owners)).blocks;
  const live = withLiveFigures(cleanBlocks(blocks, new Set(meta.order)), auto);
  if (!hasBlocksText(live)) fail("Weekly команды пустой: в видимых блоках нет ни одной строки");
  const recipients = await recipientsOf(a, actor);
  if (!recipients.length) fail(NO_RECIPIENT);
  await prisma.$transaction(async (tx) => {
    const { saved, blocks: clean, week } = await saveIn(tx, actor, a, key, live, expected, meta, level);
    const to = recipients.map((r) => ({ id: r.id, name: r.fullName }));
    // Момент отправки тот же, что момент записи отчёта: правка после отправки видна по более позднему updatedAt
    await tx.$executeRaw`UPDATE team_weekly_reports SET "sentAt" = "updatedAt", "sentById" = ${actor.personId}, "sentTo" = ${JSON.stringify(to)}::jsonb, "sentSnapshot" = ${JSON.stringify(clean)}::jsonb WHERE id = ${saved.id}`;
    await notify(tx, { kind: "MEETING", recipients: recipients.map((r) => r.id), actor, subject: `team-report:${a.node.id}:${key}`, text: `${actor.fullName} отправил weekly команды «${a.node.name}» за неделю ${week.isoNumber}` }, now);
    await audit(tx, actor, "team.weekly.send", a.node.id, `Weekly команды «${a.node.name}», неделя ${week.isoNumber}`, null, `Отправлен в приложении: ${to.map((t) => t.name).join(", ")}`);
  });
  return teamReportView(actor, a.node.id, key);
}
