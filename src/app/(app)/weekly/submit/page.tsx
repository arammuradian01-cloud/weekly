import type { Metadata } from "next";
import { Suspense } from "react";
import { requireContext } from "@/lib/auth";
import { formatDuration, formatMoment } from "@/lib/week";
import { currentReportingKey, getMyWeekly } from "@/lib/weekly/service";
import { entryPromises } from "@/lib/weekly/promise-service";
import { skippedFactKeys, weekFacts } from "@/lib/weekly/facts-service";
import { templateForAuthor } from "@/lib/weekly-blocks/team";
import { subjectOf } from "@/lib/org/current";
import { canEditWeekly } from "@/lib/weekly/rules";
import { formatLong } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { WeeklySubmit } from "@/components/weekly/weekly-submit";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { PageHeader } from "@/components/page-header";
import { weeklyReaders } from "@/lib/weekly/team-inbox";

export const metadata: Metadata = { title: "Сдать weekly" };

export default async function SubmitWeeklyPage() {
  const ctx = await requireContext();
  const key = await currentReportingKey();
  const [mine, promises, facts, skipped, template, readers] = await Promise.all([
    getMyWeekly(ctx.person.id, key),
    entryPromises(ctx.person.id, key),
    weekFacts(ctx.person.id, key, { limited: subjectOf(ctx).limited }),
    skippedFactKeys(ctx.person.id, key),
    // Смысловые блоки weekly команды (этап 66): записи сдаются по ним
    templateForAuthor(ctx.person.id),
    weeklyReaders(ctx.person.id),
  ]);
  const now = new Date();
  const deadline = new Date(mine.week.deadline);
  const msLeft = deadline.getTime() - now.getTime();
  const canEdit = canEditWeekly(mine.week, key, { slug: ctx.person.slug as PersonSlug, management: ctx.management?.role ?? null, observer: ctx.person.role === "OBSERVER" }, ctx.person.slug as PersonSlug);

  return (
    <>
      {/* Этап 37: шапка как у остальных разделов */}
      <PageHeader title={`Weekly за неделю ${mine.week.number}`} description={`${formatLong(mine.week.start)} - ${formatLong(mine.week.end)}. Четыре шага на одном экране, обычно до 15 минут`} />
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
          skippedFacts={skipped}
          template={template}
          readers={readers}
        />
        <TaskDrawer />
      </Suspense>
    </>
  );
}
