import type { Actor } from "@/lib/tasks/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { isFiguresPlaceholder } from "@/lib/weekly-blocks/types";
import { sentReport, rolesOf, type SentReport } from "./reports";
import { seesComments } from "./rules";

type AuditContent = {
  action: string;
  entityId: string | null;
  field: string | null;
  before: unknown;
  after: unknown;
};

/** Журнал и Excel используют ту же проверку участия и те же блоки по уровню цифр, что обсуждение. */
export async function protectReportAudit<T extends AuditContent>(rows: T[], actor?: Actor): Promise<T[]> {
  const reports = new Map<string, SentReport | null>();
  const result: T[] = [];
  for (const row of rows) {
    if (row.action !== "weekly.report.comment") {
      result.push(row);
      continue;
    }
    const key = row.entityId ?? "";
    if (!reports.has(key)) {
      const [teamId, week, extra] = key.split("/");
      const report = actor && actor.via !== "TEAM" && teamId && isWeekKey(week) && !extra
        ? await sentReport(actor, teamId, week)
        : null;
      reports.set(key, report && actor && seesComments(rolesOf(actor, report)) ? report : null);
    }
    const report = reports.get(key);
    // Старые события неизменяемы. Закрываем содержание на чтении, включая вызов без зрителя.
    if (!report) {
      result.push({ ...row, field: "Обсуждение отчёта руководителю", before: null, after: null });
      continue;
    }
    // Формат старого журнала: цитата хранится в конце подписи. Возвращаем только заново разрешённую цитату;
    // неизвестные форматы подписи не пропускаем. Текст комментария разрешён как в самом обсуждении.
    const quote = row.field?.match(/, строка «([\s\S]*)»$/)?.[1];
    const visible = quote && report.blocks.some((b) => b.lines.some((line) => line.text === quote && !isFiguresPlaceholder(line)));
    result.push({
      ...row,
      field: `Обсуждение отчёта команды «${report.teamName}», неделя ${report.weekNumber}${visible ? `, строка «${quote}»` : ""}`,
      before: null,
    });
  }
  return result;
}
