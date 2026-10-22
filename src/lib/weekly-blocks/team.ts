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

import { cache } from "react";
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
import { recipientCandidates } from "@/lib/leader-report/rules";
import { alignToTemplate, blocksForLevel, cleanBlocks, cleanTemplate, hasBlocksText, keepLockedBlocks, lineText, orderedLines, restoreHiddenFigures, sentBlocks, withLiveBlocks, type ReportBlock, type TemplateBlock, type ViewerLevel } from "./types";

// Шаблон автора записи живёт отдельно (его читает и сохранение записи weekly): отсюда он доступен как раньше
export { sectionForAuthor, templateForAuthor } from "./author";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

type Access = { node: TeamNode; nodes: TeamNode[]; canLead: boolean; member: boolean };

/** Команды один раз на запрос страницы: их читают и права, и отчёт, и шаблон. Вне страницы (тесты) каждый раз заново */
const teamNodes = cache(() => loadTeamNodes(prisma));

/** Кто ведёт weekly команды: руководитель команды при личном входе, руководитель выше, режим управления */
async function access(actor: Actor, teamId: string): Promise<Access> {
  const nodes = await teamNodes();
  const node = nodes.find((n) => n.id === String(teamId) && n.active);
  if (!node) return fail("Такой команды нет");
  const functional = (await prisma.person.findMany({ where: { functionalManagerId: actor.personId }, select: { id: true } })).map((p) => p.id);
  const scope = scopeOf(nodes, { id: actor.personId, role: actor.role, limited: actor.via === "TEAM" && !actor.management }, functional);
  const member = scope.member.includes(node.id);
  if (!scope.all && !scope.visible.includes(node.id) && !member) fail("Weekly этой команды вы не видите");
  const canLead = actor.role !== "OBSERVER" && (!!actor.management || (actor.via !== "TEAM" && (node.leaderId === actor.personId || scope.leads.includes(node.id))));
  return { node, nodes, canLead, member };
}

/** Может ли человек вести отчёт команды (этап 73): руководитель команды при личном входе, руководитель выше, режим управления */
export async function canLeadTeamReport(actor: Actor, teamId: string): Promise<boolean> {
  try {
    return (await access(actor, teamId)).canLead;
  } catch (error) {
    if (error instanceof TaskRuleError) return false;
    throw error;
  }
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
 * руководителя команды. Получатель считается для команды, а не для того, кто нажал «Отправить»: руководитель выше,
 * который сам ведёт отчёт команды ниже, остаётся его получателем, и отправить отчёт самому себе он не может
 */
async function recipientsOf(a: Pick<Access, "node" | "nodes">): Promise<{ id: string; fullName: string }[]> {
  return recipientsOfNode(a.node, a.nodes);
}

/** Получатель отчёта команды по правилу выше (этап 73: им пользуется и раздел «Отчёт руководителю») */
export async function recipientsOfNode(node: TeamNode, nodes: TeamNode[]): Promise<{ id: string; fullName: string }[]> {
  const leader = node.leaderId ? await prisma.person.findUnique({ where: { id: node.leaderId }, select: { managerId: true } }) : null;
  const ids = recipientCandidates(node, nodes, leader?.managerId ?? null);
  if (!ids.length) return [];
  const people = await prisma.person.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, fullName: true } });
  const first = ids.map((id) => people.find((p) => p.id === id)).find((p) => !!p);
  return first ? [first] : [];
}

const NO_RECIPIENT = "Не найден руководитель: команда выше выключена или без руководителя, а у руководителя команды не указан руководитель";
const SELF_RECIPIENT = "Вы получатель этого отчёта: его отправляет руководитель команды, отправить отчёт самому себе нельзя";

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
   * edit: редактор текущей версии. sent: получатель видит отправленную версию (по умолчанию для получателя, даже если он
   * может править: туда ведёт ссылка из «Мне»)
   */
  mode: "edit" | "sent";
  /**
   * Сохранённый отчёт (выровненный по текущему шаблону, с живыми блоками) или свежая автосборка по шаблону. Цифры по
   * уровню зрителя, закрытые для него блоки цифр помечены locked. В режиме sent пусто
   */
  blocks: ReportBlock[];
  /** Свежая автосборка по уровню зрителя: «Собрать заново». В режиме sent пусто */
  auto: ReportBlock[];
  saved: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Отправленная версия: только видимые блоки, цифры по уровню зрителя */
  sent: { at: string; by: string | null; to: string[]; editedAfter: boolean; blocks: ReportBlock[] } | null;
  recipients: string[];
  /** Зритель сам получатель этого отчёта: отправить его он не может */
  isRecipient: boolean;
  /** Получатель может править отчёт команды: рядом с отправленной версией переход к текущей */
  canOpenCurrent: boolean;
  /** Видит ли зритель все цифры: иначе в предпросмотре пометка, что цифры увидит получатель с доступом */
  allFigures: boolean;
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
 * Текущая версия отчёта со всеми цифрами: сохранённый отчёт по текущему шаблону с живыми блоками или свежая автосборка.
 * stored: сохранённые блоки по шаблону без пересборки (из них при сохранении берутся закрытые для зрителя блоки целиком)
 */
function currentVersion(saved: ReportBlock[], template: TemplateBlock[] | null, auto: ReportBlock[]): { truth: ReportBlock[]; stored: ReportBlock[] } {
  if (!saved.length) return { truth: auto, stored: auto };
  const stored = template ? alignToTemplate(saved, template, auto) : saved;
  return { truth: withLiveBlocks(stored, auto), stored };
}

/**
 * Отчёт команды за неделю для экрана. Видят и правят руководитель команды, руководители выше и режим управления; тот,
 * кому отчёт отправили, видит его при личном входе, даже если команда не в его ветке. Получатель по умолчанию видит
 * отправленную версию с отметкой «поправили после отправки»; если он может править (руководитель команды выше), current
 * открывает текущую версию команды. Цифры в блоках по уровню зрителя: без доступа строка «Цифры видны только с доступом
 * к цифрам», блок цифр, который зритель видит не целиком, только для чтения
 */
export async function teamReportView(actor: Actor, teamId: string, key: WeekKey, opts: { current?: boolean } = {}): Promise<TeamReportView> {
  if (!isWeekKey(key)) fail("Неделя задаётся понедельником");
  const nodes = await teamNodes();
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
  const [template, meta, level, recipients] = await Promise.all([teamTemplate(node!.id), blocksMeta(), levelOf(actor), recipientsOf(a)]);
  const people = await prisma.person.findMany({ where: { id: { in: [row?.updatedById, row?.sentById].filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
  const nameOf = (id: string | null | undefined) => people.find((p) => p.id === id)?.fullName ?? null;
  const sent = row?.sentAt
    ? { at: row.sentAt.toISOString(), by: nameOf(row.sentById), to: names(row.sentTo), editedAfter: row.updatedAt.getTime() > row.sentAt.getTime(), blocks: blocksForLevel(sentBlocks(cleanBlocks(row.sentSnapshot, null)), level) }
    : null;
  const isRecipient = recipient || recipients.some((r) => r.id === actor.personId);
  const head = {
    team: { id: node!.id, name: node!.name },
    week: key,
    weekNumber: weekNumberOf(key),
    template,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: nameOf(row?.updatedById),
    sent,
    isRecipient,
    canOpenCurrent: recipient && a.canLead,
    allFigures: level === "full",
    meta,
  };
  // Получатель видит отправленную версию: автосборку не считаем, в данные страницы уходит только она
  if (recipient && (!opts.current || !a.canLead)) return { ...head, mode: "sent", blocks: [], auto: [], saved: !!row, recipients: [], canEdit: false, canSend: false, sendHint: null };
  const { people: who, owners } = peopleOf(node!);
  // Автосборка со всеми цифрами: пометки «цифры обновились» и закрытые блоки по полной версии, зрителю по его уровню
  const auto = template ? (await assembleTeamBlocks(actor, node!.id, who, template, key, owners)).blocks : [];
  const { truth } = currentVersion(row ? cleanBlocks(row.blocks, null) : [], template, auto);
  const sendHint = !template
    ? "Сначала задайте блоки weekly команды"
    : isRecipient
      ? SELF_RECIPIENT
      : actor.via === "TEAM"
        ? "Отправить руководителю можно при личном входе: так он видит, кто отправил"
        : !recipients.length
          ? NO_RECIPIENT
          : null;
  return {
    ...head,
    mode: "edit",
    blocks: blocksForLevel(truth, level),
    auto: blocksForLevel(auto, level),
    saved: !!row && cleanBlocks(row.blocks, null).length > 0,
    recipients: recipients.map((r) => r.fullName),
    canEdit: !!template,
    canSend: !!template && !isRecipient && actor.via !== "TEAM" && recipients.length > 0,
    sendHint,
  };
}

const blocksLog = (blocks: ReportBlock[], meta: BlocksMeta) =>
  blocks
    .filter((b) => !b.hidden)
    .map((b) => `${b.title}: ${orderedLines(b, meta.order).map((l) => lineText(l, meta.labels)).join("; ")}`)
    .join("\n");

type SaveContext = { meta: BlocksMeta; level: ViewerLevel; template: TemplateBlock[]; auto: ReportBlock[] };

/**
 * Сохранение внутри транзакции. Блоки цифр, закрытые для того, кто сохраняет (по текущей полной версии), берутся из
 * прежней версии целиком; цифры, которых ему не показали, возвращаются в свои блоки; живые блоки без правок руками
 * получают строки свежей автосборки
 */
async function saveIn(tx: Prisma.TransactionClient, actor: Actor, a: Access, key: WeekKey, input: unknown, expected: string | null | undefined, ctx: SaveContext) {
  const clean = cleanBlocks(input, new Set(ctx.meta.order));
  if (!clean.length) fail("В отчёте нет ни одного блока: обновите страницу");
  const week = await ensureWeek(tx, key);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team-report:${a.node.id}:${key}`}))`;
  const before = await tx.teamWeeklyReport.findUnique({ where: { teamId_weekId: { teamId: a.node.id, weekId: week.id } } });
  if (expected !== undefined && (before?.updatedAt.toISOString() ?? null) !== (expected ?? null)) {
    fail("Отчёт команды за эту неделю уже сохранён с другого устройства или другим человеком. Скопируйте свои правки и обновите страницу");
  }
  const { truth, stored } = currentVersion(before ? cleanBlocks(before.blocks, null) : [], ctx.template, ctx.auto);
  const merged = restoreHiddenFigures(keepLockedBlocks(clean, truth, stored, ctx.level), stored, ctx.level);
  // Пометки stale и locked не хранятся
  const blocks = cleanBlocks(withLiveBlocks(merged, ctx.auto), null);
  const data = { blocks: blocks as unknown as Prisma.InputJsonValue, updatedById: actor.personId };
  const saved = await tx.teamWeeklyReport.upsert({ where: { teamId_weekId: { teamId: a.node.id, weekId: week.id } }, update: data, create: { ...data, teamId: a.node.id, weekId: week.id } });
  const prev = before ? blocksLog(cleanBlocks(before.blocks, null), ctx.meta) : null;
  const next = blocksLog(blocks, ctx.meta);
  if ((prev ?? "") !== next) await audit(tx, actor, "team.weekly.report", a.node.id, `Weekly команды «${a.node.name}», неделя ${week.isoNumber}`, prev, next);
  return { saved, blocks, week };
}

/** Всё, что нужно сохранению: шаблон, автосборка со всеми цифрами, уровень того, кто сохраняет */
async function saveContext(actor: Actor, a: Access, key: WeekKey): Promise<SaveContext> {
  const template = await teamTemplate(a.node.id);
  if (!template) fail("Сначала задайте блоки weekly команды");
  const { people: who, owners } = peopleOf(a.node);
  const [meta, level, auto] = await Promise.all([blocksMeta(), levelOf(actor), assembleTeamBlocks(actor, a.node.id, who, template!, key, owners, new Date())]);
  return { meta, level, template: template!, auto: auto.blocks };
}

/** Сохранить отчёт команды по блокам. expected: момент прошлого сохранения, который видел экран */
export async function saveTeamReport(actor: Actor, teamId: string, key: WeekKey, blocks: unknown, expected: string | null): Promise<TeamReportView> {
  const a = await access(actor, teamId);
  requireLead(a, "Weekly команды по блокам правит");
  const ctx = await saveContext(actor, a, key);
  await prisma.$transaction((tx) => saveIn(tx, actor, a, key, blocks, expected, ctx));
  return teamReportView(actor, a.node.id, key, { current: true });
}

/**
 * Отправить weekly команды своему руководителю: отчёт сохраняется, помечается отправленным (кто, когда, кому) со снимком
 * видимых блоков, получатель видит событие в «Мне» и отчёт по ссылке из него. Только при личном входе. Живые блоки, которые
 * не правили руками, уходят свежими. Получатель отчёта сам его не отправляет
 */
export async function sendTeamReport(actor: Actor, teamId: string, key: WeekKey, blocks: unknown, expected: string | null, now = new Date()): Promise<TeamReportView> {
  const a = await access(actor, teamId);
  requireLead(a, "Weekly команды отправляет");
  if (actor.via === "TEAM") fail("Отправить руководителю можно при личном входе: так он видит, кто отправил");
  const recipients = await recipientsOf(a);
  if (recipients.some((r) => r.id === actor.personId)) fail(SELF_RECIPIENT);
  if (!recipients.length) fail(NO_RECIPIENT);
  const ctx = await saveContext(actor, a, key);
  if (!hasBlocksText(withLiveBlocks(cleanBlocks(blocks, new Set(ctx.meta.order)), ctx.auto))) fail("Weekly команды пустой: в видимых блоках нет ни одной строки");
  await prisma.$transaction(async (tx) => {
    const { saved, blocks: clean, week } = await saveIn(tx, actor, a, key, blocks, expected, ctx);
    if (!hasBlocksText(clean)) fail("Weekly команды пустой: в видимых блоках нет ни одной строки");
    const to = recipients.map((r) => ({ id: r.id, name: r.fullName }));
    // Момент отправки тот же, что момент записи отчёта: правка после отправки видна по более позднему updatedAt. В снимке
    // только видимые блоки: скрытый блок не уходит получателю
    await tx.$executeRaw`UPDATE team_weekly_reports SET "sentAt" = "updatedAt", "sentById" = ${actor.personId}, "sentTo" = ${JSON.stringify(to)}::jsonb, "sentSnapshot" = ${JSON.stringify(sentBlocks(clean))}::jsonb WHERE id = ${saved.id}`;
    await notify(tx, { kind: "MEETING", recipients: recipients.map((r) => r.id), actor, subject: `team-report:${a.node.id}:${key}`, text: `${actor.fullName} отправил weekly команды «${a.node.name}» за неделю ${week.isoNumber}` }, now);
    await audit(tx, actor, "team.weekly.send", a.node.id, `Weekly команды «${a.node.name}», неделя ${week.isoNumber}`, null, `Отправлен в приложении: ${to.map((t) => t.name).join(", ")}`);
  });
  return teamReportView(actor, a.node.id, key, { current: true });
}
