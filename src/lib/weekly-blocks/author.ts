// Шаблон блоков, по которому человек сдаёт weekly (этап 66). Отдельно от сервиса отчёта команды: его читает и сохранение
// записи weekly (src/lib/weekly/service.ts), а сервис отчёта команды сам зависит от weekly. Так нет круга импортов.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { TOP_TEAM, loadTeamNodes } from "@/lib/org/scope";
import { expectingTeams } from "@/lib/org/rhythm";
import { LIVE_FIGURE_KEYS, cleanTemplate, type TemplateBlock } from "./types";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Шаблон, по которому человек сдаёт weekly: первая из команд, которые ждут его weekly, а без них первая из его команд,
 * где шаблон задан. Человек в нескольких командах сдаёт одну запись: свой блок другой команды в ней не понять, тогда
 * запись раскладывается по смыслу
 */
export async function templateForAuthor(personId: string, db: Db = prisma): Promise<{ teamId: string; teamName: string; blocks: TemplateBlock[] } | null> {
  const nodes = await loadTeamNodes(db);
  const expecting = expectingTeams(personId, nodes).filter((n) => n.id !== TOP_TEAM);
  const member = nodes.filter((n) => n.active && n.id !== TOP_TEAM && n.members.includes(personId) && !expecting.some((e) => e.id === n.id));
  const order = [...expecting, ...member];
  if (!order.length) return null;
  const rows = await db.teamWeeklyTemplate.findMany({ where: { teamId: { in: order.map((n) => n.id) } } });
  for (const n of order) {
    const row = rows.find((r) => r.teamId === n.id);
    const blocks = row ? cleanTemplate(row.blocks) : [];
    if (blocks.length) return { teamId: n.id, teamName: n.name, blocks };
  }
  return null;
}

/**
 * Блок шаблона, который человек может поставить записи: из шаблона, по которому он сдаёт weekly. null: блок не задан,
 * чужой или это блок цифр («Неделя к неделе», «Месяц»): их собирает ресурс, запись туда не идёт
 */
export async function sectionForAuthor(personId: string, section: unknown, db: Db = prisma): Promise<string | null> {
  if (typeof section !== "string" || !section || LIVE_FIGURE_KEYS.includes(section)) return null;
  const t = await templateForAuthor(personId, db);
  return t?.blocks.some((b) => b.key === section) ? section : null;
}
