// Сдача weekly команды за отчётную неделю (этап 15): светофор и одна строка. Этап 64: общий для «Weekly-команд»
// и просмотра команд в «Структуре». Цвет не единственный носитель смысла: в строке всегда есть слова

import { cn } from "@/lib/cn";
import { weeklyStatus, type WeeklyState } from "@/lib/org/team-rights";
import { slotText, type TeamRhythm } from "@/lib/org/rhythm";
import { TOP_TEAM } from "@/domain/teams";
import { deadlineText } from "@/components/weekly/weekly-feed";

export function WeeklyLine({ weekly, className }: { weekly: WeeklyState & { deadline: string }; className?: string }) {
  const status = weeklyStatus(weekly);
  if (status === "none") return <span className={cn("text-small text-muted", className)}>Weekly в этой команде не ждём</span>;
  const done = weekly.submitted + weekly.late;
  const tone = status === "done" ? "bg-green" : status === "overdue" ? "bg-danger" : "bg-amber";
  const word = status === "done" ? "все сдали" : status === "overdue" ? "срок прошёл" : deadlineText(weekly.deadline);
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 text-small text-ink", className)}>
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone)} aria-hidden="true" />
      <span>
        Weekly: сдали {done} из {weekly.expected}
        {weekly.late ? `, с опозданием ${weekly.late}` : ""}
        {weekly.absent ? `, нет на неделе ${weekly.absent}` : ""}
      </span>
      <span className="text-muted">
        ({word}
        {weekly.closed ? ", неделя закрыта" : ""})
      </span>
    </span>
  );
}

/** «Сдают руководители команд, срок: пятница, 16:00, встреча как у департамента» */
export function rhythmText(team: { id: string; rhythm: TeamRhythm }): string {
  if (team.id === TOP_TEAM) return "Сдают все участники, срок и встреча как у департамента";
  const who = team.rhythm.specialists ? "Сдают все участники" : "Сдают руководители команд, специалисты обновляют задачи";
  const deadline = team.rhythm.deadline ? `срок: ${slotText(team.rhythm.deadline)}` : "срок как у департамента";
  const meeting = team.rhythm.meeting ? `встреча: ${slotText(team.rhythm.meeting)}` : "встреча как у департамента";
  return `${who}, ${deadline}, ${meeting}`;
}
