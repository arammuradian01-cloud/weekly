// Вкладка «Полученные» раздела «Отчёт руководителю» (этап 73+81). Экран получателя сделал Codex на этапе 73а
// (PR #84, ветка etap-73a-otchet-moey-komandy): полученные сводные отчёты и сданные weekly своих сотрудников.
// Здесь он стал вкладкой, и к каждому полученному отчёту добавлено обсуждение с автором (решение Арама 01.11).

import Link from "next/link";
import { formatMoment } from "@/lib/week";
import { EmptyState } from "@/components/empty-state";
import { CeoSentReport } from "@/components/ceo/ceo-sent";
import { BlocksView } from "@/components/weekly-blocks/blocks-view";
import { EntryItem } from "@/components/weekly/entry-item";
import { buttonClass } from "@/components/ui/button";
import { visibleBlocks, type Labels } from "@/lib/weekly-blocks/types";
import { reportHref } from "@/lib/leader-report/rules";
import type { LeaderReportView } from "@/lib/leader-report/service";
import { ReportComments } from "./report-comments";

const stateText = (r: LeaderReportView["people"][number]) =>
  r.state === "late"
    ? "Сдан с опозданием"
    : r.state === "submitted"
      ? "Сдан"
      : r.absent
        ? "Отсутствует"
        : r.state === "draft"
          ? "Черновик, ещё не сдан"
          : "Не сдан";

export function ReceivedReportsView({ view, labels, order }: { view: LeaderReportView; labels: Labels; order: string[] }) {
  const done = (state: string) => state === "submitted" || state === "late";
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="received-reports-title" className="flex min-w-0 flex-col gap-4">
        <h2 id="received-reports-title" className="text-section font-semibold text-ink">
          Полученные отчёты за неделю {view.number}
        </h2>
        {view.received.length ? (
          <p className="text-body text-muted">Здесь отправленная вам версия: она хранится отдельно от того, что автор поправил позже. Доступ к цифрам такой же, как в остальных разделах.</p>
        ) : null}
        {view.received.map(({ report, comments }) => (
          <article key={`${report.teamId}:${report.week}`} className="sv-card flex min-w-0 flex-col gap-4 p-4 sm:p-5" data-testid="received-report">
            <div className="min-w-0">
              <h3 className="break-words text-title font-semibold text-ink">
                {report.kind === "ceo" ? `Отчёт CEO: команда «${report.teamName}»` : `Отчёт команды «${report.teamName}»`}
              </h3>
              <p className="mt-1 text-body text-muted">
                Получен {formatMoment(new Date(report.at))}
                {report.by ? `, отправил ${report.by}` : ""}.
              </p>
              {report.editedAfter ? <p className="mt-1 text-small text-muted">После отправки автор внёс правки: здесь версия, которую вам отправили.</p> : null}
            </div>
            {report.kind === "ceo" && view.ceo ? (
              <CeoSentReport view={view.ceo} showWeeks={false} />
            ) : visibleBlocks(report.blocks).length ? (
              <BlocksView blocks={report.blocks} labels={labels} order={order} idPrefix={`received-${report.teamId}`} />
            ) : (
              <p className="text-body text-muted">Отправленная версия без блоков: отчёт уходил в прежнем виде.</p>
            )}
            {report.kind === "team" ? (
              <div>
                <Link href={`/weekly/team-report?team=${encodeURIComponent(report.teamId)}&week=${report.week}`} className={buttonClass("secondary", "sm")}>
                  Открыть отчёт команды
                </Link>
              </div>
            ) : null}
            <ReportComments teamId={report.teamId} week={report.week} teamName={report.teamName} blocks={report.blocks} initial={comments} />
          </article>
        ))}
        {!view.received.length ? (
          <EmptyState title={`За неделю ${view.number} отчёты ещё не получены`}>
            Когда руководитель команды ниже отправит вам сводный отчёт, он появится здесь. Отчёты прошлых недель открываются переключателем недели.
          </EmptyState>
        ) : null}
      </section>

      {view.teams.length ? (
        <section aria-labelledby="received-people-title" className="flex min-w-0 flex-col gap-4">
          <h2 id="received-people-title" className="text-section font-semibold text-ink">
            Weekly сотрудников
          </h2>
          {view.teams.length > 1 ? (
            <nav aria-label="Команда для чтения weekly" className="flex flex-wrap gap-2">
              {view.teams.map((t) => (
                <Link
                  key={t.id}
                  href={reportHref("received", { week: view.key, team: t.id })}
                  aria-current={view.team?.id === t.id ? "page" : undefined}
                  className={buttonClass(view.team?.id === t.id ? "primary" : "secondary", "sm", "h-auto min-h-11 max-w-full whitespace-normal text-left")}
                >
                  {t.name}
                </Link>
              ))}
            </nav>
          ) : null}
          <p className="text-body" data-testid="team-submission-summary">
            Сдали {view.expected.submitted} из {view.expected.required}. Ждём: {view.expected.required - view.expected.submitted}. Отсутствуют: {view.expected.absent}.
          </p>
          <p className="text-small text-muted">Weekly сотрудника видно здесь после сдачи. Правки до закрытия недели обновляют его личный weekly.</p>
          {view.people.map((r) => (
            <details key={r.author} className="sv-card min-w-0 p-4" data-testid={`received-person-${r.author}`}>
              <summary className="cursor-pointer break-words text-body">
                <span className="font-semibold">{r.name}</span>
                {" — "}
                {stateText(r)}
                {r.inactive ? " · Доступ отключён" : r.optional ? " · По желанию" : ""}
              </summary>
              {done(r.state) ? (
                <div className="mt-4 flex min-w-0 flex-col gap-4">
                  {r.submittedAt ? <p className="text-small text-muted">Сдан {formatMoment(new Date(r.submittedAt))}</p> : null}
                  <p className="break-words text-title font-semibold text-ink">{r.headline}</p>
                  {r.entries.map((e) => {
                    const note = e.promoted?.find((p) => p.by === r.author)?.note;
                    return (
                      <div key={e.id} className="flex min-w-0 flex-col gap-2">
                        <EntryItem entry={e} compact showAuthor={e.author !== r.author} />
                        {note ? (
                          <p className="whitespace-pre-wrap break-words text-body">
                            <span className="text-muted">От себя: </span>
                            {note}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {r.thanks ? <p className="whitespace-pre-wrap break-words text-body">Благодарности: {r.thanks}</p> : null}
                </div>
              ) : (
                <p className="mt-3 text-body text-muted">
                  {r.absent ? "На этой неделе weekly не ожидается." : r.optional ? "Этот сотрудник сдаёт weekly по желанию." : "После сдачи здесь появятся главное за неделю и записи сотрудника."}
                </p>
              )}
            </details>
          ))}
          {!view.people.length ? (
            <EmptyState title="В команде пока нет weekly сотрудников">Проверьте состав команды и настройку «Кто сдаёт и срок» в её карточке.</EmptyState>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
