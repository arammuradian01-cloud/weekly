"use client";

import Link from "next/link";
import { usePrototype } from "@/domain/store";
import { personOf, positionOf } from "@/domain/people";
import { TOP_TEAM } from "@/domain/teams";
import { isClosedThisWeek, isOverdue, isStale } from "@/domain/rules";
import type { Person, PersonWeekly, Task } from "@/domain/types";
import { AbsentBadge, substituteText } from "@/components/weekly/absence";
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/cn";
import { WeeklyBadge } from "@/components/ui/task-badges";
import { Figures } from "@/components/ui/data";

type Row = {
  person: Person;
  total: number;
  inWork: number;
  overdue: number;
  risk: number;
  closedWeek: number;
  stale: number;
};

/** Сводка по каждому, как сводка по лидерам над таблицей задач сейчас (раздел 4 ТЗ) */
export function TeamSummary({ reports, weekNumber }: { reports: PersonWeekly[]; weekNumber: number }) {
  const { data, me, teamPeople } = usePrototype();
  // Выключенные с открытыми задачами остаются в сводке, пока их задачи не передали другим
  const gone = [...new Set(data.teamTasks.filter((t) => t.owner !== "all" && !t.archived && (t.status === "in-progress" || t.status === "clarify") && !teamPeople.some((p) => p.slug === t.owner)).map((t) => t.owner))].map(personOf);
  const rows: Row[] = [...teamPeople, ...gone].map((p) => {
    const own = data.teamTasks.filter((t: Task) => t.owner === p.slug && !t.archived);
    const open = own.filter((t) => t.status === "in-progress" || t.status === "clarify");
    return {
      person: p,
      total: own.length,
      inWork: open.length,
      overdue: own.filter((t) => isOverdue(t, data.today)).length,
      risk: open.filter((t) => t.state === "at-risk" || t.state === "blocked").length,
      closedWeek: own.filter((t) => isClosedThisWeek(t, data.today)).length,
      stale: own.filter((t) => isStale(t, data.today)).length,
    };
  });
  const shared = data.teamTasks.filter((t) => t.owner === "all" && (t.status === "in-progress" || t.status === "clarify")).length;
  const totals = rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, inWork: acc.inWork + r.inWork, overdue: acc.overdue + r.overdue, risk: acc.risk + r.risk, closedWeek: acc.closedWeek + r.closedWeek, stale: acc.stale + r.stale }),
    { total: 0, inWork: 0, overdue: 0, risk: 0, closedWeek: 0, stale: 0 },
  );

  const num = (n: number, alert?: boolean) => <span className={cn("tabular-nums", alert && n > 0 ? "font-semibold text-danger-ink" : n === 0 ? "text-muted" : "text-ink")}>{n}</span>;
  const expected = reports.filter((w) => !w.optional);
  const submitted = expected.filter((w) => w.state === "submitted" || w.state === "late").length;
  const absentNow = (w: PersonWeekly | undefined) => !!w?.absent && w.state !== "submitted" && w.state !== "late";

  // Этап 36: ключевые цифры команды плитками и одна таблица на ноутбуке и телефоне (на телефоне строки карточками)
  return (
    <div className="flex flex-col gap-4">
      <Figures
        label="Команда в цифрах"
        items={[
          { label: "В работе", value: totals.inWork, href: "/tasks", testId: "team-fig-work" },
          { label: "Просрочено", value: totals.overdue, href: "/tasks?f=overdue", tone: "danger", testId: "team-fig-overdue" },
          { label: "С риском", value: totals.risk, tone: "warning", testId: "team-fig-risk" },
          { label: "Закрыто за неделю", value: totals.closedWeek, testId: "team-fig-closed" },
          { label: "Давно без обновлений", value: totals.stale, href: "/tasks?f=stale", tone: "warning", testId: "team-fig-stale" },
          { label: `Weekly за неделю ${weekNumber}`, value: `${submitted} из ${expected.length}`, href: "/weekly", testId: "team-fig-weekly" },
        ]}
      />
      <div className="sv-card sv-card--soft overflow-x-auto p-0">
        <table className="sv-datatable sv-datatable--stack" data-testid="team-summary">
          <caption className="sr-only">Задачи и weekly по каждому</caption>
          <thead>
            <tr>
              <th scope="col">Человек</th>
              <th scope="col" className="is-num">Всего</th>
              <th scope="col" className="is-num">В работе</th>
              <th scope="col" className="is-num">Просрочено</th>
              <th scope="col" className="is-num">С риском</th>
              <th scope="col" className="is-num">Закрыто за неделю</th>
              <th scope="col" className="is-num">Давно не обновлялись</th>
              <th scope="col">Weekly за неделю {weekNumber}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const weekly = reports.find((w) => w.author === r.person.slug);
              return (
                <tr key={r.person.slug}>
                  <td className="is-wide">
                    <Link href={`/tasks/review?person=${r.person.slug}`} className="font-semibold text-ink hover:text-blue-700 hover:underline">
                      {r.person.fullName}
                    </Link>
                    {r.person.slug === me.slug ? <span className="ml-2 text-caption text-muted">это вы</span> : null}
                    <span className="block text-caption text-muted">
                      {positionOf(r.person.slug) ? `${positionOf(r.person.slug)}, ${r.person.zone}` : `${ROLE_LABELS[r.person.role]}, ${r.person.zone}`}
                    </span>
                  </td>
                  <td className="is-num" data-label="Всего">{num(r.total)}</td>
                  <td className="is-num" data-label="В работе">{num(r.inWork)}</td>
                  <td className="is-num" data-label="Просрочено">{num(r.overdue, true)}</td>
                  <td className="is-num" data-label="С риском">{num(r.risk, true)}</td>
                  <td className="is-num" data-label="Закрыто">{num(r.closedWeek)}</td>
                  <td className="is-num" data-label="Без обновлений">{num(r.stale, true)}</td>
                  <td data-label={`Weekly ${weekNumber}`}>
                    {absentNow(weekly) ? (
                      <>
                        <AbsentBadge />
                        <span className="mt-1 block text-caption text-muted">{substituteText(weekly!.absent!.substitute)}</span>
                      </>
                    ) : (
                      <WeeklyOrAbove weekly={weekly} />
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="sv-datatable__row--total">
              <th scope="row" className="is-wide text-left">Вся команда</th>
              <td className="is-num" data-label="Всего">{totals.total}</td>
              <td className="is-num" data-label="В работе">{totals.inWork}</td>
              <td className="is-num" data-label="Просрочено"><span className={cn(totals.overdue > 0 && "text-danger-ink")}>{totals.overdue}</span></td>
              <td className="is-num" data-label="С риском">{totals.risk}</td>
              <td className="is-num" data-label="Закрыто">{totals.closedWeek}</td>
              <td className="is-num" data-label="Без обновлений">{totals.stale}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-small text-muted">
        {data.team === TOP_TEAM ? `Общих задач для всех лидеров в работе: ${shared}. ` : ""}Имя открывает разбор задач человека.
      </p>
    </div>
  );
}

/** Weekly руководителя команды сдаётся в команду выше: его подчинённым он не показывается (этап 14) */
function WeeklyOrAbove({ weekly }: { weekly: PersonWeekly | undefined }) {
  if (!weekly) return <span className="text-small text-muted">сдаёт в команду выше</span>;
  // Специалист, от кого weekly не ждут (этап 15): пока не начал, это не долг
  if (weekly.optional && weekly.state === "not-started") return <span className="text-small text-muted">weekly по желанию</span>;
  return <WeeklyBadge state={weekly.state} />;
}
