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

  return (
    <>
      <div className="overflow-hidden rounded-xl ring-1 ring-line">
        <table className="hidden w-full text-left text-body md:table">
          <caption className="sr-only">Задачи и weekly по каждому</caption>
          <thead className="bg-surface text-caption text-muted">
            <tr>
              <th scope="col" className="px-5 py-3 font-medium">Человек</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Всего</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">В работе</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Просрочено</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">С риском</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Закрыто за неделю</th>
              <th scope="col" className="px-3 py-3 text-right font-medium">Давно не обновлялись</th>
              <th scope="col" className="px-5 py-3 font-medium">Weekly за неделю {weekNumber}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const weekly = reports.find((w) => w.author === r.person.slug);
              return (
                <tr key={r.person.slug} className="hover:bg-surface/60">
                  <td className="px-5 py-3">
                    <Link href={`/tasks/review?person=${r.person.slug}`} className="font-semibold text-ink hover:text-blue-700 hover:underline">
                      {r.person.fullName}
                    </Link>
                    {r.person.slug === me.slug ? <span className="ml-2 text-caption text-muted">это вы</span> : null}
                    <p className="text-caption text-muted">
                      {positionOf(r.person.slug) ? `${positionOf(r.person.slug)}, ${r.person.zone}` : `${ROLE_LABELS[r.person.role]}, ${r.person.zone}`}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right">{num(r.total)}</td>
                  <td className="px-3 py-3 text-right">{num(r.inWork)}</td>
                  <td className="px-3 py-3 text-right">{num(r.overdue, true)}</td>
                  <td className="px-3 py-3 text-right">{num(r.risk, true)}</td>
                  <td className="px-3 py-3 text-right">{num(r.closedWeek)}</td>
                  <td className="px-3 py-3 text-right">{num(r.stale, true)}</td>
                  <td className="px-5 py-3">
                    {weekly?.absent && weekly.state !== "submitted" && weekly.state !== "late" ? (
                      <>
                        <AbsentBadge />
                        <span className="mt-1 block text-caption text-muted">{substituteText(weekly.absent.substitute)}</span>
                      </>
                    ) : (
                      <WeeklyOrAbove weekly={weekly} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-line bg-surface font-semibold">
            <tr>
              <th scope="row" className="px-5 py-3 text-left">Вся команда</th>
              <td className="px-3 py-3 text-right tabular-nums">{totals.total}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.inWork}</td>
              <td className="px-3 py-3 text-right tabular-nums text-danger-ink">{totals.overdue}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.risk}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.closedWeek}</td>
              <td className="px-3 py-3 text-right tabular-nums">{totals.stale}</td>
              <td className="px-5 py-3" />
            </tr>
          </tfoot>
        </table>

        <ul className="divide-y divide-line md:hidden">
          {rows.map((r) => {
            const weekly = reports.find((w) => w.author === r.person.slug);
            return (
              <li key={r.person.slug} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <Link href={`/tasks/review?person=${r.person.slug}`} className="text-lead font-semibold text-ink">
                    {r.person.fullName}
                  </Link>
                  {weekly?.absent && weekly.state !== "submitted" && weekly.state !== "late" ? <AbsentBadge /> : <WeeklyOrAbove weekly={weekly} />}
                </div>
                {weekly?.absent && weekly.state !== "submitted" && weekly.state !== "late" ? (
                  <p className="mt-1 text-caption text-muted">Нет на неделе, {substituteText(weekly.absent.substitute)}</p>
                ) : null}
                <dl className="mt-2 grid grid-cols-3 gap-2 text-caption">
                  {[
                    ["В работе", r.inWork, false],
                    ["Просрочено", r.overdue, true],
                    ["С риском", r.risk, true],
                    ["Закрыто", r.closedWeek, false],
                    ["Без обновлений", r.stale, true],
                    ["Всего", r.total, false],
                  ].map(([label, n, alert]) => (
                    <div key={label as string}>
                      <dt className="text-muted">{label as string}</dt>
                      <dd className="text-lead">{num(n as number, alert as boolean)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-4 text-small text-muted">
        {data.team === TOP_TEAM ? `Общих задач для всех лидеров в работе: ${shared}. ` : ""}Имя открывает разбор задач человека.
      </p>
    </>
  );
}

/** Weekly руководителя команды сдаётся в команду выше: его подчинённым он не показывается (этап 14) */
function WeeklyOrAbove({ weekly }: { weekly: PersonWeekly | undefined }) {
  if (!weekly) return <span className="text-small text-muted">сдаёт в команду выше</span>;
  return <WeeklyBadge state={weekly.state} />;
}
