import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { TaskRuleError } from "@/lib/tasks/service";
import { TOP_TEAM } from "@/domain/teams";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { currentReportingKey } from "@/lib/weekly/service";
import { isWeekKey, shiftWeek, weekNumberOf } from "@/lib/weekly/weeks";
import { canLeadReport, expectedRecipientName, hasReceived, isRecipientOf, leaderReportVisible, receivedWeek, reportTeams, sentArchive, sentReportView } from "@/lib/leader-report/service";
import { defaultTab, isReportTab, type ReportTab } from "@/lib/leader-report/rules";
import { teamReportView, teamTemplateView, type TeamReportView, type TeamTemplateView } from "@/lib/weekly-blocks/team";
import { teamInboxView } from "@/lib/weekly/team-inbox";
import { moscowMoment } from "@/lib/weekly/rules";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/data";
import { EmptyState } from "@/components/empty-state";
import { buttonClass } from "@/components/ui/button";
import { TeamReportScreen } from "@/components/weekly-blocks/team-report";
import { SentReportScreen } from "@/components/leader-report/sent-report";
import { ReportTeamPicker } from "@/components/leader-report/team-picker";
import { TeamPeopleWeekly } from "@/components/leader-report/people-weekly";
import { TopReportCurrent } from "./top-current";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Отчёт руководителю" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type Params = { team?: string | string[]; week?: string | string[]; tab?: string | string[]; people?: string | string[] };

/**
 * Отчёт руководителю (этап 73). Решение Арама 23.10: вместо отчёта CEO каждый руководитель делает weekly для своего
 * руководителя. Вкладки: «Текущая неделя» (черновик по блокам и отправка), «Отправленные» (ровно то, что ушло, с
 * комментариями руководителя), «Полученные» (отчёты подчинённых руководителей по неделям и weekly сотрудников, решение
 * Арама 26.10). Неделя без адреса: отчётная
 */
export default async function LeaderReportPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireContext();
  const actor = await currentActor();
  const params = await searchParams;
  const reporting = await currentReportingKey();
  const wantedWeek = one(params.week);
  const week = isWeekKey(wantedWeek) && wantedWeek <= reporting ? wantedWeek : reporting;
  const weekInUrl = isWeekKey(wantedWeek) ? wantedWeek : null;
  const [teams, visible, received] = await Promise.all([reportTeams(actor), leaderReportVisible(actor), hasReceived(actor)]);
  const header = <PageHeader title="Отчёт руководителю" description="Weekly для своего руководителя: собрать и отправить отчёт команды, посмотреть отправленные и полученные отчёты с комментариями" />;
  if (!visible && !teams.length && !received) {
    return (
      <>
        {header}
        <EmptyState title="Раздел для руководителей команд">
          {actor.via === "TEAM" ? "Отчёты руководителю видны при личном входе: войдите по своей ссылке." : "Здесь руководители команд собирают отчёт своему руководителю и читают отчёты, которые прислали им. Вы пока не руководите командой и отчётов не получали."}
        </EmptyState>
      </>
    );
  }

  // Команда: из адреса, иначе выбранная в шапке, если отчёт её ведёте, иначе первая своя
  const wantedTeam = one(params.team);
  const current = await currentTeam(subjectOf(ctx));
  const fromHeader = current.id && current.id !== ALL_TEAMS && teams.some((t) => t.id === current.id) ? current.id : null;
  const teamId = wantedTeam && /^[\w-]{1,64}$/.test(wantedTeam) ? wantedTeam : (fromHeader ?? teams.find((t) => t.note === "вы руководитель")?.id ?? teams[0]?.id ?? null);
  const canLead = teamId ? await canLeadReport(actor, teamId) : false;
  const recipient = wantedTeam && teamId ? await isRecipientOf(actor, teamId, weekInUrl) : false;
  const tabParam = one(params.tab);
  const tab: ReportTab = isReportTab(tabParam) ? tabParam : defaultTab({ canLead, recipient, hasReceived: received });

  const href = (t: ReportTab, extra: Record<string, string | null> = {}) => {
    const q = new URLSearchParams({ tab: t });
    if (teamId && t !== "received") q.set("team", teamId);
    if (weekInUrl) q.set("week", weekInUrl);
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/leader-report?${q.toString()}`;
  };
  const tabs = [
    ...(teams.length ? [{ href: href("current"), label: "Текущая неделя", active: tab === "current", testId: "lr-tab-current" }] : []),
    ...(teams.length ? [{ href: href("sent"), label: "Отправленные", active: tab === "sent", testId: "lr-tab-sent" }] : []),
    { href: href("received", { team: null }), label: "Полученные", active: tab === "received", testId: "lr-tab-received" },
  ];

  const body =
    tab === "received" ? (
      <ReceivedTab actor={actor} week={week} team={wantedTeam ?? null} people={one(params.people) ?? null} />
    ) : !teamId ? (
      <EmptyState title="Нет команды">Отчёт руководителю ведут руководители команд. Полученные отчёты на вкладке «Полученные».</EmptyState>
    ) : tab === "sent" ? (
      <SentTab actor={actor} teamId={teamId} week={weekInUrl} />
    ) : (
      <CurrentTab actor={actor} teamId={teamId} week={week} canLead={canLead} reporting={reporting} />
    );

  return (
    <>
      <PageHeader
        title="Отчёт руководителю"
        description="Weekly для своего руководителя: собрать и отправить отчёт команды, посмотреть отправленные и полученные отчёты с комментариями"
        tabs={<PageTabs label="Разделы отчёта руководителю" tabs={tabs} />}
      />
      {tab !== "received" && teams.length > 1 ? <ReportTeamPicker teams={teams} current={teamId} tab={tab} week={weekInUrl} /> : null}
      {body}
    </>
  );
}

async function CurrentTab({ actor, teamId, week, canLead, reporting }: { actor: Awaited<ReturnType<typeof currentActor>>; teamId: string; week: string; canLead: boolean; reporting: string }) {
  if (teamId === TOP_TEAM) {
    if (!canLead) return <EmptyState title="Отчёт этой команды ведёт её руководитель">Отчёт руководителю команды страхования и инвестиций ведут её руководитель при личном входе, владелец и администраторы в режиме управления.</EmptyState>;
    return <TopReportCurrent actor={actor} week={week} />;
  }
  let view: TeamReportView;
  let template: TeamTemplateView | null;
  try {
    [view, template] = await Promise.all([teamReportView(actor, teamId, week, { current: true }), teamTemplateView(actor, teamId).catch(() => null)]);
  } catch (error) {
    if (!(error instanceof TaskRuleError)) throw error;
    return <EmptyState title="Отчёт команды недоступен">{error.message}</EmptyState>;
  }
  const recipient = view.recipients.length ? null : await expectedRecipientName(teamId);
  const prev = shiftWeek(week, -1);
  const next = shiftWeek(week, 1);
  const link = (w: string) => `/leader-report?tab=current&team=${encodeURIComponent(view.team.id)}&week=${w}`;
  return (
    <>
      <nav aria-label="Неделя отчёта" className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={link(prev)} className={buttonClass("secondary", "sm", "min-h-11 sm:min-h-0")} aria-label="Предыдущая неделя">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Неделя {weekNumberOf(prev)}
        </Link>
        <span className="px-2 text-body font-semibold text-ink">
          Неделя {view.weekNumber}
          {week === reporting ? <span className="font-normal text-text-secondary">, отчётная</span> : null}
        </span>
        {next <= reporting ? (
          <Link href={link(next)} className={buttonClass("secondary", "sm", "min-h-11 sm:min-h-0")} aria-label="Следующая неделя">
            Неделя {weekNumberOf(next)}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </nav>
      {!canLead && view.mode === "sent" ? null : recipient ? <p className="mb-3 text-small text-muted">Получатель по структуре: {recipient}</p> : null}
      <TeamReportScreen key={`${view.team.id}:${view.week}:${view.mode}:${view.template?.map((b) => b.key).join(",") ?? "-"}`} view={view} template={template} collapsible />
    </>
  );
}

async function SentTab({ actor, teamId, week }: { actor: Awaited<ReturnType<typeof currentActor>>; teamId: string; week: string | null }) {
  let archive: Awaited<ReturnType<typeof sentArchive>>;
  try {
    archive = await sentArchive(actor, teamId);
  } catch (error) {
    if (!(error instanceof TaskRuleError)) throw error;
    return <EmptyState title="Отправленные недоступны">{error.message}</EmptyState>;
  }
  if (!archive.length) return <EmptyState title="Отчётов ещё не отправляли">Когда вы отправите отчёт руководителю, здесь останется ровно тот текст, что ушёл, с датой, временем и получателем.</EmptyState>;
  const pick = archive.find((a) => a.week === week) ?? archive[0]!;
  const view = await sentReportView(actor, teamId, pick.week);
  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-8">
      <nav aria-label="Отправленные недели" className="flex min-w-0 flex-col gap-1" data-testid="lr-archive">
        <p className="mb-1 text-caption font-semibold text-muted">Отправленные недели</p>
        <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 lg:flex-col lg:overflow-visible">
          {archive.map((a) => (
            <li key={a.week} className="flex-none lg:flex-auto">
              <Link
                href={`/leader-report?tab=sent&team=${encodeURIComponent(teamId)}&week=${a.week}`}
                aria-current={a.week === pick.week ? "page" : undefined}
                className={cn("flex min-h-11 flex-col justify-center rounded-lg px-3 py-2 text-small", a.week === pick.week ? "bg-accent-soft font-semibold text-link" : "text-ink hover:bg-field")}
              >
                <span>
                  Неделя {a.number}
                  {a.comments ? <span className="font-normal text-text-secondary">, комментариев: {a.comments}</span> : null}
                </span>
                <span className="text-caption font-normal text-text-secondary">
                  {moscowMoment(a.sentAt)}
                  {a.to.length ? `, ${a.to.join(", ")}` : ""}
                  {a.editedAfter ? ", правили после отправки" : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {view ? <SentReportScreen key={`${teamId}:${view.week}`} initial={view} mode="sent" /> : null}
    </div>
  );
}

async function ReceivedTab({ actor, week, team, people }: { actor: Awaited<ReturnType<typeof currentActor>>; week: string; team: string | null; people: string | null }) {
  const data = await receivedWeek(actor, week);
  const link = (w: string, t: string | null = null) => `/leader-report?tab=received&week=${w}${t ? `&team=${encodeURIComponent(t)}` : ""}`;
  let selected: Awaited<ReturnType<typeof sentReportView>> = null;
  let error: string | null = null;
  if (team) {
    try {
      selected = await sentReportView(actor, team, data.week);
    } catch (e) {
      if (!(e instanceof TaskRuleError)) throw e;
      error = e.message;
    }
  }
  let inbox: Awaited<ReturnType<typeof teamInboxView>> | null = null;
  try {
    inbox = await teamInboxView(actor, data.week, people ?? undefined);
  } catch (e) {
    if (!(e instanceof TaskRuleError)) throw e;
  }
  const sentCount = data.items.filter((i) => i.sentAt).length;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <nav aria-label="Неделя полученных отчётов" className="flex flex-wrap items-center gap-2">
        {data.prev ? (
          <Link href={link(data.prev)} className={buttonClass("secondary", "sm", "min-h-11 sm:min-h-0")} aria-label="Предыдущая неделя">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Неделя {weekNumberOf(data.prev)}
          </Link>
        ) : null}
        <span className="px-2 text-body font-semibold text-ink">
          Неделя {data.number}
          {data.week === data.reporting ? <span className="font-normal text-text-secondary">, отчётная</span> : null}
        </span>
        {data.next ? (
          <Link href={link(data.next)} className={buttonClass("secondary", "sm", "min-h-11 sm:min-h-0")} aria-label="Следующая неделя">
            Неделя {weekNumberOf(data.next)}
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
        {data.week !== data.reporting ? (
          <Link href={link(data.reporting)} className={buttonClass("ghost", "sm", "min-h-11 sm:min-h-0")}>
            Перейти к отчётной неделе
          </Link>
        ) : null}
      </nav>

      <section aria-labelledby="lr-received-title" className="flex min-w-0 flex-col gap-3" data-testid="lr-received">
        <h2 id="lr-received-title" className="text-section font-semibold text-ink">
          Отчёты руководителей <span className="font-normal text-muted">{data.items.length ? `отправили ${sentCount} из ${data.items.length}` : ""}</span>
        </h2>
        {data.items.length ? (
          <ul className="m-0 flex list-none flex-col divide-y divide-line sv-card sv-card--soft p-0">
            {data.items.map((i) => (
              <li key={i.team.id} className={cn("flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4", team === i.team.id && "bg-accent-soft")} data-testid={`lr-received-${i.team.id}`}>
                <div className="min-w-0">
                  <p className="break-words text-body font-semibold text-ink">{i.team.name}</p>
                  <p className="text-small text-text-secondary">
                    {i.leader ?? "Руководитель не назначен"}
                    {i.sentAt ? `. Отправлен ${moscowMoment(i.sentAt)}${i.editedAfter ? ", после отправки правили" : ""}${i.comments ? `, комментариев: ${i.comments}` : ""}` : ". Ещё не отправлен"}
                  </p>
                </div>
                {i.sentAt ? (
                  <Link href={link(data.week, i.team.id)} className={buttonClass(team === i.team.id ? "primary" : "secondary", "sm", "min-h-11 shrink-0 sm:min-h-0")} aria-current={team === i.team.id ? "page" : undefined}>
                    {team === i.team.id ? "Открыт" : "Открыть отчёт"}
                  </Link>
                ) : (
                  <span className="text-small font-medium text-warning-ink">Не отправлен</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Отчётов за эту неделю нет">Когда руководитель команды ниже отправит вам отчёт, он появится здесь, а в «Мне» придёт событие.</EmptyState>
        )}
        {error ? <p className="text-body text-danger-ink" role="alert">{error}</p> : null}
        {team && !selected && !error ? <p className="text-body text-muted">Отчёт этой команды за неделю {data.number} ещё не отправлен.</p> : null}
        {selected ? <SentReportScreen key={`${selected.team.id}:${selected.week}`} initial={selected} mode="received" /> : null}
      </section>

      {inbox && inbox.teams.length ? <TeamPeopleWeekly inbox={inbox} week={data.week} /> : null}
    </div>
  );
}
