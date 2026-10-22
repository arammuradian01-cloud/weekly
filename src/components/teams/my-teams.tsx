"use client";

// Вкладка «Руководителю» страницы «Люди» (панель руководителя, этап 16; с этапа 41 вкладкой): своя команда и команды на уровень ниже, люди выбранной команды,
// задачи, которые требуют внимания, и «Попросить обновить». Переход вниз: из команды в команду ниже, оттуда к человеку.
// Этап 68: команды карточками вместо таблицы. В карточке руководитель,
// полоса задач (в графике, застряли, просрочены), сдача weekly и одна ссылка. Описания модулей в одну строку.

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, ChevronRight, MessageSquareMore } from "lucide-react";
import type { Panel, PanelPerson, PanelTask, PanelTeam } from "@/lib/org/panel";
import { usePrototype } from "@/domain/store";
import { formatShort, plural } from "@/domain/dates";
import { requestUpdateAction } from "@/app/(app)/tasks/actions";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { OverdueNote, StatusBadge, WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { Figures, Module } from "@/components/ui/data";
import { deadlineText } from "@/components/weekly/weekly-feed";
import { PersonCardButton } from "@/components/people/person-card";

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
                <Link href={`/people/leader?team=${p.id}`} className="text-blue-700 hover:underline">
                  {p.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      {/* Этап 45: цифры строкой, не больше трёх, нули спрятаны; те же числа есть в таблице ниже по каждой команде */}
      <Figures
        label={panel.teams.length > 1 ? "Команда и команды ниже в цифрах" : "Команда в цифрах"}
        inline
        max={3}
        items={[
          { label: "в работе", value: sum("inWork"), href: "#mt-people", testId: "mt-fig-work", keepZero: true },
          { label: "просрочено", value: sum("overdue"), href: "#mt-attention", tone: "danger", testId: "mt-fig-overdue" },
          { label: plural(sum("goalsAtRisk"), "цель в риске", "цели в риске", "целей в риске"), value: sum("goalsAtRisk"), href: "/goals", tone: "danger", testId: "mt-fig-goals" },
          { label: plural(sum("clarify"), "требует уточнений", "требуют уточнений", "требуют уточнений"), value: sum("clarify"), href: "#mt-people", tone: "warning", testId: "mt-fig-clarify" },
          { label: "давно без обновлений", value: sum("stale"), href: "#mt-attention", tone: "warning", testId: "mt-fig-stale" },
          // Weekly от команды не ждут (сдают руководители выше): чипа нет, в таблице ниже это написано словами
          ...(self.weekly.expected
            ? [{ label: `сдали weekly за неделю ${panel.reportingNumber}`, value: `${self.weekly.submitted + self.weekly.late} из ${self.weekly.expected}`, href: "/weekly", testId: "mt-fig-weekly", keepZero: true }]
            : []),
        ]}
      />

      <Module
        id="mt-teams"
        title={panel.teams.length > 1 ? "Команда и команды ниже" : "Команда"}
        description="Название команды ниже открывает её панель"
        flush
      >
        <ul className="m-0 grid list-none gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-4 sm:p-5" data-testid="mt-team-cards" aria-label="Команды: weekly и задачи">
          {panel.teams.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </ul>
        <TeamLegend />
      </Module>

      <Module
        id="mt-attention"
        title={
          <>
            Требует внимания <span className="font-normal text-muted">{panel.attention.length}</span>
          </>
        }
        description={`Просрочены, заблокированы или без обновлений дольше ${panel.staleDays} дней`}
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
            <EmptyState title="Просрочек и застрявших задач нет" tone="success">Всё в графике.</EmptyState>
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
        description={`Weekly за неделю ${panel.reportingNumber} и задачи. Имя раскрывает задачи человека`}
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

/** Полоса задач команды: в графике, застряли или требуют уточнений, просрочены. Пустая полоса: задач в работе нет */
function TaskBar({ team: t }: { team: PanelTeam }) {
  const late = t.overdue;
  const stuck = Math.min(Math.max(t.inWork - late, 0), t.stale + t.clarify);
  const fine = Math.max(t.inWork - late - stuck, 0);
  if (!t.inWork) return <div className="h-2 rounded-full bg-field" aria-hidden="true" />;
  return (
    <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      {fine ? <span className="h-full rounded-full bg-green" style={{ flex: fine }} /> : null}
      {stuck ? <span className="h-full rounded-full bg-warning" style={{ flex: stuck }} /> : null}
      {late ? <span className="h-full rounded-full bg-danger" style={{ flex: late }} /> : null}
    </div>
  );
}

function TeamLegend() {
  return (
    <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 text-caption text-muted" aria-hidden="true">
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-full bg-green" />в графике</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-full bg-warning" />застряли или уточнить</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-full bg-danger" />просрочены</span>
    </p>
  );
}

function TeamCard({ team: t }: { team: PanelTeam }) {
  const done = t.weekly.submitted + t.weekly.late;
  const weeklyOk = t.weekly.expected > 0 && done >= t.weekly.expected;
  const weeklyText = t.weekly.expected === 0 ? "weekly в команде не ждём" : `weekly ${done} из ${t.weekly.expected}`;
  const problems = [
    t.overdue ? `просрочено ${t.overdue}` : null,
    t.stale ? `без обновлений ${t.stale}` : null,
    t.clarify ? `уточнить ${t.clarify}` : null,
    t.goalsAtRisk ? `${plural(t.goalsAtRisk, "цель", "цели", "целей")} в риске ${t.goalsAtRisk}` : null,
  ].filter(Boolean);
  return (
    <li
      className={cn("sv-card flex flex-col gap-3 px-4 py-4", t.overdue && "border-danger-ink/30")}
      data-testid={`mt-team-${t.id}`}
      aria-label={`${t.name}: в работе ${t.inWork}, ${problems.join(", ") || "всё в графике"}, ${weeklyText}`}
    >
      <div className="min-w-0">
        <p className="m-0 text-body font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
          {t.level === "below" ? (
            <Link href={`/people/leader?team=${t.id}`} className="hover:underline">
              {t.name}
            </Link>
          ) : (
            t.name
          )}
        </p>
        <p className="m-0 text-caption text-muted">
          {t.leader ? t.leader.fullName : "руководитель не назначен"}, {t.people} {plural(t.people, "человек", "человека", "человек")}
          {t.below ? `, команд ниже ${t.below}` : ""}
        </p>
      </div>
      <TaskBar team={t} />
      <p className="m-0 text-caption text-muted">
        в работе {t.inWork}
        {problems.length ? (
          <>
            {", "}
            <span className={cn("font-semibold", t.overdue ? "text-danger-ink" : "text-warning-ink")}>{problems.join(", ")}</span>
          </>
        ) : (
          ", всё в графике"
        )}
        {t.proposed ? `, предложено ${t.proposed}` : ""}
      </p>
      <p className={cn("m-0 mt-auto border-t border-line pt-2.5 text-caption font-semibold", t.weekly.expected === 0 ? "text-muted" : weeklyOk ? "text-green-ink" : t.weekly.passed ? "text-danger-ink" : "text-warning-ink")}>
        {weeklyText}
        {t.weekly.expected && !weeklyOk ? <span className="font-normal text-muted">, {t.weekly.passed ? "срок прошёл" : deadlineText(t.weekly.deadline)}</span> : null}
      </p>
    </li>
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
        <div className="flex min-w-0 items-start gap-1">
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
        <PersonCardButton slug={p.slug} name={p.fullName} />
        </div>
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
