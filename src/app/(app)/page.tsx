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
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

      <section aria-labelledby="my-weekly" className="rounded-xl bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="my-weekly" className="text-[19px] font-semibold text-ink">
                Мой weekly за неделю {week.week}
              </h2>
              <Badge tone="outline">Не начат</Badge>
            </div>
            <p className="mt-1.5 text-[15px] text-muted">
              Срок сдачи: {formatMoment(deadline)}.{" "}
              {msLeft > 0 ? `Осталось ${formatDuration(msLeft)}.` : `Срок прошёл ${formatDuration(-msLeft)} назад.`}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <Button disabled>Сдать weekly</Button>
            <span className="text-[13px] text-muted">Сдача weekly появится на этапе 4</span>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-2">
        <section aria-labelledby="my-tasks">
          <h2 id="my-tasks" className="mb-3 text-[19px] font-semibold text-ink">
            Мои задачи
          </h2>
          <EmptyState title="Задач пока нет" stage="Этап 3">
            Сюда переедут задачи из Insurance&amp;Invest Bord: сверху просроченные, потом со сроком на этой неделе.
          </EmptyState>
        </section>
        <section aria-labelledby="my-comments">
          <h2 id="my-comments" className="mb-3 text-[19px] font-semibold text-ink">
            Новые комментарии
          </h2>
          <EmptyState title="Новых комментариев нет" stage="Этап 3">
            Здесь будут комментарии коллег к вашим задачам.
          </EmptyState>
        </section>
      </div>
    </>
  );
}
