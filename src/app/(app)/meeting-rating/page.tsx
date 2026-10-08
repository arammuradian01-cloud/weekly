import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { myRatings } from "@/lib/meeting-rating/service";
import { RATING_MIN } from "@/lib/meeting-rating/rules";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { RateForm } from "@/components/meeting-rating/rate-form";

export const metadata: Metadata = { title: "Оценка встреч" };

/** Оценка встреч раз в месяц (этап 29): анонимно, полезность от 1 до 5 и что убрать */
export default async function MeetingRatingPage() {
  await requireContext();
  const data = await myRatings(await currentActor());
  return (
    <div className="max-w-3xl">
      <PageHeader title="Оценка встреч" description="Раз в месяц, анонимно: насколько полезны встречи команды и что из них убрать" />
      {data.locked ? (
        <EmptyState title="Оценка недоступна">{data.locked}</EmptyState>
      ) : !data.months.some((m) => m.teams.length) ? (
        <EmptyState title="Оценивать нечего">Встречи оценивают участники команды, кроме руководителя. Вы не участник ни одной команды.</EmptyState>
      ) : (
        <>
          <p className="text-small text-muted">
            Ответ анонимный: отдельно записано, что вы ответили, и отдельно сама оценка, без связи между ними. Руководитель команды и руководство увидят итог после
            закрытия опроса, и только если ответили хотя бы {RATING_MIN}. Поэтому изменить ответ нельзя.
          </p>
          {data.months.map((m) => (
            <section key={m.month} className="mt-8" aria-labelledby={`month-${m.month}`}>
              <h2 id={`month-${m.month}`} className="text-title font-semibold text-ink first-letter:uppercase">
                {m.label}
              </h2>
              <p className="mt-1 text-small text-muted">Ответить можно до {m.closesLabel} включительно</p>
              <div className="mt-4 flex flex-col gap-4">
                {m.teams.map((t) => (
                  <RateForm key={`${m.month}/${t.id}`} month={m.month} monthLabel={m.label} team={t} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
