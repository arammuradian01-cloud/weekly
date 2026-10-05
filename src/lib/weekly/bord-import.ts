// Разовый импорт вкладки «Weekly CEO» Insurance&Invest Bord (этап 4 ТЗ).
// Одна строка вкладки = одна запись weekly. Неделя записи: та, что закончилась перед встречей.

import type { PrismaClient } from "@/generated/prisma/client";
import { formatLong, type IsoDate } from "@/prototype/dates";
import { normalizeCell, parseCsv } from "@/lib/tasks/bord-import";
import { dbDate, isoFromRuDate } from "@/lib/tasks/dates";
import { splitWhat } from "./rules";
import { ensureWeek } from "./service";
import { weekKeyOfMeeting, weekNumberOf } from "./weeks";
import { moscowDateTime } from "@/lib/week";

export const WEEKLY_HEADER = ["Неделя (дата weekly)", "Блок", "Направление", "Новость / результат", "Цифра или факт", "Что дальше", "Кто", "В отчёт CEO", "Комментарий"] as const;

const ALL_LEADERS = "Все лидеры";

export type WeeklyRow = {
  meeting: IsoDate;
  block: string;
  direction: string;
  text: string;
  fact: string;
  next: string;
  author: string;
  ceo: boolean;
  comment: string;
};

/** Строки вкладки «Weekly CEO» из CSV вкладки или из выгрузки всей таблицы */
export function readWeeklyTable(text: string): WeeklyRow[] {
  let section = text;
  const marker = text.indexOf("## Sheet name: Weekly CEO");
  if (marker >= 0) {
    const next = text.indexOf("## Sheet name:", marker + 10);
    section = text.slice(marker, next >= 0 ? next : undefined);
  }
  const rows = parseCsv(section);
  const headerAt = rows.findIndex((r) => normalizeCell(r[0]) === WEEKLY_HEADER[0]);
  if (headerAt < 0) throw new Error("В файле нет вкладки Weekly CEO: не нашёл строку «Неделя (дата weekly), Блок, …»");
  const header = rows[headerAt]!.map(normalizeCell);
  WEEKLY_HEADER.forEach((name, i) => {
    if (header[i] !== name) throw new Error(`Колонка ${i + 1} называется «${header[i] ?? ""}», ожидалась «${name}». Формат вкладки поменялся`);
  });
  const out: WeeklyRow[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const date = normalizeCell(r[0]);
    if (!date) continue;
    const meeting = isoFromRuDate(date);
    if (!meeting) break;
    out.push({
      meeting,
      block: normalizeCell(r[1]),
      direction: normalizeCell(r[2]),
      text: normalizeCell(r[3]),
      fact: normalizeCell(r[4]),
      next: normalizeCell(r[5]),
      author: normalizeCell(r[6]),
      ceo: normalizeCell(r[7]).toLowerCase() === "да",
      comment: normalizeCell(r[8]),
    });
  }
  return out;
}

/** Направление из таблицы в справочник ресурса: «RED (ДВС, ипотека, ВЗР, ИФЛ)» это RED */
export function directionLabelKey(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
}

/** Тип записи по блоку: риски это «Риск», цифры это «Результат», остальное «Событие» */
export function entryTypeFor(blockCode: string): string {
  if (blockCode === "risks") return "risk";
  if (blockCode === "numbers") return "result";
  return "event";
}

export type WeeklyImportReport = { created: number; skipped: boolean; weeks: number[] };

/**
 * Импорт в пустой weekly: записи, сданные weekly у авторов и закрытые недели (их уже разобрали на встрече).
 * Если записи уже есть, ничего не делает: повторный запуск безопасен
 */
export async function importBordWeekly(db: PrismaClient, text: string, opts: { batch: string }): Promise<WeeklyImportReport> {
  if ((await db.weeklyEntry.count()) > 0) return { created: 0, skipped: true, weeks: [] };
  const rows = readWeeklyTable(text);
  const [people, dicts] = await Promise.all([db.person.findMany(), db.dictionaryItem.findMany({ where: { kind: { in: ["DIRECTION", "WEEKLY_BLOCK", "ENTRY_TYPE"] } } })]);
  const byName = new Map(people.map((p) => [p.fullName, p]));
  const find = (kind: string, pred: (label: string, code: string) => boolean) => dicts.find((d) => d.kind === kind && pred(d.label, d.code));

  const problems: string[] = [];
  const mapped = rows.map((r, i) => {
    const block = find("WEEKLY_BLOCK", (l) => l === r.block);
    const direction = find("DIRECTION", (l) => l.toLowerCase() === directionLabelKey(r.direction));
    const person = r.author && r.author !== ALL_LEADERS ? byName.get(r.author) : null;
    if (!block) problems.push(`строка ${i + 1}: блока «${r.block}» нет в справочнике`);
    if (!direction) problems.push(`строка ${i + 1}: направления «${r.direction}» нет в справочнике`);
    if (r.author && r.author !== ALL_LEADERS && !person) problems.push(`строка ${i + 1}: автора «${r.author}» нет в списке людей`);
    if (!r.text) problems.push(`строка ${i + 1}: пустая «Новость / результат»`);
    const type = block ? find("ENTRY_TYPE", (_l, c) => c === entryTypeFor(block.code)) : undefined;
    return { r, block, direction, person, type };
  });
  if (problems.length) throw new Error(`Импорт weekly остановлен, ничего не записано:\n- ${problems.join("\n- ")}`);

  const weeks = new Set<string>();
  await db.$transaction(async (tx) => {
    let order = 0;
    for (const { r, block, direction, person, type } of mapped) {
      const key = weekKeyOfMeeting(r.meeting);
      const week = await ensureWeek(tx, key);
      if (!weeks.has(key)) {
        weeks.add(key);
        // Эти недели уже разобраны на встрече: закрываем их датой встречи
        const m = r.meeting;
        await tx.week.update({ where: { id: week.id }, data: { closedAt: moscowDateTime({ year: +m.slice(0, 4), month: +m.slice(5, 7), day: +m.slice(8, 10) }, 12, 0), meetingDate: dbDate(m) } });
      }
      const { what, details } = splitWhat(r.text);
      const isUrl = /^https?:\/\//.test(r.comment);
      const extra = r.comment && !isUrl ? `Комментарий в таблице: ${r.comment}` : "";
      const fullDetails = [details, extra].filter(Boolean).join("\n\n") || null;
      await tx.weeklyEntry.create({
        data: {
          weekId: week.id,
          authorId: person?.id ?? null,
          directionId: direction!.id,
          blockId: block!.id,
          typeId: type!.id,
          what,
          details: fullDetails && fullDetails.length > 1000 ? fullDetails.slice(0, 999) + "…" : fullDetails,
          fact: r.fact || null,
          next: r.next || null,
          links: isUrl ? [{ title: new URL(r.comment).hostname, url: r.comment }] : [],
          ceo: r.ceo,
          sortOrder: order++,
          importBatch: opts.batch,
        },
      });
      if (person) {
        await tx.weeklyReport.upsert({
          where: { weekId_authorId: { weekId: week.id, authorId: person.id } },
          update: {},
          // Кто писал записи, тот сдал weekly. Главной фразы и времени сдачи в таблице нет
          create: { weekId: week.id, authorId: person.id, state: "SUBMITTED", headline: "" },
        });
      }
    }
    for (const key of weeks) {
      const n = mapped.filter((m) => weekKeyOfMeeting(m.r.meeting) === key).length;
      await tx.auditLog.create({
        data: {
          action: "weekly.import",
          source: "SHEET",
          actorName: "Импорт из таблицы",
          entity: "week",
          entityId: key,
          field: "Weekly перенесён из Insurance&Invest Bord",
          after: `Неделя ${weekNumberOf(key)}: ${n} записей, встреча ${formatLong(mapped.find((m) => weekKeyOfMeeting(m.r.meeting) === key)!.r.meeting)}`,
        },
      });
    }
  });
  return { created: mapped.length, skipped: false, weeks: [...weeks].map(weekNumberOf) };
}
