import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import {
  WEEKDAYS_SHORT,
  formatDuration,
  formatMoment,
  formatWeekRange,
  greeting,
  isoWeekOf,
  moscowDate,
  reportingWeek,
  weeklyDeadline,
  type DeadlineSetting,
} from "@/lib/week";
import { WeekStrip, type StripDay } from "@/components/brand/week-strip";
import { Suspense } from "react";
import { MyWeek } from "@/components/weekly/my-week";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Моя неделя" };

function sameDay(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export default async function MyWeekPage() {
  const { person } = await requireContext();
  const deadlineSetting = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const now = new Date();
  const week = reportingWeek(now, deadlineSetting);
  const deadline = weeklyDeadline(week, deadlineSetting);
  const today = moscowDate(now);
  const msLeft = deadline.getTime() - now.getTime();

  const days: StripDay[] = WEEKDAYS_SHORT.map((weekday, i) => {
    const d = new Date(Date.UTC(week.start.year, week.start.month - 1, week.start.day + i));
    const date = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    const isToday = sameDay(date, today);
    const isPast = !isToday && Date.UTC(date.year, date.month - 1, date.day) < Date.UTC(today.year, today.month - 1, today.day);
    return { key: weekday, weekday, date: date.day, state: isToday ? "today" : isPast ? "past" : "future" };
  });
  const deadlineDay = moscowDate(deadline);
  const currentWeek = isoWeekOf(today);

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold leading-tight text-ink sm:text-[30px]">
          {greeting(now)}, {person.shortName}
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Отчётная неделя {week.week}, {formatWeekRange(week)}
          {currentWeek.week !== week.week ? `. Сейчас идёт неделя ${currentWeek.week}` : ""}
        </p>
        <div className="-mx-2 mt-6 max-w-2xl">
          <WeekStrip
            days={days}
            deadline={{ weekday: WEEKDAYS_SHORT[deadlineSetting.weekday - 1]!, date: deadlineDay.day, time: deadlineSetting.time }}
          />
        </div>
      </header>

      <Suspense>
        <MyWeek deadlineText={formatMoment(deadline)} timeLeft={formatDuration(Math.max(0, msLeft))} late={msLeft < 0} />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
