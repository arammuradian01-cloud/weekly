import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import {
  formatDuration,
  formatMoment,
  formatWeekRange,
  isoWeekOf,
  moscowDate,
  reportingWeek,
  isoWeekday,
  type DeadlineSetting,
} from "@/lib/week";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import type { MeetingSetting } from "@/lib/weekly/weeks";
import { Suspense } from "react";
import { audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { MyWeek } from "@/components/weekly/my-week";
import { getMyWeekly, weeklyStates } from "@/lib/weekly/service";
import { promiseHistory } from "@/lib/weekly/promise-service";
import { shiftWeek } from "@/lib/weekly/weeks";
import { addDays, formatLong, fromCalendar } from "@/domain/dates";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { myRequests } from "@/lib/requests/service";
import { currentActor } from "@/lib/action-runner";

export const metadata: Metadata = { title: "Моя неделя" };

const WEEKDAYS_GENITIVE = ["понедельника", "вторника", "среды", "четверга", "пятницы", "субботы", "воскресенья"];
const WEEKDAYS_ACCUSATIVE = ["в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу", "в воскресенье"];

export default async function MyWeekPage() {
  const ctx = await requireContext();
  const { person, management } = ctx;
  const deadlineSetting = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const now = new Date();
  const week = reportingWeek(now, deadlineSetting);
  const weekKey = fromCalendar(week.start);
  const current = management ? await currentTeam(subjectOf(ctx)) : null;
  const [mine, team, requests, stats] = await Promise.all([
    getMyWeekly(person.id, weekKey),
    current ? weeklyStates(weekKey, audienceOf(current)) : Promise.resolve(null),
    myRequests(await currentActor(), now),
    // «Обещал и сделал» за законченные недели: отчётная ещё идёт (этап 22). По общему логину профиль мог выбрать
    // кто угодно, поэтому статистику показываем только при личном входе
    subjectOf(ctx).limited ? Promise.resolve([]) : promiseHistory([person.id], shiftWeek(weekKey, -1)),
  ]);
  // Свой срок человека (этап 15): команда может сдавать раньше департамента
  const deadline = new Date(mine.week.deadline);
  const today = moscowDate(now);
  const msLeft = deadline.getTime() - now.getTime();

  const deadlineDay = moscowDate(deadline);
  const deadlineTime = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(deadline);
  const currentWeek = isoWeekOf(today);
  // Встреча идёт на следующей неделе в день из настроек (по умолчанию вторник)
  const meetingSetting = await getSetting<MeetingSetting>("week.meeting", { weekday: 2 });
  const meetingDay = addDays(fromCalendar(week.start), 7 + meetingSetting.weekday - 1);
  const state = mine.report.state;
  const submitted = state === "submitted" || state === "late";

  return (
    <>
      {/* Главная по дизайн-системе (оболочка shell-sidebar): заголовок с главным действием, ниже плитки */}
      <PageHeader
        title="Моя неделя"
        description={
          <>
            Отчётная неделя {week.week}, {formatWeekRange(week)}. Weekly сдаётся до {WEEKDAYS_GENITIVE[isoWeekday(deadlineDay) - 1]} {String(deadlineDay.day).padStart(2, "0")}.{String(deadlineDay.month).padStart(2, "0")}, {deadlineTime}
            {currentWeek.week !== week.week ? `. Сейчас идёт неделя ${currentWeek.week}` : ""}
          </>
        }
      >
        <Link href="/weekly/submit" className={buttonClass(submitted ? "secondary" : "primary")}>
          {submitted ? "Открыть мой weekly" : state === "draft" ? "Продолжить weekly" : "Сдать weekly"}
        </Link>
      </PageHeader>

      <Suspense>
        <MyWeek
          deadlineText={formatMoment(deadline)}
          timeLeft={formatDuration(Math.max(0, msLeft))}
          late={msLeft < 0}
          weekNumber={week.week}
          report={mine.report}
          entriesCount={mine.entries.length}
          team={team}
          requests={requests}
          promiseStats={stats[0]}
          meetingText={`Встреча ${WEEKDAYS_ACCUSATIVE[meetingSetting.weekday - 1]}, ${formatLong(meetingDay)}`}
        />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
