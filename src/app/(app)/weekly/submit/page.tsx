import type { Metadata } from "next";
import { Suspense } from "react";
import { requireContext } from "@/lib/auth";
import { formatDuration, formatMoment } from "@/lib/week";
import { currentReportingKey, getMyWeekly } from "@/lib/weekly/service";
import { entryPromises } from "@/lib/weekly/promise-service";
import { weekFacts } from "@/lib/weekly/facts-service";
import { canEditWeekly } from "@/lib/weekly/rules";
import { formatLong } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { WeeklySubmit } from "@/components/weekly/weekly-submit";
import { TaskDrawer } from "@/components/tasks/task-drawer";

export const metadata: Metadata = { title: "Сдать weekly" };

export default async function SubmitWeeklyPage() {
  const ctx = await requireContext();
  const key = await currentReportingKey();
  const [mine, promises, facts] = await Promise.all([getMyWeekly(ctx.person.id, key), entryPromises(ctx.person.id, key), weekFacts(ctx.person.id, key)]);
  const now = new Date();
  const deadline = new Date(mine.week.deadline);
  const msLeft = deadline.getTime() - now.getTime();
  const canEdit = canEditWeekly(mine.week, key, { slug: ctx.person.slug as PersonSlug, management: ctx.management?.role ?? null, observer: ctx.person.role === "OBSERVER" }, ctx.person.slug as PersonSlug);

  return (
    <>
      <header className="mb-8">
        <h1 className="text-page font-semibold leading-tight text-ink sm:text-page-lg">Weekly за неделю {mine.week.number}</h1>
        <p className="mt-1.5 text-body text-muted">
          {formatLong(mine.week.start)} - {formatLong(mine.week.end)}. Четыре шага на одном экране, обычно до 15 минут
        </p>
      </header>
      <Suspense>
        <WeeklySubmit
          week={mine.week}
          initialReport={mine.report}
          initialEntries={mine.entries}
          canEdit={canEdit}
          deadlineText={formatMoment(deadline)}
          timeLeft={formatDuration(Math.max(0, msLeft))}
          late={msLeft < 0}
          promoted={mine.promoted}
          expectedIn={mine.expectedIn}
          promises={promises}
          facts={facts}
        />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
