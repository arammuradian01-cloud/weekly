"use client";

// Панель «Мои команды» (этап 16): своя команда и команды на уровень ниже, люди выбранной команды,
// задачи, которые требуют внимания, и «Попросить обновить». Переход вниз: из команды в команду ниже, оттуда к человеку.

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquareMore } from "lucide-react";
import type { Panel, PanelPerson, PanelTask, PanelTeam } from "@/lib/org/panel";
import { usePrototype } from "@/domain/store";
import { formatShort } from "@/domain/dates";
import { requestUpdateAction } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { OverdueNote, StatusBadge, WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { Figures, Module } from "@/components/ui/data";
import { deadlineText } from "@/components/weekly/weekly-feed";

export function MyTeams({ panel }: { panel: Panel }) {
  // Задачи: своя команда плюс команды ниже (у каждой команды ниже уже вся её ветка). Weekly: своей команды
  const self = panel.teams.find((t) => t.level !== "below") ?? panel.teams[0]!;
  const sum = (k: "inWork" | "overdue" | "clarify" | "stale" | "goalsAtRisk") => panel.teams.reduce((acc, t) => acc + t[k], 0);
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Путь по командам" className="-mt-2">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-small">
          {panel.path.map((p, i) => (
            <li key={p.id} className="inline-flex items-center gap-1.5">
              {i > 0 ? <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" /> : null}
              {i === panel.path.length - 1 ? (
                <span className="font-semibold text-ink" aria-current="page">
                  {p.name}
                </span>
              ) : !p.link ? (
                <span className="text-muted">{p.name}</span>
              ) : (
                <Link href={`/my-teams?team=${p.id}`} className="text-blue-700 hover:underline">
                  {p.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <Figures
        label={panel.teams.length > 1 ? "Команда и команды ниже в цифрах" : "Команда в цифрах"}
        items={[
          { label: "В работе", value: sum("inWork"), testId: "mt-fig-work" },
          { label: "Просрочено", value: sum("overdue"), tone: "danger", testId: "mt-fig-overdue" },
          { label: "Требует уточнений", value: sum("clarify"), tone: "warning", testId: "mt-fig-clarify" },
          { label: "Давно без обновлений", value: sum("stale"), tone: "warning", testId: "mt-fig-stale" },
          { label: "Целей в риске", value: sum("goalsAtRisk"), tone: "danger", testId: "mt-fig-goals" },
          { label: `Weekly за неделю ${panel.reportingNumber}`, value: self.weekly.expected ? `${self.weekly.submitted + self.weekly.late} из ${self.weekly.expected}` : "не ждём", testId: "mt-fig-weekly" },
        ]}
      />

      <Module
        id="mt-teams"
        title={panel.teams.length > 1 ? "Команда и команды ниже" : "Команда"}
        description="По команде и командам на уровень ниже: кто руководит, сдача weekly и задачи. Название команды ниже открывает её панель."
        flush
      >
        <div className="overflow-x-auto">
          <table className="sv-datatable sv-datatable--stack" data-testid="mt-teams-table">
            <caption className="sr-only">Команды: weekly и задачи</caption>
            <thead>
              <tr>
                <th scope="col">Команда</th>
                <th scope="col">Weekly</th>
                <th scope="col" className="is-num">
                  В работе
                </th>
                <th scope="col" className="is-num">
                  Просрочено
                </th>
                <th scope="col" className="is-num">
                  Уточнить
                </th>
                <th scope="col" className="is-num">
                  Без обновлений
                </th>
                <th scope="col" className="is-num">
                  Целей в риске
                </th>
              </tr>
            </thead>
            <tbody>
              {panel.teams.map((t) => (
                <TeamRow key={t.id} team={t} />
              ))}
            </tbody>
          </table>
        </div>
      </Module>

      <Module
        id="mt-attention"
        title={
          <>
            Требует внимания <span className="font-normal text-muted">{panel.attention.length}</span>
          </>
        }
        description={`Просроченные, заблокированные и без обновлений дольше ${panel.staleDays} дней, по команде и командам ниже`}
        flush
      >
        {panel.attention.length ? (
          <ul className="flex flex-col divide-y divide-line border-t border-border">
            {panel.attention.map((t) => (
              <li key={t.number} className="px-5 py-3">
                <TaskLine task={t} showOwner />
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-5 pb-4">
            <EmptyState title="Просрочек и застрявших задач нет">Здесь появятся задачи, которые просрочены, заблокированы или давно не обновлялись.</EmptyState>
          </div>
        )}
      </Module>

      <Module
        id="mt-people"
        title={
          <>
            Люди команды <span className="font-normal text-muted">{panel.people.length}</span>
          </>
        }
        description={`Weekly за неделю ${panel.reportingNumber}, открытые задачи, переносы срока за 30 дней и просьбы к человеку. Имя раскрывает задачи человека.`}
        flush
      >
        <ul className="flex flex-col divide-y divide-line border-t border-border">
          {panel.people.map((p) => (
            <PersonRow key={p.slug} person={p} />
          ))}
        </ul>
      </Module>
    </div>
  );
}

function Count({ n, label, alert }: { n: number; label: string; alert?: boolean }) {
  return (
    <span className={cn("whitespace-nowrap", n && alert ? "font-medium text-danger-ink" : n ? "text-ink" : "text-muted")}>
      {label} {n}
    </span>
  );
}

function TeamRow({ team: t }: { team: PanelTeam }) {
  const done = t.weekly.submitted + t.weekly.late;
  const tone = t.weekly.expected === 0 ? "bg-mist" : done >= t.weekly.expected ? "bg-green" : t.weekly.passed ? "bg-danger" : "bg-amber";
  const n = (value: number, alert?: boolean) => <span className={cn("tabular-nums", value && alert ? "font-semibold text-danger-ink" : value ? "text-ink" : "text-muted")}>{value}</span>;
  return (
    <tr data-testid={`mt-team-${t.id}`}>
      <th scope="row" className="is-wide text-left font-normal">
        <span className="sv-datatable__name">
          <span className="sv-datatable__strong">
            {t.level === "below" ? (
              <Link href={`/my-teams?team=${t.id}`} className="hover:underline">
                {t.name}
              </Link>
            ) : (
              t.name
            )}
          </span>
          <span className="sv-datatable__hint">
            {t.leader ? `Руководитель: ${t.leader.fullName}` : "Руководитель не назначен"}, людей {t.people}
            {t.below ? `, команд ниже ${t.below}` : ""}
            {t.proposed ? `, предложено задач ${t.proposed}` : ""}
          </span>
        </span>
      </th>
      <td className="is-wide" data-label="Weekly">
        <span className="inline-flex items-start gap-2">
          <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", tone)} aria-hidden="true" />
          <span>
            {t.weekly.expected === 0 ? "в команде не ждём" : `сдали ${done} из ${t.weekly.expected}`}
            {t.weekly.expected ? <span className="block text-caption text-muted">{t.weekly.passed ? "срок прошёл" : deadlineText(t.weekly.deadline)}</span> : null}
          </span>
        </span>
      </td>
      <td className="is-num" data-label="В работе">
        {n(t.inWork)}
      </td>
      <td className="is-num" data-label="Просрочено">
        {n(t.overdue, true)}
      </td>
      <td className="is-num" data-label="Уточнить">
        {n(t.clarify, true)}
      </td>
      <td className="is-num" data-label="Без обновлений">
        {n(t.stale, true)}
      </td>
      <td className="is-num" data-label="Целей в риске">
        {n(t.goalsAtRisk, true)}
      </td>
    </tr>
  );
}

function TaskLine({ task: t, showOwner }: { task: PanelTask; showOwner?: boolean }) {
  const { notify } = usePrototype();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState(false);
  const ask = async () => {
    setBusy(true);
    const r = await requestUpdateAction(t.number);
    setBusy(false);
    if (!r.ok) return notify(r.error, "error");
    setAsked(true);
    notify(`Просьба ушла: ${r.value.asked}`);
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`/tasks/${t.number}`} className="text-body font-medium text-ink hover:underline">
          <span className="mr-1.5 font-normal tabular-nums text-muted">{t.number}</span>
          {t.title}
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
          {showOwner ? <span className="text-ink">{t.ownerName}</span> : null}
          <StatusBadge status={t.status} />
          <span className="tabular-nums">до {formatShort(t.due)}</span>
          {t.overdue ? <OverdueNote days={t.overdue} /> : null}
          {t.blocked ? <span className="font-medium text-danger-ink">заблокирована</span> : null}
          {t.stale ? <span className="font-medium text-warning-ink">давно без обновлений</span> : null}
          <span>{t.teamName}</span>
        </p>
      </div>
      {t.canAsk ? (
        <Button size="sm" variant="secondary" onClick={ask} disabled={busy || asked} className="shrink-0 self-start sm:self-center">
          <MessageSquareMore className="h-4 w-4" aria-hidden="true" />
          {asked ? "Попросили" : "Попросить обновить"}
        </Button>
      ) : null}
    </div>
  );
}

function PersonRow({ person: p }: { person: PanelPerson }) {
  const [open, setOpen] = useState(false);
  const w = p.weekly;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`${open ? "Свернуть задачи" : "Показать задачи"}: ${p.fullName}`}
          className="flex min-w-0 items-start gap-2 text-left"
        >
          {open ? <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
          <span className="min-w-0">
            <span className="block text-body font-semibold text-ink">
              {p.fullName}
              {p.leader ? <span className="ml-2 text-caption font-normal text-muted">руководитель команды</span> : null}
            </span>
            {p.position ? <span className="block text-small text-muted">{p.position}</span> : null}
          </span>
        </button>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-small sm:justify-end sm:pl-0">
          {w.absent && w.state !== "submitted" && w.state !== "late" ? (
            <span className="text-muted">нет на неделе</span>
          ) : w.optional && w.state === "not-started" ? (
            <span className="text-muted">weekly по желанию</span>
          ) : (
            <WeeklyBadge state={w.state} />
          )}
          <Count n={p.open} label="открытых" />
          <Count n={p.overdue} label="просрочено" alert />
          <Count n={p.stale} label="без обновлений" alert />
          <Count n={p.transfers} label="переносов" />
          {p.requests ? <Count n={p.requests} label="просьб к нему" /> : null}
        </div>
      </div>
      {open ? (
        p.tasks.length ? (
          <ul className="mt-3 flex flex-col gap-3 border-l-2 border-line pl-4 sm:ml-6">
            {p.tasks.map((t) => (
              <li key={t.number}>
                <TaskLine task={t} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 pl-6 text-small text-muted">Открытых задач нет.</p>
        )
      ) : null}
    </li>
  );
}
