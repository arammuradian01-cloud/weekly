import type { Metadata } from "next";
import { requireContext, requireManagement } from "@/lib/auth";
import { canSendCeo, ceoRecipients, ceoSentReports, personalLogin } from "@/lib/ceo/report";
import { assembleCeoBlocks, blocksMeta, loadCompetitors } from "@/lib/weekly-blocks/sources";
import { CeoSentReport } from "@/components/ceo/ceo-sent";
import { ceoDecisions, ceoReportHistory, getCeoReport, getWeekView } from "@/lib/weekly/service";
import { promiseHistory, weekPromises } from "@/lib/weekly/promise-service";
import { isWeekKey, shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { PageHeader } from "@/components/page-header";
import { CeoReport } from "@/components/ceo/ceo-report";
import { topAudience } from "@/lib/org/current";
import { weekNumbers } from "@/lib/numbers/service";
import { forecastSummary } from "@/lib/forecast/service";
import { currentActor } from "@/lib/action-runner";
import { planAsOfWeek, planBrief, planMonthOfWeek } from "@/lib/plan/processes";

export const metadata: Metadata = { title: "Отчёт CEO" };

export default async function CeoReportPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  // Этап 61: CEO видит отправленные ему weekly собранными и только для чтения, при личном входе. Остальным без режима
  // управления страница закрыта, как раньше
  const base = await requireContext();
  if (base.management?.role !== "OWNER" && base.management?.role !== "ADMIN") {
    const sent = await ceoSentReports(await currentActor(), isWeekKey(week) ? week : null);
    if (sent) {
      return (
        <>
          <PageHeader title="Отчёт CEO" description="Weekly, которые вам отправили из приложения по итогам встреч" />
          <CeoSentReport view={sent} />
        </>
      );
    }
  }
  const ctx = await requireManagement(["OWNER", "ADMIN"], "/ceo-report");
  // Отчёт CEO собирается из weekly топ-команды, какая бы команда ни была выбрана
  const audience = await topAudience();
  const view = await getWeekView(isWeekKey(week) ? week : null, new Date(), audience);
  // Личную статистику «обещал и сделал» видит только директор (этап 22): это диагностика, а не рейтинг
  const owner = ctx.management?.role === "OWNER";
  const previousKey = shiftWeek(view.week.key, -1);
  const actor = await currentActor();
  const [saved, history, promises, stats, numbers, forecast, decisions, previous, plan, auto, meta, competitors, recipients] = await Promise.all([
    getCeoReport(view.week.key),
    ceoReportHistory(),
    weekPromises(view.week.key, audience.personIds),
    // То же окно, что у человека на «Моей неделе»: только законченные недели
    owner ? promiseHistory(audience.personIds, view.week.key < view.reportingKey ? view.week.key : shiftWeek(view.reportingKey, -1)) : Promise.resolve(undefined),
    // Цифры недели и прогноз (этап 24)
    weekNumbers(view.week.key),
    forecastSummary(view.week.key, audience),
    // Отчёт CEO 2.0 (этап 27): решения недели и прошлый отчёт для сравнения
    ceoDecisions(view.week.key),
    getCeoReport(previousKey),
    // Прогноз месяца по драйверам (этап 35): месяц недели, как у её номера. Прошлая неделя (этап 39): прогноз на её конец
    planBrief(actor, planMonthOfWeek(view.week.key), planAsOfWeek(view.week.key, view.reportingKey, view.week.number)),
    // Weekly по смысловым блокам (этап 66): свежая автосборка, продукты для подписей, конкуренты и кому уйдёт отчёт
    assembleCeoBlocks(actor, view.week.key),
    blocksMeta(),
    loadCompetitors(),
    ceoRecipients(),
  ]);
  const sendHint = !personalLogin(actor) ? "Отправить CEO можно при личном входе: так CEO видит, кто отправил" : !recipients.length ? "CEO не найден: назначьте руководителя компании в «Структуре» или включите профиль CEO в «Людях»" : null;
  return (
    <>
      <PageHeader title="Отчёт CEO" description="Weekly для CEO по смысловым блокам: новости, неделя к неделе, месяц, конкуренты, продукты, партнёрский канал, риски и план на неделю" />
      <CeoReport
        // Ключ только по неделе: обновление страницы не пересоздаёт редактор и не стирает набранное (новую версию он принимает сам)
        key={view.week.key}
        view={view}
        saved={saved}
        history={history}
        promises={promises}
        stats={stats}
        numbers={numbers}
        forecast={forecast}
        plan={plan}
        decisions={decisions}
        previous={{ number: weekNumberOf(previousKey), report: previous }}
        owner={owner}
        auto={auto}
        meta={meta}
        competitors={competitors}
        send={{ can: canSendCeo(actor) && recipients.length > 0, hint: sendHint, recipients: recipients.map((r) => r.fullName) }}
      />
    </>
  );
}
