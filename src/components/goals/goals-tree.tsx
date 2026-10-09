"use client";

// Цели деревом (этап 17, вид «Дерево» с этапа 33): от целей департамента до команд и людей, прогресс по задачам,
// факт и прогресс к целевому, риск, итог. Таблица с фактом в goals-table.tsx

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { GoalNode } from "@/lib/goals/service";
import { formatShort } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { OverdueNote } from "@/components/ui/task-badges";
import { Meter, goalStatus } from "./goals-table";

export function GoalsTree({ roots, byId, onEdit, onMark, onAdd, creatable }: { roots: string[]; byId: Map<string, GoalNode>; onEdit: (g: GoalNode) => void; onMark: (g: GoalNode) => void; onAdd: (g: GoalNode) => void; creatable: boolean }) {
  return (
    <ul className="flex flex-col gap-3 p-4 sm:p-5" aria-label="Дерево целей">
      {roots.map((id) => (byId.get(id) ? <GoalItem key={id} goal={byId.get(id)!} byId={byId} depth={0} onEdit={onEdit} onMark={onMark} onAdd={onAdd} creatable={creatable} /> : null))}
    </ul>
  );
}

function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-field" aria-hidden="true">
        <div className="h-full rounded-full bg-green" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-caption tabular-nums text-muted">{total ? `задач закрыто ${done} из ${total}` : "задач пока нет"}</span>
    </div>
  );
}

function GoalItem({
  goal: g,
  byId,
  depth,
  onEdit,
  onMark,
  onAdd,
  creatable,
}: {
  goal: GoalNode;
  byId: Map<string, GoalNode>;
  depth: number;
  onEdit: (g: GoalNode) => void;
  onMark: (g: GoalNode) => void;
  onAdd: (g: GoalNode) => void;
  creatable: boolean;
}) {
  const [open, setOpen] = useState(depth === 0);
  const kids = g.childIds.map((id) => byId.get(id)).filter((x): x is GoalNode => !!x);
  return (
    <li id={`goal-${g.id}`} className={cn("sv-card sv-card--soft bg-surface", depth > 0 && "border-l-4 border-l-blue-soft")}>
      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label={`${open ? "Свернуть" : "Развернуть"}: ${g.title}`}
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-field hover:text-ink"
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-body font-semibold leading-snug text-ink">
              {g.code ? <span className="mr-1.5 font-normal tabular-nums text-muted">{g.code}</span> : null}
              {g.title}
            </p>
            <p className="mt-0.5 text-small text-muted">
              {g.team.name}
              {g.owner ? `, владелец ${g.owner.fullName}` : ""}
              {g.metric ? `, метрика: ${g.metric}` : ""}
              {g.base || g.target ? `, ${g.base ? `база ${g.base}` : ""}${g.base && g.target ? ", " : ""}${g.target ? `цель ${g.target}` : ""}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Progress done={g.progress.done} total={g.progress.total} />
              {g.below.total ? <span className="text-caption text-muted">целей ниже достигнуто {g.below.achieved} из {g.below.total}</span> : null}
              {g.progress.overdue ? <span className="text-caption font-medium text-danger-ink">просрочено задач {g.progress.overdue}</span> : null}
              <Badge tone={goalStatus(g).tone} dot>
                {goalStatus(g).label}
              </Badge>
              {g.fact ? (
                <span className="text-caption text-text-secondary">
                  факт <span className="font-semibold text-ink">{g.fact.value}</span>
                </span>
              ) : null}
              {g.numeric ? <Meter progress={g.numeric} risk={!!g.risk} /> : null}
              {g.link ? (
                <a href={g.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-caption text-blue-700 hover:underline">
                  Борд
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            {g.risk ? (
              <p className="mt-1.5 inline-flex items-start gap-1.5 text-small font-medium text-danger-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />В риске: {g.risk}
              </p>
            ) : null}
          </div>
        </div>
        {open ? (
          <div className="flex flex-col gap-3 pl-9">
            {g.description ? <p className="whitespace-pre-line text-small text-ink">{g.description}</p> : null}
            {g.tasks.length ? (
              <ul className="flex flex-col gap-1.5">
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
              <p className="text-small text-muted">Задач у цели нет: привяжите задачи в их карточках, поле «Цель».</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {g.canMark ? (
                <button type="button" className="text-small font-medium text-blue-700 hover:underline" onClick={() => onMark(g)}>
                  Риск и итог
                </button>
              ) : null}
              {g.canEdit ? (
                <button type="button" className="text-small font-medium text-blue-700 hover:underline" onClick={() => onEdit(g)}>
                  Изменить
                </button>
              ) : null}
              {creatable ? (
                <button type="button" className="text-small font-medium text-blue-700 hover:underline" onClick={() => onAdd(g)}>
                  Цель ниже
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {open && kids.length ? (
        <ul className="flex flex-col gap-3 px-3 pb-3 sm:px-4">
          {kids.map((k) => (
            <GoalItem key={k.id} goal={k} byId={byId} depth={depth + 1} onEdit={onEdit} onMark={onMark} onAdd={onAdd} creatable={creatable} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

