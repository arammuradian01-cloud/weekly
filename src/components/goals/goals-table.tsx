"use client";

// Цели таблицей (этап 33): строка на цель, колонки «База», «Целевое», «Факт», «Прогресс», «Статус», «Задачи». Группы по
// командам или по людям с разделителями. Факт и целевое значение вписываются прямо в строке: сразу видно, каким станет
// прогресс. Описание, задачи, история факта и действия раскрываются под строкой

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { GoalNode } from "@/lib/goals/service";
import type { GoalResult } from "@/generated/prisma/enums";
import { goalProgress, progressLabel, type GoalProgress } from "@/lib/goals/progress";
import { formatShort } from "@/domain/dates";
import { usePrototype } from "@/domain/store";
import { setGoalFactAction, updateGoalAction } from "@/app/(app)/goals/actions";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { TextInput } from "@/components/ui/primitives";
import { OverdueNote } from "@/components/ui/task-badges";
import { cn } from "@/lib/cn";

export type GoalGroupBy = "team" | "person";

const STATUS: Record<GoalResult, { label: string; tone: BadgeTone }> = {
  IN_PROGRESS: { label: "Идёт", tone: "blue" },
  ACHIEVED: { label: "Достигнута", tone: "green" },
  PARTIAL: { label: "Частично", tone: "yellow" },
  MISSED: { label: "Не достигнута", tone: "red" },
  DROPPED: { label: "Снята", tone: "gray" },
};

export function goalStatus(g: Pick<GoalNode, "result" | "risk">): { label: string; tone: BadgeTone } {
  if (g.result === "IN_PROGRESS" && g.risk) return { label: "В риске", tone: "red" };
  return STATUS[g.result];
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short" });
const fullFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function Meter({ progress, risk }: { progress: GoalProgress | null; risk?: boolean }) {
  if (!progress) return <span className="text-caption text-text-secondary">нет</span>;
  const width = Math.max(0, Math.min(1, progress.share)) * 100;
  return (
    <span className={cn("sv-meter", progress.share >= 1 && "sv-meter--done", risk && progress.share < 1 && "sv-meter--risk")}>
      <span className="sv-meter__track" aria-hidden="true">
        <span className="sv-meter__fill" style={{ width: `${width}%` }} />
      </span>
      <span className="sv-meter__label">{progressLabel(progress)}</span>
    </span>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void;

export function GoalsTable({
  goals,
  groupBy,
  onEdit,
  onMark,
  onAdd,
  creatable,
  onChanged,
}: {
  goals: GoalNode[];
  groupBy: GoalGroupBy;
  onEdit: (g: GoalNode) => void;
  onMark: (g: GoalNode) => void;
  onAdd: (g: GoalNode) => void;
  creatable: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const byId = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  // Ссылка с метки цели (#goal-…): раскрыть и показать строку
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#goal-/, ""));
    if (!id || !byId.has(id)) return;
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`goal-${id}`)?.scrollIntoView({ block: "center" }));
  }, [byId]);

  const groups = useMemo(() => {
    const out = new Map<string, { key: string; label: string; goals: GoalNode[] }>();
    for (const g of goals) {
      const key = groupBy === "team" ? g.team.id : (g.owner?.slug ?? "none");
      const label = groupBy === "team" ? g.team.name : (g.owner?.fullName ?? "Без владельца");
      if (!out.has(key)) out.set(key, { key, label, goals: [] });
      out.get(key)!.goals.push(g);
    }
    return [...out.values()];
  }, [goals, groupBy]);

  const COLS = 9;
  return (
    <div className="overflow-x-auto">
      <table className="sv-datatable sv-datatable--stack" data-testid="goals-table">
        <caption className="sr-only">Цели квартала: база, целевое значение, факт, прогресс, статус и задачи</caption>
        <thead>
          <tr>
            <th scope="col">Цель</th>
            <th scope="col">Метрика</th>
            <th scope="col" className="is-num">
              База
            </th>
            <th scope="col" className="is-num">
              Целевое
            </th>
            <th scope="col" className="is-num">
              Факт
            </th>
            <th scope="col">Прогресс</th>
            <th scope="col">Статус</th>
            <th scope="col">Задачи</th>
            <th scope="col">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.flatMap((group) => [
            <tr key={`group-${group.key}`} className="sv-datatable__section">
              <td colSpan={COLS}>
                {group.label}: целей {group.goals.length}
              </td>
            </tr>,
            ...group.goals.flatMap((g) => {
              const status = goalStatus(g);
              const isOpen = open === g.id;
              const parent = g.parentId ? byId.get(g.parentId) : undefined;
              return [
                <tr key={g.id} id={`goal-${g.id}`} className={cn(isOpen && "sv-datatable__row--picked", editing === g.id && "sv-datatable__row--edit")} data-testid={`goal-row-${g.code ?? g.id}`}>
                  <td className="is-wide">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : g.id)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${g.title}`}
                        className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary hover:bg-field hover:text-ink"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                      </button>
                      <div className="sv-datatable__name min-w-0">
                        <span className="font-semibold text-ink">
                          {g.code ? <span className="mr-1.5 font-normal tabular-nums text-text-secondary">{g.code}</span> : null}
                          {g.title}
                        </span>
                        <span className="sv-datatable__hint">
                          {groupBy === "team" ? (g.owner?.fullName ?? "Руководитель команды") : g.team.name}
                          {parent ? `. Работает на ${parent.code ? parent.code : `«${parent.title}»`}` : ""}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="is-desktop max-w-[220px] whitespace-normal text-caption text-text-secondary">{g.metric ?? ""}</td>
                  <td className="is-num" data-label="База">
                    {g.base ?? <span className="sv-datatable__muted">нет</span>}
                  </td>
                  <td className="is-num" data-label="Целевое">
                    <span className="max-w-[180px] whitespace-normal">{g.target ?? <span className="sv-datatable__muted">нет</span>}</span>
                  </td>
                  <td className="is-num" data-label="Факт">
                    {g.fact ? (
                      <span className="flex flex-col items-end max-sm:items-start">
                        <span className="font-semibold text-ink">{g.fact.value}</span>
                        <span className={cn("text-caption", g.factStale ? "text-warning-ink" : "text-text-secondary")}>{dateFmt.format(new Date(g.fact.at))}</span>
                      </span>
                    ) : g.measurable && g.result === "IN_PROGRESS" ? (
                      <span className="text-caption text-warning-ink">не вписан</span>
                    ) : (
                      <span className="sv-datatable__muted">нет</span>
                    )}
                  </td>
                  <td data-label="Прогресс">
                    <Meter progress={g.numeric} risk={!!g.risk} />
                  </td>
                  <td data-label="Статус">
                    <Badge tone={status.tone} dot>
                      {status.label}
                    </Badge>
                  </td>
                  <td data-label="Задачи">
                    <span className="flex flex-col text-caption">
                      <span className="tabular-nums text-ink">{g.progress.total ? `закрыто ${g.progress.done} из ${g.progress.total}` : "нет задач"}</span>
                      {g.progress.overdue ? <span className="font-semibold text-danger-ink">просрочено {g.progress.overdue}</span> : null}
                    </span>
                  </td>
                  <td className="is-num is-action">
                    {(g.canMark || g.canEdit) && editing !== g.id ? (
                      <Button variant="soft" size="sm" onClick={() => setEditing(g.id)} aria-label={`Факт и целевое: ${g.title}`} data-testid={`goal-fact-${g.code ?? g.id}`}>
                        Факт
                      </Button>
                    ) : null}
                  </td>
                </tr>,
                editing === g.id ? (
                  <tr key={`${g.id}-edit`} className="sv-datatable__row--edit">
                    <td colSpan={COLS} className="is-wide">
                      <FactEditor
                        goal={g}
                        onClose={() => setEditing(null)}
                        onSaved={() => {
                          setEditing(null);
                          onChanged();
                        }}
                      />
                    </td>
                  </tr>
                ) : null,
                isOpen ? (
                  <tr key={`${g.id}-open`}>
                    <td colSpan={COLS} className="is-wide">
                      <GoalDetails goal={g} byId={byId} onEdit={onEdit} onMark={onMark} onAdd={onAdd} creatable={creatable} />
                    </td>
                  </tr>
                ) : null,
              ];
            }),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function GoalDetails({ goal: g, byId, onEdit, onMark, onAdd, creatable }: { goal: GoalNode; byId: Map<string, GoalNode>; onEdit: (g: GoalNode) => void; onMark: (g: GoalNode) => void; onAdd: (g: GoalNode) => void; creatable: boolean }) {
  const kids = g.childIds.map((id) => byId.get(id)).filter((x): x is GoalNode => !!x);
  return (
    <div className="grid gap-5 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" data-testid="goal-details">
      <div className="flex min-w-0 flex-col gap-3">
        {g.risk ? (
          <p className="inline-flex items-start gap-1.5 text-body font-semibold text-danger-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />В риске: {g.risk}
          </p>
        ) : null}
        <dl className="grid gap-x-6 gap-y-2 text-body sm:grid-cols-2">
          <div>
            <dt className="text-caption text-text-secondary">Команда</dt>
            <dd className="text-ink">{g.team.name}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">Владелец</dt>
            <dd className="text-ink">{g.owner?.fullName ?? "Руководитель команды"}</dd>
          </div>
          {g.metric ? (
            <div className="sm:col-span-2">
              <dt className="text-caption text-text-secondary">Метрика: как проверяем</dt>
              <dd className="whitespace-pre-line text-ink">{g.metric}</dd>
            </div>
          ) : null}
          {g.below.total ? (
            <div>
              <dt className="text-caption text-text-secondary">Цели ниже</dt>
              <dd className="text-ink">
                достигнуто {g.below.achieved} из {g.below.total}
              </dd>
            </div>
          ) : null}
        </dl>
        {g.description ? (
          <div>
            <p className="text-caption text-text-secondary">Описание</p>
            <p className="whitespace-pre-line text-body text-ink">{g.description}</p>
          </div>
        ) : null}
        {kids.length ? (
          <div>
            <p className="text-caption text-text-secondary">Цели ниже</p>
            <ul className="flex flex-col gap-1 text-body">
              {kids.map((k) => (
                <li key={k.id}>
                  <a href={`#goal-${k.id}`} className="text-ink hover:underline">
                    {k.code ? <span className="mr-1 tabular-nums text-text-secondary">{k.code}</span> : null}
                    {k.title}
                  </a>
                  <span className="ml-2 text-caption text-text-secondary">{k.team.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="text-caption text-text-secondary">Задачи цели</p>
          {g.tasks.length ? (
            <ul className="mt-1 flex flex-col gap-1.5">
              {g.tasks.map((t) => (
                <li key={t.number} className="flex flex-wrap items-baseline gap-x-2 text-body">
                  <Link href={`/tasks/${t.number}`} className={cn("hover:underline", t.done ? "text-text-secondary line-through decoration-1" : "text-ink")}>
                    <span className="mr-1 tabular-nums text-text-secondary">{t.number}</span>
                    {t.title}
                  </Link>
                  <span className="text-caption text-text-secondary">
                    {t.owner}, до {formatShort(t.due)}
                  </span>
                  {t.overdue ? <OverdueNote days={t.overdue} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body text-text-secondary">Задач у цели нет: привяжите задачи в их карточках, поле «Цель».</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {g.canMark ? (
            <Button variant="secondary" size="sm" onClick={() => onMark(g)}>
              Риск и итог
            </Button>
          ) : null}
          {g.canEdit ? (
            <Button variant="secondary" size="sm" onClick={() => onEdit(g)}>
              Изменить
            </Button>
          ) : null}
          {creatable ? (
            <Button variant="secondary" size="sm" onClick={() => onAdd(g)}>
              Цель ниже
            </Button>
          ) : null}
          {g.link ? (
            <a href={g.link} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 px-2 text-body text-link hover:underline">
              Борд
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-caption text-text-secondary">История факта</p>
        {g.facts.length ? (
          <ol className="mt-1 flex flex-col gap-2" data-testid="goal-facts">
            {g.facts.map((f) => (
              <li key={f.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
                <span className="text-body font-semibold text-ink">{f.value}</span>
                {f.note ? <span className="text-body text-ink">{f.note}</span> : null}
                <span className="text-caption text-text-secondary">
                  {f.by}, {fullFmt.format(new Date(f.at))}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-body text-text-secondary">{g.measurable ? "Факт ещё не вписан." : "Целевое значение не число: следите за итогом и риском."}</p>
        )}
      </div>
    </div>
  );
}

function FactEditor({ goal: g, onClose, onSaved }: { goal: GoalNode; onClose: () => void; onSaved: () => void }) {
  const { notify } = usePrototype();
  const [fact, setFact] = useState(g.fact?.value ?? "");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState(g.target ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = goalProgress(g.base, target, fact);
  const factChanged = g.canMark && fact.trim() !== "" && (fact.trim() !== (g.fact?.value ?? "") || note.trim() !== "");
  const targetChanged = g.canEdit && target.trim() !== (g.target ?? "");
  const id = `goal-${g.id}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!factChanged && !targetChanged) return setError(g.canMark ? "Впишите новый факт" : "Целевое значение не изменилось");
    setBusy(true);
    // Сначала целевое: факт проверяется по новым единицам целевого
    if (targetChanged) {
      const r = await updateGoalAction(g.id, { target: target.trim() || null });
      if (!r.ok) {
        setBusy(false);
        return setError(r.error);
      }
    }
    if (factChanged) {
      const r = await setGoalFactAction(g.id, fact.trim(), note.trim() || null);
      if (!r.ok) {
        setBusy(false);
        return setError(r.error);
      }
    }
    setBusy(false);
    notify(factChanged && targetChanged ? "Факт и целевое значение сохранены" : factChanged ? "Факт вписан" : "Целевое значение сохранено");
    onSaved();
  };

  return (
    <form className="flex flex-col gap-3 py-2" onSubmit={save} role="group" aria-label={`Факт и целевое: ${g.title}`} data-testid="goal-fact-editor">
      <div className="grid gap-3 sm:grid-cols-[minmax(140px,180px)_minmax(140px,200px)_1fr]">
        {g.canMark ? <TextInput id={`${id}-fact`} label="Факт" value={fact} onChange={(e) => setFact(e.target.value)} maxLength={120} autoComplete="off" placeholder="Например, 12,5%" hint={g.fact ? `Был: ${g.fact.value}` : undefined} autoFocus /> : null}
        {g.canEdit ? <TextInput id={`${id}-target`} label="Целевое значение" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} autoComplete="off" hint={g.base ? `База: ${g.base}` : undefined} /> : null}
        {g.canMark ? <TextInput id={`${id}-note`} label="Комментарий к факту" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoComplete="off" placeholder="Откуда цифра или что изменилось" /> : null}
      </div>
      <p className="flex flex-wrap items-center gap-2 text-body text-text-secondary" aria-live="polite">
        Прогресс: <Meter progress={preview} risk={!!g.risk} />
        {!preview && g.canMark ? <span className="text-caption">считается, когда целевое и факт числа в одних единицах</span> : null}
      </p>
      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={busy} data-testid="goal-fact-save">
          Сохранить
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Отмена
        </Button>
      </div>
    </form>
  );
}

export type { Run };
