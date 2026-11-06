// Шаблон блоков, по которому человек сдаёт weekly (этап 66). Отдельно от сервиса отчёта команды: его читает и сохранение
// записи weekly (src/lib/weekly/service.ts), а сервис отчёта команды сам зависит от weekly. Так нет круга импортов.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TOP_TEAM, loadTeamNodes, type TeamNode } from "@/lib/org/scope";
import { expectingTeams } from "@/lib/org/rhythm";
import { LIVE_FIGURE_KEYS, STANDARD_TEMPLATE, cleanTemplate, effectiveTemplate, type TemplateBlock } from "./types";

type Db = Prisma.TransactionClient | typeof prisma;

/** Порядок сдачи: ожидающие команды, затем остальные членства; топ-команда в конце. */
export function authorTemplateTeams(personId: string, nodes: TeamNode[]): TeamNode[] {
  const expected = expectingTeams(personId, nodes);
  const member = nodes.filter((n) => n.active && n.members.includes(personId) && !expected.some((e) => e.id === n.id));
  const order = [...expected, ...member];
  return [...order.filter((n) => n.id !== TOP_TEAM), ...order.filter((n) => n.id === TOP_TEAM)];
}

/**
 * Шаблон, по которому человек сдаёт weekly: первая из команд, которые ждут его weekly, а без них первая из его команд,
 * где шаблон задан; если настроенных шаблонов нет — стандартные блоки первой команды.
 * Человек в нескольких командах сдаёт одну запись: свой блок другой команды в ней не понять, тогда
 * запись раскладывается по общему правилу entryBlockKey. Чтение не меняет старые записи
 */
export async function templateForAuthor(personId: string, db: Db = prisma): Promise<{ teamId: string; teamName: string; blocks: TemplateBlock[] } | null> {
  const nodes = await loadTeamNodes(db);
  const order = authorTemplateTeams(personId, nodes);
  if (!order.length) return null;
  const rows = await db.teamWeeklyTemplate.findMany({ where: { teamId: { in: order.map((n) => n.id) } } });
  // Виртуальный стандарт не вытесняет уже настроенный шаблон другой команды человека.
  for (const n of order) {
    const row = rows.find((r) => r.teamId === n.id);
    const blocks = row ? cleanTemplate(row.blocks) : [];
    if (blocks.length) return { teamId: n.id, teamName: n.name, blocks: effectiveTemplate(blocks) };
  }
  const first = order[0]!;
  return { teamId: first.id, teamName: first.name, blocks: STANDARD_TEMPLATE.map((b) => ({ ...b })) };
}

/**
 * Блок шаблона, который человек может поставить записи: из шаблона, по которому он сдаёт weekly. null: блок не задан,
 * чужой или это блок цифр («Неделя к неделе», «Месяц»): их собирает ресурс, запись туда не идёт
 */
export async function sectionForAuthor(personId: string, section: unknown, db: Db = prisma): Promise<string | null> {
  if (typeof section !== "string" || !section || LIVE_FIGURE_KEYS.includes(section)) return null;
  const t = await templateForAuthor(personId, db);
  return (t?.blocks ?? STANDARD_TEMPLATE).some((b) => b.key === section) ? section : null;
}
