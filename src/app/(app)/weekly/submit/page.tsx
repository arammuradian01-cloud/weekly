import type { Metadata } from "next";
import { Suspense } from "react";
import { getSetting } from "@/lib/settings";
import { formatDuration, formatMoment, formatWeekRange, reportingWeek, weeklyDeadline, type DeadlineSetting } from "@/lib/week";
import { WeeklySubmit } from "@/components/weekly/weekly-submit";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Сдать weekly" };

export default async function SubmitWeeklyPage() {
  const setting = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const now = new Date();
  const week = reportingWeek(now, setting);
  const deadline = weeklyDeadline(week, setting);
  const msLeft = deadline.getTime() - now.getTime();

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[26px] font-semibold leading-tight text-ink sm:text-[30px]">Weekly за неделю {week.week}</h1>
        <p className="mt-1.5 text-[15px] text-muted">{formatWeekRange(week)}. Три шага на одном экране, обычно до 15 минут</p>
      </header>
      <Suspense>
        <WeeklySubmit deadlineText={formatMoment(deadline)} timeLeft={formatDuration(Math.max(0, msLeft))} late={msLeft < 0} />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
