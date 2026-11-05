// Вкладка «Отправленные» раздела «Отчёт руководителю» (этап 73+81): ровно та версия отчёта, которая ушла руководителю,
// кому и когда, пометка «после отправки отчёт правили» и обсуждение с руководителем. Правят отчёт там, где его
// собирают: «Отчёт CEO» у топ-команды и «Weekly команды» у остальных, поэтому здесь только чтение и ответы в ветке.

import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { BlocksView } from "@/components/weekly-blocks/blocks-view";
import { buttonClass } from "@/components/ui/button";
import { visibleBlocks, type Labels } from "@/lib/weekly-blocks/types";
import type { LeaderReportView } from "@/lib/leader-report/service";
import { ReportComments } from "./report-comments";

const moment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");

export function SentReportsView({ view, labels, order }: { view: LeaderReportView; labels: Labels; order: string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {view.sent.map(({ report, comments }) => (
        <article key={`${report.teamId}:${report.week}`} className="sv-card flex min-w-0 flex-col gap-4 p-4 sm:p-5" data-testid="sent-report">
          <div className="min-w-0">
            <h3 className="break-words text-title font-semibold text-ink">
              {report.kind === "ceo" ? `Отчёт CEO: команда «${report.teamName}»` : `Отчёт команды «${report.teamName}»`}
            </h3>
            <p className="mt-1 text-body text-muted">
              Отправлен {moment(report.at)}
              {report.by ? `, отправил ${report.by}` : ""}. Получатель: {report.to.map((t) => t.name).join(", ") || "не указан"}.
            </p>
            {report.editedAfter ? <p className="mt-1 text-small text-muted">После отправки отчёт правили в приложении: здесь отправленная версия.</p> : null}
            {/* Отправленный отчёт остаётся историей и после расформирования команды */}
            {!report.teamActive ? <p className="mt-1 text-small text-muted">Команда расформирована: отчёт и обсуждение остаются здесь.</p> : null}
          </div>
          {visibleBlocks(report.blocks).length ? (
            <BlocksView blocks={report.blocks} labels={labels} order={order} idPrefix={`sent-${report.teamId}`} />
          ) : (
            <p className="text-body text-muted">Отправленная версия без блоков: отчёт уходил в прежнем виде, его видно на странице отчёта.</p>
          )}
          <ReportComments teamId={report.teamId} week={report.week} teamName={report.teamName} blocks={report.blocks} initial={comments} />
        </article>
      ))}
      {!view.sent.length ? (
        <EmptyState title={`За неделю ${view.number} вы отчёт руководителю не отправляли`}>
          {view.canLead
            ? "Соберите отчёт своей команды и отправьте его: отправленная версия и ответы руководителя появятся здесь."
            : "Здесь появятся отчёты, которые вы отправите своему руководителю."}
        </EmptyState>
      ) : null}
      {view.drafts.length ? (
        <section aria-labelledby="leader-report-drafts" className="flex min-w-0 flex-col gap-2">
          <h3 id="leader-report-drafts" className="text-section font-semibold text-ink">
            Собрать отчёт за неделю {view.number}
          </h3>
          <p className="text-small text-muted">Отчёт собирают и отправляют там, где он живёт: у команды страхования и инвестиций это «Отчёт CEO», у остальных «Weekly команды».</p>
          <div className="flex flex-wrap gap-2">
            {view.drafts.map((d) => (
              <Link key={d.teamId} href={d.href} className={buttonClass("secondary", "sm", "h-auto min-h-11 max-w-full whitespace-normal text-left")}>
                {d.teamName}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
