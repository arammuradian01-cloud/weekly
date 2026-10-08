import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { subjectOf } from "@/lib/org/current";
import { teamAnalytics } from "@/lib/analytics/service";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AnalyticsScreen } from "@/components/analytics/analytics-screen";
import { ratingResults } from "@/lib/meeting-rating/service";
import { RatingResultsPanel } from "@/components/meeting-rating/rating-results";

export const metadata: Metadata = { title: "Аналитика" };

/** Аналитика руководителя (этап 27, модуль М12): владелец и администраторы видят любую команду, руководитель свою и ниже */
export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const ctx = await requireContext();
  const { team } = await searchParams;
  const subject = subjectOf(ctx);
  const data = await teamAnalytics(subject, team ?? null);
  // Анонимная оценка встреч (этап 29): те же права, что у аналитики
  const rating = data ? await ratingResults(subject, data.team.id) : null;
  return (
    <>
      <PageHeader title="Аналитика" description="Weekly, задачи, просьбы и цели команды за 8 недель и карточка по каждому лидеру" />
      {data ? (
        <>
          <AnalyticsScreen data={data} />
          {rating ? <RatingResultsPanel data={rating} /> : null}
        </>
      ) : (
        <EmptyState title="Аналитика открыта руководителям команд">Здесь руководитель видит, как идут weekly и задачи в его команде и командах ниже.</EmptyState>
      )}
    </>
  );
}
