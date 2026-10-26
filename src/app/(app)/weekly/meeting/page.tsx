import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { getWeekView } from "@/lib/weekly/service";
import { isWeekKey } from "@/lib/weekly/weeks";
import { MeetingMode } from "@/components/weekly/meeting-mode";
import { MeetingLive } from "@/components/meeting/meeting-live";
import { BuildAgendaBanner } from "@/components/meeting/build-agenda-banner";
import { ALL_TEAMS, audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import { currentActor } from "@/lib/action-runner";
import { meetingQuestions } from "@/lib/discuss/service";
import { stuckForMeeting } from "@/lib/requests/service";
import { canLeadTeam, getMeeting, meetingWeekFor } from "@/lib/meeting/service";
import { weekNumbers } from "@/lib/numbers/service";
import { briefFor, numbersLevel } from "@/lib/plan/access";
import { WeekNumbersBlock } from "@/components/forecast/week-numbers";
import { planAsOfWeek, planForTeam, planMonthOfWeek } from "@/lib/plan/processes";
import { PlanBriefBlock } from "@/components/plan/plan-brief";
import { listParses } from "@/lib/meeting/parse-service";
import { NotionParseBar } from "@/components/meeting/notion-parse-bar";
import { WeekSwitcher } from "@/components/weekly/week-switcher";
import { weekOf } from "@/domain/dates";
import { formatWeekRange } from "@/lib/week";
import type { WeekKey } from "@/domain/types";

export const metadata: Metadata = { title: "Встреча" };

type Params = Record<string, string | string[] | undefined>;

/** Параметры адреса, кроме недели: экран проектора и прочие сохраняются при выборе недели */
function restOf(params: Params): [string, string][] {
  return Object.entries(params).flatMap(([k, v]) => (k === "week" || v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((one): [string, string] => [k, one])));
}

function meetingUrl(params: Params, week: WeekKey): string {
  return `/weekly/meeting?${new URLSearchParams([["week", week], ...restOf(params)]).toString()}`;
}

export default async function MeetingPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const week = typeof params.week === "string" ? params.week : undefined;
  const projector = params.screen === "projector";
  const team = await currentTeam(subjectOf(ctx));
  const audience = audienceOf(team);
  // Встреча 2.0 (этап 23): у одной команды свой объект встречи с повесткой и решениями. «Все команды» показывают
  // ленту недели по-старому: встреча идёт в каждой команде отдельно
  const single = team.id && team.id !== ALL_TEAMS ? { id: team.id, name: team.name } : null;
  const now = new Date();
  // Этап 73б. Неделю без явного выбора считаем один раз (идущая встреча команды, иначе отчётная) и уходим на адрес с
  // ней. Живые обновления перечитывают страницу: без ?week= после вторника 18:00 все уехали бы на пустую новую неделю
  if (!isWeekKey(week)) redirect(meetingUrl(params, await meetingWeekFor(single?.id ?? null, week, now)));
  const view = await getWeekView(week, now, audience, { fallback: false });
  // Будущую неделю сервер не открывает: адрес показывает ту, что открыта
  if (view.week.key !== week) redirect(meetingUrl(params, await meetingWeekFor(single?.id ?? null, week, now)));
  const rest = restOf(params).filter(([k]) => k !== "screen");
  const weekNav = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="meeting-week">
      <WeekSwitcher view={view} basePath="/weekly/meeting" query={rest.length ? `&${new URLSearchParams(rest).toString()}` : ""} />
      <span className="text-small text-muted">{formatWeekRange(weekOf(view.week.key))}</span>
      {view.week.reporting ? null : <span className="text-small text-muted">Не отчётная неделя</span>}
    </div>
  );
  const actor = await currentActor();
  // Этап 57: цифры недели и итог прогноза в шапке встречи это основные цифры: их видят те, кому открыт хотя бы этот уровень
  const level = await numbersLevel(actor);
  const numbersOpen = level !== "none";
  const [meeting, canLead, numbers, fullPlan, parses] = single
    ? await Promise.all([
        getMeeting(actor, single.id, view.week.key),
        canLeadTeam(actor, single.id),
        numbersOpen ? weekNumbers(view.week.key) : null,
        numbersOpen ? planForTeam(actor, single.id, planMonthOfWeek(view.week.key), planAsOfWeek(view.week.key, view.reportingKey, view.week.number)) : null,
        // Разборы встречи из Notion (этап 61)
        listParses(actor, single.id, view.week.key).catch(() => []),
      ])
    : [null, false, null, null, []];
  // Основные цифры: итог месяца без корректировок команд и партнёров
  const plan = briefFor(level, fullPlan);
  // Этап 61: разобрать встречу из Notion, итоги, weekly для CEO и задачи на проверку. Есть и до сборки повестки
  const notionBar = single ? <NotionParseBar team={single} week={view.week.key} canLead={canLead} notionUrl={meeting?.notionUrl ?? null} parses={parses} /> : null;
  // Цифры недели (этап 24) в шапке встречи, когда они выбраны и есть за эту неделю. Прогноз месяца (этап 35): у топ-команды
  // и у команд, где есть кто-то из команд продуктов
  const numbersBlock =
    (numbers && numbers.figures.length) || plan ? (
      <div className="mb-4 flex flex-col gap-4">
        {numbers && numbers.figures.length ? <WeekNumbersBlock numbers={numbers} compact /> : null}
        {plan ? <PlanBriefBlock brief={plan} compact headingLevel={2} /> : null}
      </div>
    ) : null;
  // Переключатель недели живая встреча показывает сама: не на проекторе и не пока встреча идёт
  if (single && meeting) return <MeetingLive key={`${view.week.key}-${single.id}`} view={view} meeting={meeting} canLead={canLead} team={single} numbers={numbersBlock} notion={notionBar} weekNav={weekNav} />;
  // Повестки ещё нет: встреча идёт по ленте недели, как раньше. Руководитель может собрать повестку
  const [questions, stuck] = await Promise.all([
    meetingQuestions(actor, view.week.key, { current: view.entries.map((e) => e.id) }, audience.teamIds ?? []),
    stuckForMeeting(actor, audience.teamIds ?? []),
  ]);
  return (
    <>
      {projector ? null : <div className="mb-4">{weekNav}</div>}
      {numbersBlock}
      {notionBar}
      {single ? <BuildAgendaBanner team={single} week={view.week.key} canLead={canLead} /> : null}
      <MeetingMode key={view.week.key} view={view} questions={questions} stuck={stuck} />
    </>
  );
}
