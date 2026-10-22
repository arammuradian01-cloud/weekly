"use client";

// Цели карточками (этап 68). Вид по умолчанию: цели по командам, в карточке код,
// название, статус, путь к целевому значению (полоса Meter из таблицы) или доля закрытых задач, риск одной строкой,
// владелец и задачи. Карточка раскрывается: описание и задачи цели. Таблица и дерево остались видами рядом.
// Сверху шкала квартала: статусы одной полосой, подписи под ней включают отбор. Ссылка на цель (#goal-...) открывает
// таблицу: там строка раскрывается с фактом и историей (goals-screen.tsx).

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import type { GoalNode } from "@/lib/goals/service";
import { formatShort, plural } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { OverdueNote } from "@/components/ui/task-badges";
import { Meter, goalStatus } from "./goals-table";

export type QuarterSlice = { key: string; label: string; count: number; color: string; active: boolean; onClick: () => void };

/** Шкала квартала: одна полоса из статусов и подписи-кнопки под ней. Нулевые отрезки не рисуются */
export function QuarterBar({ total, slices, onAll, allActive }: { total: number; slices: QuarterSlice[]; onAll: () => void; allActive: boolean }) {
  const shown = slices.filter((s) => s.count > 0);
  return (
    <section aria-label="Цели квартала по статусам" className="sv-card flex flex-col gap-3 px-5 py-4" data-testid="goals-quarter-bar">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-field" aria-hidden="true">
        {shown.map((s) => (
          <span key={s.key} className={cn("h-full", s.color)} style={{ flex: s.count }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAll} aria-pressed={allActive} className={cn("sv-pill", allActive && "is-active")}>
          Все <span className="sv-counter sv-counter--neutral">{total}</span>
        </button>
        {shown.map((s) => (
          <button key={s.key} type="button" onClick={s.onClick} aria-pressed={s.active} className={cn("sv-pill inline-flex items-center gap-2", s.active && "is-active")}>
            <span className={cn("h-2 w-2 rounded-full", s.color)} aria-hidden="true" />
            {s.label}
            <span className="sv-counter sv-counter--neutral">{s.count}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

type Actions = { onEdit: (g: GoalNode) => void; onMark: (g: GoalNode) => void; onAdd: (g: GoalNode) => void; onFact: (g: GoalNode) => void; creatable: boolean };

export function GoalsCards({ goals, ...actions }: { goals: GoalNode[] } & Actions) {
  // Группы по командам в порядке первой встречи: сервис уже отдаёт департамент первым
  const groups: { team: string; name: string; goals: GoalNode[] }[] = [];
  for (const g of goals) {
    const group = groups.find((x) => x.team === g.team.id);
    if (group) group.goals.push(g);
    else groups.push({ team: g.team.id, name: g.team.name, goals: [g] });
  }
  return (
    <div className="flex flex-col gap-8 p-4 sm:p-5" data-testid="goals-cards">
      {groups.map((gr) => (
        <section key={gr.team} aria-labelledby={`gc-${gr.team}`} className="flex flex-col gap-3">
          <h3 id={`gc-${gr.team}`} className="m-0 flex items-baseline gap-2 text-title-sm font-semibold text-ink">
            {gr.name}
            <span className="text-small font-normal text-muted">
              {gr.goals.length} {plural(gr.goals.length, "цель", "цели", "целей")}
            </span>
          </h3>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 2xl:grid-cols-3">
            {gr.goals.map((g) => (
              <GoalCard key={g.id} goal={g} {...actions} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function GoalCard({ goal: g, onEdit, onMark, onAdd, onFact, creatable }: { goal: GoalNode } & Actions) {
  const [open, setOpen] = useState(false);
  const status = goalStatus(g);
  const pct = g.progress.total ? Math.round((g.progress.done / g.progress.total) * 100) : 0;
  return (
    <li id={`goal-${g.id}`} className={cn("sv-card flex flex-col gap-3 px-4 py-4 scroll-mt-24", g.risk && g.result === "IN_PROGRESS" && "border-danger-ink")} data-testid={`goal-card-${g.id}`}>
      <div className="flex items-start gap-2">
        {g.code ? <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-blue-soft px-2 text-caption font-semibold tabular-nums text-link">{g.code}</span> : null}
        <p className="m-0 min-w-0 flex-1 text-body font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{g.title}</p>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
      </div>

      {g.numeric ? (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between gap-2 text-caption text-muted">
            <span>{g.base ? `база ${g.base}` : "база не задана"}</span>
            <span className="font-semibold text-ink">{g.fact ? `факт ${g.fact.value}` : "факт не вписан"}</span>
            <span>{g.target ? `цель ${g.target}` : ""}</span>
          </div>
          <Meter progress={g.numeric} risk={!!g.risk} />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex justify-between gap-2 text-caption text-muted">
            <span>{g.metric ? g.metric : "без числа"}</span>
            <span className="font-semibold text-ink">{g.progress.total ? `задачи ${g.progress.done} из ${g.progress.total}` : "задач пока нет"}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-field" aria-hidden="true">
            <div className="h-full rounded-full bg-green" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {g.risk ? (
        <p className="m-0 flex items-start gap-1.5 rounded-control bg-danger-soft px-3 py-2 text-small text-danger-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2">{g.risk}</span>
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-caption text-muted">
        {g.owner ? <span className="font-semibold text-ink">{g.owner.fullName}</span> : null}
        {g.numeric && g.progress.total ? <span>задачи {g.progress.done} из {g.progress.total}</span> : null}
        {g.progress.overdue ? <span className="font-semibold text-danger-ink">просрочено {g.progress.overdue}</span> : null}
        {g.below.total ? <span>целей ниже {g.below.achieved} из {g.below.total}</span> : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`goal-card-more-${g.id}`}
          aria-label={`${open ? "Свернуть" : "Подробнее"}: ${g.code ? `${g.code}. ` : ""}${g.title}`}
          className="ml-auto inline-flex min-h-8 items-center gap-1 font-semibold text-link hover:underline"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
          {open ? "Свернуть" : "Подробнее"}
        </button>
      </div>

      {open ? (
        <div id={`goal-card-more-${g.id}`} className="flex flex-col gap-3">
          {g.description ? <p className="m-0 whitespace-pre-line text-small text-ink">{g.description}</p> : null}
          {g.tasks.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {g.tasks.map((t) => (
                <li key={t.number} className="flex flex-wrap items-baseline gap-x-2 text-small">
                  <Link href={`/tasks/${t.number}`} className={cn("hover:underline", t.done ? "text-muted line-through decoration-1" : "text-ink")}>
                    <span className="mr-1 tabular-nums text-muted">{t.number}</span>
                    {t.title}
                  </Link>
                  <span className="text-caption text-muted">
                    {t.owner}, до {formatShort(t.due)}
                  </span>
                  {t.overdue ? <OverdueNote days={t.overdue} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-small text-muted">Задач нет: привяжите их в карточке задачи, поле «Цель».</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {/* Факт вписывается в строке таблицы (редактор с прогрессом и историей): кнопка открывает таблицу на этой цели */}
            {g.numeric || g.target ? (
              <button type="button" className="inline-flex min-h-8 items-center text-small font-medium text-link hover:underline" onClick={() => onFact(g)}>
                Факт
              </button>
            ) : null}
            {g.canMark ? (
              <button type="button" className="inline-flex min-h-8 items-center text-small font-medium text-link hover:underline" onClick={() => onMark(g)}>
                Риск и итог
              </button>
            ) : null}
            {g.canEdit ? (
              <button type="button" className="inline-flex min-h-8 items-center text-small font-medium text-link hover:underline" onClick={() => onEdit(g)}>
                Изменить
              </button>
            ) : null}
            {creatable ? (
              <button type="button" className="inline-flex min-h-8 items-center text-small font-medium text-link hover:underline" onClick={() => onAdd(g)}>
                Цель ниже
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
