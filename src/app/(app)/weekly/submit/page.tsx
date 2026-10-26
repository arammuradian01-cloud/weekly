import type { Metadata } from "next";
import { Suspense } from "react";
import { requireContext } from "@/lib/auth";
import { formatDuration, formatMoment } from "@/lib/week";
import { currentReportingKey, getMyWeekly } from "@/lib/weekly/service";
import { entryPromises } from "@/lib/weekly/promise-service";
import { skippedFactKeys, weekFacts } from "@/lib/weekly/facts-service";
import { closedWeekText, sentReportsFor, submitWeeks } from "@/lib/weekly/submit-weeks";
import { templateForAuthor } from "@/lib/weekly-blocks/team";
import { subjectOf } from "@/lib/org/current";
import { canEditWeekly, sentReportsWarning, submitWeekOf } from "@/lib/weekly/rules";
import { isWeekKey } from "@/lib/weekly/weeks";
import { formatLong } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { WeeklySubmit } from "@/components/weekly/weekly-submit";
import { SubmitWeekSwitcher } from "@/components/weekly/submit-weeks";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { PageHeader } from "@/components/page-header";
import { weeklyReaders } from "@/lib/weekly/team-inbox";

export const metadata: Metadata = { title: "Сдать weekly" };

/**
 * Сдача weekly. Этап 73: за любую неделю не позже отчётной (?week=<понедельник>), переключатель недель над шагами.
 * Прошлая открытая неделя пишется и сдаётся как обычно, после срока «Сдан с опозданием». Закрытая неделя автору только
 * для чтения с подсказкой, кто может её открыть; владелец и администраторы в режиме управления правят, как раньше
 */
export default async function SubmitWeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string | string[] }> }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const wanted = Array.isArray(params.week) ? params.week[0] : params.week;
  const reporting = await currentReportingKey();
  const { key, future } = submitWeekOf(wanted, reporting, isWeekKey);
  const [mine, promises, facts, skipped, template, weeks, sent, readers] = await Promise.all([
    getMyWeekly(ctx.person.id, key),
    entryPromises(ctx.person.id, key),
    weekFacts(ctx.person.id, key, { limited: subjectOf(ctx).limited }),
    skippedFactKeys(ctx.person.id, key),
    // Смысловые блоки weekly команды (этап 66): записи сдаются по ним
    templateForAuthor(ctx.person.id),
    submitWeeks(ctx.person.id, key),
    sentReportsFor(ctx.person.id, key),
    weeklyReaders(ctx.person.id),
  ]);
  const now = new Date();
  const deadline = new Date(mine.week.deadline);
  const msLeft = deadline.getTime() - now.getTime();
  const canEdit = canEditWeekly(mine.week, key, { slug: ctx.person.slug as PersonSlug, management: ctx.management?.role ?? null, observer: ctx.person.role === "OBSERVER" }, ctx.person.slug as PersonSlug);
  const closedText = mine.week.closed && !canEdit ? await closedWeekText(ctx.person.id, key) : null;
  const past = key < reporting;
  const description = `${formatLong(mine.week.start)} - ${formatLong(mine.week.end)}. ${
    past ? "Прошлая неделя: weekly можно дописать и сдать, пока неделю не закрыли" : "Четыре шага на одном экране, обычно до 15 минут"
  }`;

  return (
    <>
      {/* Этап 37: шапка как у остальных разделов */}
      <PageHeader title={`Weekly за неделю ${mine.week.number}`} description={description} />
      <SubmitWeekSwitcher weeks={weeks} current={key} />
      {future ? (
        <p role="status" className="mb-4 sv-alert sv-alert--info text-small">
          За будущую неделю weekly не пишут: открыта отчётная неделя {mine.week.number}.
        </p>
      ) : null}
      <Suspense>
        <WeeklySubmit
          // Ключ по неделе: смена недели в переключателе начинает экран заново, черновики недель не смешиваются
          key={key}
          week={mine.week}
          initialReport={mine.report}
          initialEntries={mine.entries}
          canEdit={canEdit}
          deadlineText={formatMoment(deadline)}
          timeLeft={formatDuration(Math.max(0, msLeft))}
          late={msLeft < 0}
          past={past}
          closedText={closedText}
          sentWarning={sentReportsWarning(sent, mine.week.number)}
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
