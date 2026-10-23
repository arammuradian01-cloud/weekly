import type { Metadata } from "next";
import Link from "next/link";
import { currentActor } from "@/lib/action-runner";
import { TaskRuleError } from "@/lib/tasks/service";
import { teamInboxView } from "@/lib/weekly/team-inbox";
import { shiftWeek, weekNumberOf, weekEndOf } from "@/lib/weekly/weeks";
import { formatLong } from "@/domain/dates";
import { formatMoment } from "@/lib/week";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { CeoSentReport } from "@/components/ceo/ceo-sent";
import { EntryItem } from "@/components/weekly/entry-item";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Отчёт по моей команде" };

export default async function ReceivedWeeklyPage({ searchParams }: { searchParams: Promise<{ week?: string; team?: string }> }) {
  const params = await searchParams;
  let view: Awaited<ReturnType<typeof teamInboxView>>;
  try {
    view = await teamInboxView(await currentActor(), typeof params.week === "string" ? params.week : undefined, typeof params.team === "string" ? params.team : undefined);
  } catch (error) {
    if (!(error instanceof TaskRuleError)) throw error;
    return <><PageHeader title="Отчёт по моей команде" /><EmptyState title="Отчёты недоступны">{error.message}</EmptyState></>;
  }
  const href = (week: string, team = view.team?.id) => `/weekly/received?week=${week}${team ? `&team=${encodeURIComponent(team)}` : ""}`;
  const required = view.reports.filter((r) => !r.optional && !r.absent);
  const done = (state: string) => state === "submitted" || state === "late";
  const submitted = required.filter((r) => done(r.state)).length;
  const next = shiftWeek(view.key, 1);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="Отчёт по моей команде" description="Полученные сводные отчёты и weekly ваших сотрудников. Здесь вы читаете итоги, которые вам сдали." />
      <nav aria-label="Неделя входящих отчётов" className="flex flex-wrap items-center gap-2">
        <Link href={href(shiftWeek(view.key, -1))} className={buttonClass("secondary", "sm")}>Предыдущая неделя</Link>
        <span className="text-body font-semibold">Неделя {weekNumberOf(view.key)}: {formatLong(view.key)} — {formatLong(weekEndOf(view.key))}</span>
        {next <= view.reporting ? <Link href={href(next)} className={buttonClass("secondary", "sm")}>Следующая неделя</Link> : null}
        {view.key !== view.reporting ? <Link href={href(view.reporting)} className={buttonClass("ghost", "sm")}>Отчётная неделя</Link> : null}
      </nav>

      <section aria-labelledby="received-summary-title" className="flex min-w-0 flex-col gap-4">
        <h2 id="received-summary-title" className="text-section font-semibold">Полученные сводные отчёты</h2>
        <p className="text-body text-muted">Отправленная вам версия сохраняется отдельно от последующих правок автора. Доступ к цифрам остаётся таким же, как в остальных разделах.</p>
        {view.ceo ? <CeoSentReport view={view.ceo} showWeeks={false} /> : null}
        {view.received.map((r) => <article key={r.id} className="sv-card flex flex-col items-start gap-3 p-4" data-testid="received-team-report">
          <h3 className="break-words text-title font-semibold">{r.team.name}</h3>
          <p className="text-body">{r.by ? `Отправил: ${r.by}. ` : ""}Получен {formatMoment(new Date(r.at))}.</p>
          {r.editedAfter ? <p className="text-small text-muted">После отправки автор внёс правки. По ссылке — отправленная вам версия.</p> : null}
          <Link href={`/weekly/team-report?team=${encodeURIComponent(r.team.id)}&week=${view.key}`} className={buttonClass("secondary", "sm")}>Читать отчёт команды</Link>
        </article>)}
        {!view.ceo && !view.received.length ? <EmptyState title="За эту неделю отчёты ещё не получены">Когда руководитель отправит вам сводный отчёт, он появится здесь. Отчёты прошлых недель доступны через переключатель недели.</EmptyState> : null}
      </section>

      {view.teams.length ? <section aria-labelledby="received-people-title" className="flex min-w-0 flex-col gap-4">
        <h2 id="received-people-title" className="text-section font-semibold">Weekly сотрудников</h2>
        <nav aria-label="Команда для чтения weekly" className="flex flex-wrap gap-2">
          {view.teams.map((t) => <Link key={t.id} href={href(view.key, t.id)} aria-current={view.team?.id === t.id ? "page" : undefined} className={buttonClass(view.team?.id === t.id ? "primary" : "secondary", "sm", "h-auto min-h-11 max-w-full whitespace-normal text-left")}>{t.name}</Link>)}
        </nav>
        <p className="text-body" data-testid="team-submission-summary">Сдали {submitted} из {required.length}. Ждём: {required.length - submitted}. Отсутствуют: {view.reports.filter((r) => r.absent).length}.</p>
        <p className="text-small text-muted">Отчёты сотрудников доступны здесь после сдачи. Правки до закрытия недели обновляют личный weekly.</p>
        {view.reports.map((r) => <details key={r.author} className="sv-card min-w-0 p-4" data-testid={`received-person-${r.author}`}>
          <summary className="cursor-pointer break-words text-body">
            <span className="font-semibold">{r.name}</span>{" — "}{done(r.state) ? (r.state === "late" ? "Сдан с опозданием" : "Сдан") : r.absent ? "Отсутствует" : r.state === "draft" ? "Черновик, ещё не сдан" : "Не сдан"}{r.optional ? " · По желанию" : ""}
          </summary>
          {done(r.state) ? <div className="mt-4 flex min-w-0 flex-col gap-4">
            {r.submittedAt ? <p className="text-small text-muted">Сдан {formatMoment(new Date(r.submittedAt))}</p> : null}
            <p className="break-words text-title font-semibold">{r.headline}</p>
            {r.entries.map((e) => <EntryItem key={e.id} entry={e} compact showAuthor={e.author !== r.author} />)}
            {r.thanks ? <p className="whitespace-pre-wrap break-words text-body">Благодарности: {r.thanks}</p> : null}
          </div> : <p className="mt-3 text-body text-muted">{r.absent ? "На этой неделе weekly не ожидается." : r.optional ? "Этот сотрудник сдаёт weekly по желанию." : "После сдачи здесь появятся главное за неделю и записи сотрудника."}</p>}
        </details>)}
        {!view.reports.length ? <EmptyState title="В команде пока нет weekly сотрудников">Проверьте состав и настройку «Кто сдаёт и срок» в карточке команды.</EmptyState> : null}
      </section> : null}
    </div>
  );
}
