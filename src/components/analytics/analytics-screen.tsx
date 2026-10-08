"use client";

// Панель «Аналитика» (этап 27, модуль М12). Данные приходят с сервера одним объектом, здесь только показ:
// выбор команды, «Сейчас», weekly и задачи по неделям, просьбы, цели квартала и карточки лидеров без рейтинга.

import Link from "next/link";
import Form from "next/form";
import { ChevronRight } from "lucide-react";
import type { Analytics, AreaGoals, AreaNow, AreaRequests, LeaderCard } from "@/lib/analytics/service";
import { hoursText, share, type WeeklyCell } from "@/lib/analytics/rules";
import { plural } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { WeekChart } from "./week-chart";

const CELL_WORDS: Record<WeeklyCell, string> = {
  "on-time": "сдан вовремя",
  late: "сдан с опозданием",
  missing: "не сдан",
  absent: "в отпуске",
  pending: "идёт сдача",
  none: "weekly не ждали",
};

export function AnalyticsScreen({ data }: { data: Analytics }) {
  const done = data.weekly.filter((w) => !w.current || w.pending === 0);
  const due = done.reduce((s, w) => s + w.expected - w.pending, 0);
  const onTime = share(
    done.reduce((s, w) => s + w.onTime, 0),
    due,
  );
  const closed = data.tasks.reduce((s, w) => s + w.closed, 0);
  const transfers = data.tasks.reduce((s, w) => s + w.transfers, 0);
  const firstOverdue = data.tasks[0]?.overdue ?? 0;
  const answered = data.tasks.reduce((s, w) => s + w.answered, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="-mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Путь по командам">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-small">
            {data.path.map((p, i) => (
              <li key={p.id} className="inline-flex items-center gap-1.5">
                {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" /> : null}
                {i === data.path.length - 1 ? (
                  <span className="font-semibold text-ink" aria-current="page">
                    {p.name}
                  </span>
                ) : p.link ? (
                  <Link href={`/analytics?team=${p.id}`} className="text-link hover:underline">
                    {p.name}
                  </Link>
                ) : (
                  <span className="text-muted">{p.name}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {data.options.length > 1 ? (
          // Выбор и кнопка «Показать»: стрелки в списке не открывают команду на каждом шаге
          <Form action="/analytics" className="flex items-center gap-2 text-small text-muted">
            <label htmlFor="an-team">Команда</label>
            <select id="an-team" name="team" key={data.team.id} defaultValue={data.team.id} className="sv-control min-w-0 max-w-[280px]">
              {data.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {`${"\u00A0\u00A0".repeat(o.depth)}${o.name}`}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="secondary" className="shrink-0">
              Показать
            </Button>
          </Form>
        ) : null}
      </div>

      <section aria-labelledby="an-now" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="an-now" className="text-title font-semibold text-ink">
            Задачи сейчас
          </h2>
          <Link href={`/my-teams?team=${data.team.id}`} className="text-small font-medium text-link hover:underline">
            Задачи и люди в «Моих командах»
          </Link>
        </div>
        <NowTiles now={data.now} staleDays={data.staleDays} />
        <p className="text-caption text-muted">
          {data.teams === 1 ? "Одна команда" : `Команд в счёте: ${data.teams}`}, людей {data.people}. Состав команд сегодняшний, прошлые недели считаются по нему.
        </p>
      </section>

      <section aria-labelledby="an-weekly" className="sv-card sv-card--soft px-5 py-4">
        <h2 id="an-weekly" className="sr-only">
          Weekly по неделям
        </h2>
        <WeekChart
          title="Сдача weekly по неделям"
          unit="%"
          weeks={data.weekly}
          bars={{ label: "Вовремя, % от ожидаемых", values: data.weekly.map((w) => w.onTimeShare) }}
          line={{ label: "Сдали всего, с опоздавшими", values: data.weekly.map((w) => w.submittedShare) }}
          insight={
            onTime === null
              ? "Weekly в этих командах пока не ждали."
              : `За законченные недели вовремя сдано ${onTime}% weekly. Отпуск не считается, текущая неделя в счёт не идёт, пока не прошёл срок.`
          }
          tip={(i) => {
            const w = data.weekly[i];
            return [
              `Вовремя ${w.onTime} из ${w.expected}`,
              ...(w.late ? [`С опозданием ${w.late}`] : []),
              ...(w.missing ? [`Не сдали ${w.missing}`] : []),
              ...(w.pending ? [`Ещё сдают ${w.pending}`] : []),
              ...(w.absent ? [`В отпуске ${w.absent}`] : []),
            ];
          }}
          columns={[
            { label: "Ждали", value: (i) => data.weekly[i].expected },
            { label: "Вовремя", value: (i) => data.weekly[i].onTime },
            { label: "С опозданием", value: (i) => data.weekly[i].late },
            { label: "Не сдали", value: (i) => data.weekly[i].missing },
            { label: "Ещё сдают", value: (i) => data.weekly[i].pending },
            { label: "В отпуске", value: (i) => data.weekly[i].absent },
            { label: "Вовремя, %", value: (i) => data.weekly[i].onTimeShare ?? "" },
          ]}
        />
      </section>

      <section aria-labelledby="an-tasks" className="flex flex-col gap-3">
        <h2 id="an-tasks" className="text-title font-semibold text-ink">
          Задачи и просьбы по неделям
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="sv-card sv-card--soft px-5 py-4">
            <WeekChart
              title="Закрыто задач"
              weeks={data.tasks}
              bars={{ label: "Закрыто", values: data.tasks.map((w) => w.closed) }}
              insight={`За 8 недель закрыто ${closed} ${plural(closed, "задача", "задачи", "задач")}: выполнено полностью или частично.`}
              tip={(i) => [`Закрыто ${data.tasks[i].closed}`]}
              columns={[{ label: "Закрыто", value: (i) => data.tasks[i].closed }]}
            />
          </div>
          <div className="sv-card sv-card--soft px-5 py-4">
            <WeekChart
              title="Переносы срока"
              weeks={data.tasks}
              bars={{ label: "Переносы", values: data.tasks.map((w) => w.transfers) }}
              insight={`За 8 недель ${transfers} ${plural(transfers, "перенос", "переноса", "переносов")} срока задач команды.`}
              tip={(i) => [`Переносов ${data.tasks[i].transfers}`]}
              columns={[{ label: "Переносов", value: (i) => data.tasks[i].transfers }]}
            />
          </div>
          <div className="sv-card sv-card--soft px-5 py-4">
            <WeekChart
              title="Просрочено на конец недели"
              weeks={data.tasks}
              line={{ label: "Просрочено", values: data.tasks.map((w) => w.overdue) }}
              insight={`Сейчас просрочено ${data.now.overdue}, на конец недели ${data.tasks[0]?.number ?? ""} было ${firstOverdue}. Прошлые недели восстановлены по переносам срока, статус задачи берётся сегодняшний.`}
              tip={(i) => [`Просрочено ${data.tasks[i].overdue}`]}
              columns={[{ label: "Просрочено", value: (i) => data.tasks[i].overdue }]}
            />
          </div>
          <div className="sv-card sv-card--soft px-5 py-4">
            <WeekChart
              title="Ответ на просьбы, рабочих часов"
              weeks={data.tasks}
              line={{ label: "Медиана ответа", values: data.tasks.map((w) => w.answerHours === null ? null : Math.round(w.answerHours)) }}
              insight={
                answered
                  ? `За 8 недель ответили на ${answered} ${plural(answered, "просьбу", "просьбы", "просьб")}, медиана ${hoursText(data.requests.medianHours)}. Часы считаются по будням с 9 до 20.`
                  : "Просьб к людям команды за 8 недель не было."
              }
              tip={(i) => [data.tasks[i].answered ? `Медиана ${hoursText(data.tasks[i].answerHours)}` : "Ответов не было", `Ответов ${data.tasks[i].answered}`]}
              columns={[
                { label: "Ответов", value: (i) => data.tasks[i].answered },
                { label: "Медиана, раб. часов", value: (i) => (data.tasks[i].answerHours === null ? "" : Math.round(data.tasks[i].answerHours!)) },
              ]}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="an-requests" className="sv-card sv-card--soft px-5 py-4">
          <h2 id="an-requests" className="text-title-sm font-semibold text-ink">
            Просьбы к людям команды
          </h2>
          <RequestsLine requests={data.requests} className="mt-2" />
        </section>
        <section aria-labelledby="an-goals" className="sv-card sv-card--soft px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="an-goals" className="text-title-sm font-semibold text-ink">
              Цели квартала {data.goals.quarter.replace(/^\d{4}-/, "")}
            </h2>
            <Link href="/goals" className="text-small font-medium text-link hover:underline">
              Все цели
            </Link>
          </div>
          <GoalsLine goals={data.goals} className="mt-2" />
        </section>
      </div>

      <section aria-labelledby="an-leaders" className="flex flex-col gap-3">
        <div>
          <h2 id="an-leaders" className="text-title font-semibold text-ink">
            Лидеры <span className="font-normal text-muted">{data.leaders.length}</span>
          </h2>
          <p className="mt-1 text-small text-muted">
            По карточке на руководителя команды уровнем ниже, в порядке структуры. Общего рейтинга нет: карточка для разговора один на один.
          </p>
        </div>
        {data.leaders.length ? (
          <>
            <StripLegend />
            <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {data.leaders.map((c) => (
                <LeaderCardView key={c.key} card={c} staleDays={data.staleDays} firstWeek={data.tasks[0]?.number ?? 0} />
              ))}
            </ul>
          </>
        ) : (
          <p className="sv-card sv-card--soft px-5 py-4 text-body text-muted">
            Ниже этой команды других команд нет. Люди команды и их задачи на странице{" "}
            <Link href={`/my-teams?team=${data.team.id}`} className="font-medium text-link hover:underline">
              «Мои команды»
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}

const staleLabel = (days: number) => `Без обновлений дольше ${days} ${plural(days, "дня", "дней", "дней")}`;

function NowTiles({ now, staleDays }: { now: AreaNow; staleDays: number }) {
  const items: [string, number][] = [
    ["В работе", now.inWork],
    ["Просрочено", now.overdue],
    [staleLabel(staleDays), now.stale],
    ["Заблокировано", now.blocked],
    ["Требуют уточнений", now.clarify],
    ["Предложены, ещё не приняты", now.proposed],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-1 rounded-lg bg-surface px-3.5 py-3 ring-1 ring-line">
          <dt className="text-caption text-muted">{label}</dt>
          <dd className="text-number font-semibold tabular-nums text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RequestsLine({ requests: r, className }: { requests: AreaRequests; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-2 text-small sm:grid-cols-4", className)}>
      <div>
        <dt className="text-muted">Ждут ответа</dt>
        <dd className="text-body font-semibold tabular-nums text-ink">{r.waiting}</dd>
      </div>
      <div>
        <dt className="text-muted">Приняты, в работе</dt>
        <dd className="text-body font-semibold tabular-nums text-ink">{r.accepted}</dd>
      </div>
      <div>
        <dt className="text-muted">Срок прошёл</dt>
        <dd className="text-body font-semibold tabular-nums text-ink">{r.overdue}</dd>
      </div>
      <div>
        <dt className="text-muted">Медиана ответа</dt>
        <dd className="text-body font-semibold text-ink">{hoursText(r.medianHours)}</dd>
      </div>
    </dl>
  );
}

const GOAL_PARTS: { key: keyof Omit<AreaGoals, "quarter" | "total">; label: string; dot: string }[] = [
  { key: "onTrack", label: "в графике", dot: "bg-accent" },
  { key: "atRisk", label: "в риске", dot: "bg-warning" },
  { key: "achieved", label: "достигнуто", dot: "bg-green" },
  { key: "partial", label: "частично", dot: "bg-green" },
  { key: "missed", label: "не достигнуто", dot: "bg-danger" },
  { key: "dropped", label: "снято", dot: "bg-mist" },
];

function GoalsLine({ goals: g, className }: { goals: AreaGoals; className?: string }) {
  if (!g.total) return <p className={cn("text-body text-muted", className)}>Целей на этот квартал в команде нет.</p>;
  const parts = GOAL_PARTS.filter((p) => g[p.key] > 0);
  return (
    <p className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink", className)}>
      <span className="font-semibold">
        {g.total} {plural(g.total, "цель", "цели", "целей")}:
      </span>
      {parts.map((p) => (
        <span key={p.key} className="inline-flex items-center gap-1.5">
          <i className={cn("h-2 w-2 rounded-full", p.dot)} aria-hidden="true" />
          {p.label} {g[p.key]}
        </span>
      ))}
    </p>
  );
}

function StripLegend() {
  const cells: WeeklyCell[] = ["on-time", "late", "missing", "absent", "pending", "none"];
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
      <span>Weekly лидера по неделям:</span>
      {cells.map((c) => (
        <span key={c} className="inline-flex items-center gap-1.5">
          <i className={`sv-wstrip__cell sv-wstrip__cell--${c}`} aria-hidden="true" />
          {CELL_WORDS[c]}
        </span>
      ))}
    </p>
  );
}

/** Мини-график просрочки: линия по неделям, последнее значение рядом. Рост просрочки красным, снижение зелёным */
function Spark({ values, label }: { values: number[]; label: string }) {
  const w = 80;
  const h = 24;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(values.length - 1, 1)) * (w - 2) + 1).toFixed(1)} ${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  const delta = values.length > 1 ? values[values.length - 1] - values[0] : 0;
  const tone = delta > 0 ? "sv-sparkline__line--down" : delta < 0 ? "sv-sparkline__line--up" : "";
  return (
    <span className="sv-sparkline" role="img" aria-label={label}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <path className={cn("sv-sparkline__line", tone)} d={d} />
      </svg>
    </span>
  );
}

function LeaderCardView({ card: c, staleDays, firstWeek }: { card: LeaderCard; staleDays: number; firstWeek: number }) {
  const first = c.overdue[0] ?? 0;
  const last = c.overdue[c.overdue.length - 1] ?? 0;
  const trend = last > first ? `больше, чем на конец недели ${firstWeek} (${first})` : last < first ? `меньше, чем на конец недели ${firstWeek} (${first})` : `столько же, сколько на конец недели ${firstWeek}`;
  const name = c.leader ? `${c.leader.fullName}${c.leader.note ? `, ${c.leader.note}` : ""}` : "Руководитель не назначен";
  const deeper = c.teams.find((t) => t.below);
  return (
    <li className="sv-card sv-card--soft flex flex-col gap-3 px-5 py-4" aria-label={`Карточка: ${name}`}>
      <div>
        <p className="text-body font-semibold text-ink">{name}</p>
        <p className="text-small text-muted">
          {c.teams.map((t, i) => (
            <span key={t.id}>
              {i ? ", " : ""}
              {t.below ? (
                <Link href={`/analytics?team=${t.id}`} className="text-link hover:underline">
                  {t.name}
                </Link>
              ) : (
                t.name
              )}
            </span>
          ))}
          , людей {c.people}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
        <span className="sv-wstrip" role="img" aria-label={`Weekly по неделям: ${c.weekly.cells.map((x) => `неделя ${x.number} ${CELL_WORDS[x.cell]}`).join(", ")}`}>
          {c.weekly.cells.map((x) => (
            <i key={x.key} className={`sv-wstrip__cell sv-wstrip__cell--${x.cell}`} title={`Неделя ${x.number}: ${CELL_WORDS[x.cell]}`} />
          ))}
        </span>
        <span className="text-ink">
          {c.leader && !c.leader.active ? "Weekly не считается" : c.weekly.optional ? "Weekly от лидера не ждут" : c.weekly.due ? `Вовремя ${c.weekly.onTime} из ${c.weekly.due}` : "Законченных недель со сдачей ещё нет"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-small">
        <div>
          <dt className="text-muted">В работе</dt>
          <dd className="font-semibold tabular-nums text-ink">{c.now.inWork}</dd>
        </div>
        <div>
          <dt className="text-muted">Просрочено</dt>
          <dd className="flex items-center gap-2 font-semibold tabular-nums text-ink">
            {c.now.overdue}
            <Spark values={c.overdue} label={`Просрочено на конец недели за 8 недель: сейчас ${last}, ${trend}`} />
          </dd>
        </div>
        <div>
          <dt className="text-muted">{staleLabel(staleDays)}</dt>
          <dd className="font-semibold tabular-nums text-ink">{c.now.stale}</dd>
        </div>
        <div>
          <dt className="text-muted">Заблокировано</dt>
          <dd className="font-semibold tabular-nums text-ink">{c.now.blocked}</dd>
        </div>
        <div>
          <dt className="text-muted">Закрыто за 8 недель</dt>
          <dd className="font-semibold tabular-nums text-ink">{c.closed}</dd>
        </div>
        <div>
          <dt className="text-muted">Переносов срока за 8 недель</dt>
          <dd className="font-semibold tabular-nums text-ink">{c.transfers}</dd>
        </div>
        <div>
          <dt className="text-muted">Просьбы ждут ответа</dt>
          <dd className="font-semibold tabular-nums text-ink">{c.requests.waiting}</dd>
        </div>
        <div>
          <dt className="text-muted">Медиана ответа</dt>
          <dd className="font-semibold text-ink">{hoursText(c.requests.medianHours)}</dd>
        </div>
      </dl>

      <p className="text-small text-ink">
        {c.goals.total ? (
          <>
            Цели квартала: {c.goals.total}
            {c.goals.atRisk ? <span className="text-warning-ink">, в риске {c.goals.atRisk}</span> : ", в риске нет"}
            {c.goals.achieved + c.goals.partial ? `, достигнуто ${c.goals.achieved + c.goals.partial}` : ""}
          </>
        ) : (
          <span className="text-muted">Целей на квартал нет</span>
        )}
      </p>

      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-small font-medium">
        <Link href={`/my-teams?team=${c.teams[0].id}`} className="text-link hover:underline">
          Задачи и люди
        </Link>
        {deeper ? (
          <Link href={`/analytics?team=${deeper.id}`} className="text-link hover:underline">
            Аналитика команды
          </Link>
        ) : null}
      </div>
    </li>
  );
}
