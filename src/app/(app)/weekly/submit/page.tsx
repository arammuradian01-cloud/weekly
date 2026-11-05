import type { Metadata } from "next";
import { Suspense } from "react";
import { requireContext } from "@/lib/auth";
import { formatDuration, formatMoment } from "@/lib/week";
import { currentReportingKey, getMyWeekly } from "@/lib/weekly/service";
import { entryPromises } from "@/lib/weekly/promise-service";
import { skippedFactKeys, weekFacts } from "@/lib/weekly/facts-service";
import { templateForAuthor } from "@/lib/weekly-blocks/team";
import { subjectOf } from "@/lib/org/current";
import { canEditWeekly, sentReportsWarning, submitWeekOf } from "@/lib/weekly/rules";
import { closedWeekText, earliestWeek, sentReportsFor, submitWeeks } from "@/lib/weekly/submit-weeks";
import { isWeekKey, shiftWeek } from "@/lib/weekly/weeks";
import { weeklyReaders } from "@/lib/leader-report/service";
import { formatLong } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { WeeklySubmit } from "@/components/weekly/weekly-submit";
import { SubmitWeeks } from "@/components/weekly/submit-weeks";
import { TaskDrawer } from "@/components/tasks/task-drawer";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Сдать weekly" };

/**
 * Сдача weekly за неделю из адреса (этап 73+81): без недели отчётная, прошлые открываются переключателем. Права те же,
 * что были: свой weekly за открытую неделю пишет автор, закрытую неделю правят владелец и администраторы
 */
export default async function SubmitWeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const one = (v: unknown) => (Array.isArray(v) ? (v[0] as string | undefined) : (v as string | undefined));
  const reporting = await currentReportingKey();
  // Дальше самой старой недели ресурса не листаем: открытие недели создаёт её строку, и без границы «Раньше» завело бы
  // в базе недели, которых никогда не было. Недели раньше отчётной в базе нет совсем (пустой ресурс): границей
  // становится отчётная неделя
  const oldestRow = await earliestWeek();
  const floor = oldestRow && oldestRow < reporting ? oldestRow : reporting;
  const wanted = submitWeekOf(one(params.week), reporting, isWeekKey, floor);
  const key = wanted.key;
  const [mine, promises, facts, skipped, template, readers, weeks, closedText, sentReports] = await Promise.all([
    getMyWeekly(ctx.person.id, key),
    entryPromises(ctx.person.id, key),
    weekFacts(ctx.person.id, key, { limited: subjectOf(ctx).limited }),
    skippedFactKeys(ctx.person.id, key),
    // Смысловые блоки weekly команды (этап 66): записи сдаются по ним
    templateForAuthor(ctx.person.id),
    // Кто получит weekly (этап 73а)
    weeklyReaders(ctx.person.id),
    // Переключатель недель (этап 73+81)
    submitWeeks(ctx.person.id, key),
    closedWeekText(ctx.person.id, key),
    sentReportsFor(ctx.person.id, key),
  ]);
  const now = new Date();
  const deadline = new Date(mine.week.deadline);
  const msLeft = deadline.getTime() - now.getTime();
  const canEdit = canEditWeekly(mine.week, reporting, { slug: ctx.person.slug as PersonSlug, management: ctx.management?.role ?? null, observer: ctx.person.role === "OBSERVER" }, ctx.person.slug as PersonSlug);
  const past = key < reporting;
  // Предупреждение нужно и на отчётной неделе: отчёт за неделю N отправляют внутри недели N, и опоздавшие сдают
  // weekly уже после отправки - именно тогда оно и важно
  const sentWarning = sentReportsWarning(sentReports, mine.week.number);
  // В списке только недели, которые ресурс вёл, и неделя перед списком не раньше самой старой. older = null: листать
  // дальше некуда
  const shown = weeks.filter((w) => w.key >= floor);
  const before = shiftWeek(shown[shown.length - 1]?.key ?? key, -1);
  const older = before < floor ? null : before;
  return (
    <>
      {/* Этап 37: шапка как у остальных разделов */}
      <PageHeader
        title={`Weekly за неделю ${mine.week.number}`}
        description={`${formatLong(mine.week.start)} - ${formatLong(mine.week.end)}. Четыре шага на одном экране, обычно до 15 минут`}
      />
      {/* «Раньше» открывает неделю перед списком: оттуда список снова листается назад по одной неделе. Дошли до самой
          старой недели ресурса - ссылки нет */}
      <SubmitWeeks weeks={shown} selected={key} older={older} />
      {wanted.future ? (
        <p role="status" className="sv-alert sv-alert--warning mb-4 text-small">
          За будущую неделю weekly не пишут: открыта отчётная неделя {mine.week.number}.
        </p>
      ) : null}
      {wanted.tooOld ? (
        <p role="status" className="sv-alert sv-alert--warning mb-4 text-small" data-testid="submit-too-old-note">
          Недели раньше {mine.week.number} ресурс не вёл: открыта самая старая неделя.
        </p>
      ) : null}
      {past ? (
        <p className="mb-4 text-small text-muted" data-testid="submit-past-note">
          Это прошлая неделя {mine.week.number}. {canEdit ? "Сдать её ещё можно: сдача после срока отмечается «Сдан с опозданием»." : "Weekly за неё только для просмотра."}
        </p>
      ) : null}
      {closedText ? (
        <p role="status" className="sv-alert sv-alert--warning mb-4 text-small" data-testid="submit-closed-note">
          {closedText}
        </p>
      ) : null}
      {sentWarning ? (
        <p role="status" className="sv-alert sv-alert--warning mb-4 text-small" data-testid="submit-sent-warning">
          {sentWarning}
        </p>
      ) : null}
      <Suspense>
        <WeeklySubmit
          // Ключ по неделе: смена недели пересоздаёт редактор, и набранное за одну неделю не переезжает в другую
          key={key}
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
