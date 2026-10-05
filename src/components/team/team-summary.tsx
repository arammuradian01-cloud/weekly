"use client";

import Link from "next/link";
import { usePrototype } from "@/prototype/store";
import { PEOPLE } from "@/prototype/people";
import { isClosedThisWeek, isOverdue, isStale } from "@/prototype/rules";
import type { Person, PersonWeekly, Task } from "@/prototype/types";
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
  const { data, me } = usePrototype();
  const rows: Row[] = PEOPLE.map((p) => {
    const own = data.tasks.filter((t: Task) => t.owner === p.slug && !t.archived);
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
  const shared = data.tasks.filter((t) => t.owner === "all" && (t.status === "in-progress" || t.status === "clarify")).length;
  const totals = rows.reduce(
    (acc, r) => ({ total: acc.total + r.total, inWork: acc.inWork + r.inWork, overdue: acc.overdue + r.overdue, risk: acc.risk + r.risk, closedWeek: acc.closedWeek + r.closedWeek, stale: acc.stale + r.stale }),
    { total: 0, inWork: 0, overdue: 0, risk: 0, closedWeek: 0, stale: 0 },
  );

  const num = (n: number, alert?: boolean) => <span className={cn("tabular-nums", alert && n > 0 ? "font-semibold text-danger-ink" : n === 0 ? "text-muted" : "text-ink")}>{n}</span>;

  return (
    <>
      <div className="overflow-hidden rounded-xl ring-1 ring-line">
        <table className="hidden w-full text-left text-[15px] md:table">
          <caption className="sr-only">Задачи и weekly по каждому</caption>
          <thead className="bg-surface text-[13px] text-muted">
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
                    {r.person.slug === me.slug ? <span className="ml-2 text-[13px] text-muted">это вы</span> : null}
                    <p className="text-[13px] text-muted">
                      {ROLE_LABELS[r.person.role]}, {r.person.zone}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-right">{num(r.total)}</td>
                  <td className="px-3 py-3 text-right">{num(r.inWork)}</td>
                  <td className="px-3 py-3 text-right">{num(r.overdue, true)}</td>
                  <td className="px-3 py-3 text-right">{num(r.risk, true)}</td>
                  <td className="px-3 py-3 text-right">{num(r.closedWeek)}</td>
                  <td className="px-3 py-3 text-right">{num(r.stale, true)}</td>
                  <td className="px-5 py-3">
                    <WeeklyBadge state={weekly?.state ?? "not-started"} />
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
                  <Link href={`/tasks/review?person=${r.person.slug}`} className="text-[16px] font-semibold text-ink">
                    {r.person.fullName}
                  </Link>
                  <WeeklyBadge state={weekly?.state ?? "not-started"} />
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-[13px]">
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
                      <dd className="text-[16px]">{num(n as number, alert as boolean)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="mt-4 text-[14px] text-muted">
        Общих задач для всех лидеров в работе: {shared}. Имя открывает разбор задач человека.
      </p>
    </>
  );
}
