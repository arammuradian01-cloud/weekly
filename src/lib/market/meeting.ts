// Разбор рынка на встрече (этап 62). Решение Арама 22.10: рынок КАСКО и ОСАГО разбираем на встрече в начале каждого
// месяца. На первой встрече команды в календарном месяце (раньше в этом месяце встреч этой команды не было) первым
// пунктом встаёт «Рынок КАСКО и ОСАГО: итоги <прошлого месяца>». Команды выбирает владелец в «Настройках», по
// умолчанию топ-команда. Пункт появляется, когда пакет рынка загружен: без данных разбирать нечего.
// Пункт автоматический с ключом месяца: пересборка повестки его не дублирует, убранный ведущим не возвращается.

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatLong, monthGenitive, type IsoDate } from "@/domain/dates";
import { dbDate, moscowToday } from "@/lib/tasks/dates";
import { loadMarketMeeting } from "./access";
import { marketMeta } from "./service";

type Db = Prisma.TransactionClient | typeof prisma;

export type MarketAgendaDraft = { autoKey: string; title: string; note: string };

/** Название пункта: итоги прошлого месяца, год только когда он другой (январская встреча разбирает декабрь) */
export function marketAgendaTitle(meetingDate: IsoDate): string {
  const year = Number(meetingDate.slice(0, 4));
  const month = Number(meetingDate.slice(5, 7));
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `Рынок КАСКО и ОСАГО: итоги ${monthGenitive(prevMonth)}${prevYear !== year ? ` ${prevYear}` : ""}`;
}

/** Подпись к пункту: от какого дня данные и свежие ли они для этого месяца. Без цифр */
export function marketAgendaNote(meetingDate: IsoDate, uploadedAt: Date): string {
  const day = moscowToday(uploadedAt);
  const fresh = day >= `${meetingDate.slice(0, 7)}-01`;
  return fresh ? `Данные рынка от ${formatLong(day)}.` : `Свежий пакет рынка в этом месяце ещё не загружали: данные от ${formatLong(day)}.`;
}

/**
 * Пункт разбора рынка для встречи команды или null. meetingId: встреча, для которой собирается повестка, если она
 * уже есть (её саму в «раньше в этом месяце» не считаем)
 */
export async function marketAgendaDraft(teamId: string, meetingDate: IsoDate, meetingId: string | null, db: Db = prisma): Promise<MarketAgendaDraft | null> {
  const { teamIds } = await loadMarketMeeting(db);
  if (!teamIds.includes(teamId)) return null;
  const meta = await marketMeta(db);
  if (!meta) return null;
  const monthStart = `${meetingDate.slice(0, 7)}-01`;
  const earlier = await db.meeting.count({
    where: { teamId, date: { gte: dbDate(monthStart), lt: dbDate(meetingDate) }, ...(meetingId ? { id: { not: meetingId } } : {}) },
  });
  if (earlier) return null;
  return { autoKey: `market:${meetingDate.slice(0, 7)}`, title: marketAgendaTitle(meetingDate), note: marketAgendaNote(meetingDate, new Date(meta.uploadedAt)) };
}
