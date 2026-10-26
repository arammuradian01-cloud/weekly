// Weekly сотрудников во вкладке «Полученные» (этап 73а, перенос в «Отчёт руководителю» по решению Арама 26.10):
// руководитель читает сданные weekly людей своей команды за неделю. Черновик виден только состоянием, без содержимого.

import Link from "next/link";
import type { teamInboxView } from "@/lib/weekly/team-inbox";
import { moscowMoment } from "@/lib/weekly/rules";
import { EntryItem } from "@/components/weekly/entry-item";
import { EmptyState } from "@/components/empty-state";
import { buttonClass } from "@/components/ui/button";

type Inbox = Awaited<ReturnType<typeof teamInboxView>>;

const done = (state: string) => state === "submitted" || state === "late";

export function TeamPeopleWeekly({ inbox, week }: { inbox: Inbox; week: string }) {
  const required = inbox.reports.filter((r) => !r.inactive && !r.optional && !r.absent);
  const submitted = required.filter((r) => done(r.state)).length;
  const absent = inbox.reports.filter((r) => !r.inactive && r.absent).length;
  const href = (team: string) => `/leader-report?tab=received&week=${week}&people=${encodeURIComponent(team)}`;
  return (
    <section aria-labelledby="lr-people-title" className="flex min-w-0 flex-col gap-4" data-testid="lr-people">
      <h2 id="lr-people-title" className="text-section font-semibold text-ink">
        Weekly сотрудников
      </h2>
      {inbox.teams.length > 1 ? (
        <nav aria-label="Команда для чтения weekly" className="flex flex-wrap gap-2">
          {inbox.teams.map((t) => (
            <Link
              key={t.id}
              href={href(t.id)}
              scroll={false}
              aria-current={inbox.team?.id === t.id ? "page" : undefined}
              className={buttonClass(inbox.team?.id === t.id ? "primary" : "secondary", "sm", "h-auto min-h-11 max-w-full whitespace-normal text-left")}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <p className="text-body" data-testid="team-submission-summary">
        Сдали {submitted} из {required.length}. Ждём: {required.length - submitted}. Отсутствуют: {absent}.
      </p>
      {inbox.reports.map((r) => (
        <details key={r.author} className="sv-card min-w-0" data-testid={`received-person-${r.author}`}>
          <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 break-words px-4 py-2 text-body">
            <span className="font-semibold">{r.name}</span>
            <span className="text-text-secondary">
              {done(r.state) ? (r.retro ? "сдан задним числом" : r.state === "late" ? "сдан с опозданием" : "сдан") : r.absent ? "отсутствует" : r.state === "draft" ? "черновик, ещё не сдан" : "не сдан"}
              {r.inactive ? ", доступ отключён" : r.optional ? ", по желанию" : ""}
            </span>
          </summary>
          <div className="px-4 pb-4">
            {done(r.state) ? (
              <div className="mt-2 flex min-w-0 flex-col gap-4">
                {r.submittedAt ? <p className="text-small text-muted">Сдан {moscowMoment(r.submittedAt)}</p> : null}
                <p className="break-words text-title font-semibold">{r.headline}</p>
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
              <p className="mt-2 text-body text-muted">{r.absent ? "На этой неделе weekly не ожидается." : r.optional ? "Этот сотрудник сдаёт weekly по желанию." : "После сдачи здесь появятся главное за неделю и записи сотрудника."}</p>
            )}
          </div>
        </details>
      ))}
      {!inbox.reports.length ? <EmptyState title="Weekly сотрудников за эту неделю нет">Проверьте состав команды и настройку «Кто сдаёт и срок» в карточке команды.</EmptyState> : null}
    </section>
  );
}
