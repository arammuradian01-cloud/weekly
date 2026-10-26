// «Текущая неделя» отчёта руководителю команды страхования и инвестиций (этап 73): бывший отчёт CEO со всеми блоками,
// конкурентами и отправкой. Меняются название и адресат: «Отправить руководителю: <ФИО>», получатель CEO по структуре.
// Неделя без адреса: отчётная (решение Арама 23.10), а не последняя неделя с записями weekly.

import { canSendTop, ceoRecipients, personalLogin } from "@/lib/ceo/report";
import { assembleCeoBlocks, blocksMeta, loadCompetitors } from "@/lib/weekly-blocks/sources";
import { withLiveBlocks } from "@/lib/weekly-blocks/types";
import { ceoDecisions, ceoReportHistory, getCeoReport, getWeekView } from "@/lib/weekly/service";
import { promiseHistory, weekPromises } from "@/lib/weekly/promise-service";
import { shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { CeoReport } from "@/components/ceo/ceo-report";
import { topAudience } from "@/lib/org/current";
import { weekNumbers } from "@/lib/numbers/service";
import { forecastSummary } from "@/lib/forecast/service";
import { planAsOfWeek, planBrief, planMonthOfWeek } from "@/lib/plan/processes";
import type { Actor } from "@/lib/tasks/service";
import type { WeekKey } from "@/domain/types";

export async function TopReportCurrent({ actor, week }: { actor: Actor; week: WeekKey }) {
  // Отчёт собирается из weekly команды страхования и инвестиций, какая бы команда ни была выбрана в шапке
  const audience = await topAudience();
  const view = await getWeekView(week, new Date(), audience);
  // Личную статистику «обещал и сделал» видит только директор (этап 22): это диагностика, а не рейтинг
  const owner = actor.management === "OWNER";
  const previousKey = shiftWeek(view.week.key, -1);
  const [stored, history, promises, stats, numbers, forecast, decisions, previous, plan, auto, meta, competitors, recipients, canSend] = await Promise.all([
    getCeoReport(view.week.key),
    ceoReportHistory(),
    weekPromises(view.week.key, audience.personIds),
    owner ? promiseHistory(audience.personIds, view.week.key < view.reportingKey ? view.week.key : shiftWeek(view.reportingKey, -1)) : Promise.resolve(undefined),
    weekNumbers(view.week.key),
    forecastSummary(view.week.key, audience),
    ceoDecisions(view.week.key),
    getCeoReport(previousKey),
    planBrief(actor, planMonthOfWeek(view.week.key), planAsOfWeek(view.week.key, view.reportingKey, view.week.number)),
    assembleCeoBlocks(actor, view.week.key),
    blocksMeta(),
    loadCompetitors(),
    ceoRecipients(),
    canSendTop(actor),
  ]);
  // Живые цифры: «Неделя к неделе» и «Месяц» без правок руками показываются по свежей автосборке, поправленные с пометкой
  const saved = stored.blocks ? { ...stored, blocks: withLiveBlocks(stored.blocks, auto.blocks) } : stored;
  const sendHint = !personalLogin(actor)
    ? "Отправить руководителю можно при личном входе: так получатель видит, кто отправил"
    : !recipients.length
      ? "Руководитель не найден: назначьте руководителя компании в «Структуре» или включите профиль CEO в «Людях»"
      : null;
  return (
    <CeoReport
      // Ключ только по неделе: обновление страницы не пересоздаёт редактор и не стирает набранное
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
      send={{ can: canSend && recipients.length > 0, hint: sendHint, recipients: recipients.map((r) => r.fullName) }}
    />
  );
}
