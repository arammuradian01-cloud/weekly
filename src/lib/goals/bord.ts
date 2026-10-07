// Цели из вкладок целей рабочего Bord (этап 17): только чтение тем же служебным аккаунтом, что и забор задач.
// В Bord ресурс ничего не пишет: у читателя есть только getValues.

import { bordConnection } from "@/lib/sheet/runner";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { applyGoals, planGoals, type GoalsPlan } from "./service";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

/** Вкладки целей, которые есть в Bord сейчас: подсказка в форме, имя можно написать и своё */
export const BORD_GOAL_TABS = ["Цели. Каско", "Цели. Depo", "Цели. RED", "Цели PO OSAGO", "Цели Q4 Каско", "IT BP Avto", "CRM Unit", "Analyst Unit"];

async function readTab(actor: Actor, tab: string): Promise<string[][]> {
  if (actor.management !== "OWNER") fail("Цели из Bord забирает владелец в режиме управления");
  const name = tab.trim();
  if (!name || name.length > 100) fail("Напишите название вкладки целей, как в Bord");
  const conn = await bordConnection();
  if (!conn) fail("Забор из Bord не подключён: ссылка на Bord на странице «Синхронизация»");
  try {
    // Вкладка целиком: размер вкладок в бордах разный, лишний диапазон Google не принимает
    const grid = await conn!.reader.getValues(`'${name.replace(/'/g, "''")}'`);
    return grid.map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c))));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/нет нужной вкладки|Unable to parse range|not found/i.test(message)) fail(`В Bord нет вкладки «${name}»: проверьте название`);
    throw error;
  }
}

export async function previewBordGoals(actor: Actor, tab: string, opts: { team: string; quarter?: string | null }): Promise<GoalsPlan> {
  return planGoals(actor, await readTab(actor, tab), opts);
}

export async function applyBordGoals(actor: Actor, tab: string, opts: { team: string; quarter?: string | null }) {
  return applyGoals(actor, await readTab(actor, tab), { ...opts, source: `bord:${tab.trim()}` });
}
