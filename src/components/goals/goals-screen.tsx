"use client";

// Страница «Цели» (этап 17): дерево целей квартала от целей департамента до команд и людей.
// У цели прогресс по задачам и целям ниже, риск с причиной, итог квартала. Ниже доля задач без цели по командам.

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Plus, Upload } from "lucide-react";
import type { GoalNode, GoalsPlan, GoalsView } from "@/lib/goals/service";
import type { GoalResult } from "@/generated/prisma/enums";
import { quarterLabel } from "@/lib/goals/parse";
import { usePrototype } from "@/domain/store";
import { allPeople } from "@/domain/people";
import { teamOf, teamPeople } from "@/domain/teams";
import { formatShort } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Drawer, Modal } from "@/components/ui/overlays";
import { Segmented, SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import { OverdueNote } from "@/components/ui/task-badges";
import {
  applyBordGoalsAction,
  applyGoalsAction,
  createGoalAction,
  deleteGoalAction,
  previewBordGoalsAction,
  previewGoalsAction,
  updateGoalAction,
} from "@/app/(app)/goals/actions";

const RESULTS: { value: GoalResult; label: string }[] = [
  { value: "IN_PROGRESS", label: "Идёт" },
  { value: "ACHIEVED", label: "Достигнута" },
  { value: "PARTIAL", label: "Частично" },
  { value: "MISSED", label: "Не достигнута" },
  { value: "DROPPED", label: "Снята" },
];
const RESULT_TONE: Record<GoalResult, string> = {
  IN_PROGRESS: "bg-blue-soft text-blue-700",
  ACHIEVED: "bg-green-soft text-green-ink",
  PARTIAL: "bg-warning-soft text-warning-ink",
  MISSED: "bg-danger-soft text-danger-ink",
  DROPPED: "bg-field text-muted",
};

type Run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void;

export function GoalsScreen({ view, defaultTeam, bordTabs }: { view: GoalsView; defaultTeam: string | null; bordTabs: string[] | null }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [, start] = useTransition();
  const [creating, setCreating] = useState<{ parent?: GoalNode } | null>(null);
  const [editing, setEditing] = useState<GoalNode | null>(null);
  const [marking, setMarking] = useState<GoalNode | null>(null);
  const [importing, setImporting] = useState(false);
  const byId = new Map(view.goals.map((g) => [g.id, g]));
  const run: Run = (fn, ok) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) notify(r.error ?? "Не получилось", "error");
      else {
        notify(ok);
        router.refresh();
      }
    });
  const atRisk = view.goals.filter((g) => g.risk).length;
  const achieved = view.goals.filter((g) => g.result === "ACHIEVED").length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SelectField
          label="Квартал"
          id="goals-quarter"
          value={view.quarter}
          onChange={(e) => router.push(`/goals?q=${e.target.value}`)}
          options={view.quarters.map((q) => ({ value: q, label: quarterLabel(q) }))}
          className="sm:w-44"
        />
        {view.creatable.length ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Загрузить цели
            </Button>
            <Button size="sm" onClick={() => setCreating({})}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Новая цель
            </Button>
          </div>
        ) : null}
      </div>

      {view.goals.length ? (
        <>
          <p className="text-body text-ink">
            Целей {view.goals.length}, в риске <span className={atRisk ? "font-semibold text-danger-ink" : ""}>{atRisk}</span>, достигнуто {achieved}
          </p>
          <ul className="flex flex-col gap-3" aria-label="Дерево целей">
            {view.roots.map((id) => (
              <GoalItem key={id} goal={byId.get(id)!} byId={byId} depth={0} onEdit={setEditing} onMark={setMarking} onAdd={(parent) => setCreating({ parent })} creatable={view.creatable.length > 0} />
            ))}
          </ul>
        </>
      ) : (
        <EmptyState title={`Целей на ${quarterLabel(view.quarter)} пока нет`}>
          {view.creatable.length ? "Заведите цель кнопкой «Новая цель» или загрузите вкладку целей из борда." : "Цели заводят руководители команд и владелец."}
        </EmptyState>
      )}

      {view.unlinked.length ? (
        <section aria-labelledby="unlinked" className="rounded-xl border border-line p-4">
          <h2 id="unlinked" className="text-title-sm font-semibold text-ink">
            Задачи без цели
          </h2>
          <p className="mt-1 text-small text-muted">Открытые задачи команд, которые не работают ни на одну цель. Задачи с высоким приоритетом должны работать на цель квартала</p>
          <ul className="mt-3 flex flex-col gap-1.5">
            {view.unlinked.map((u) => (
              <li key={u.team} className="flex flex-wrap items-baseline justify-between gap-x-4 text-small">
                <span className="text-ink">{u.name}</span>
                <span className="text-muted">
                  без цели {u.withoutGoal} из {u.open} ({Math.round((u.withoutGoal / u.open) * 100)}%)
                  {u.highWithoutGoal ? <span className="ml-2 font-medium text-danger-ink">с высоким приоритетом {u.highWithoutGoal}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {creating ? (
        <GoalModal
          mode="create"
          parent={creating.parent}
          quarter={view.quarter}
          teams={view.creatable}
          // Цель ниже по умолчанию в команде цели выше, если человек её ведёт, иначе в своей команде
          defaultTeam={creating.parent && view.creatable.some((t) => t.id === creating.parent!.team.id) ? creating.parent.team.id : defaultTeam}
          goals={view.goals}
          onClose={() => setCreating(null)}
          run={run}
        />
      ) : null}
      {editing ? <GoalModal mode="edit" goal={editing} quarter={view.quarter} teams={view.creatable} defaultTeam={editing.team.id} goals={view.goals} onClose={() => setEditing(null)} run={run} /> : null}
      {marking ? <MarkModal goal={marking} onClose={() => setMarking(null)} run={run} /> : null}
      {importing ? <ImportDrawer teams={view.creatable} defaultTeam={defaultTeam} quarter={view.quarter} bordTabs={bordTabs} onClose={() => setImporting(false)} /> : null}
    </div>
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
    <li id={`goal-${g.id}`} className={cn("rounded-xl border border-line bg-surface", depth > 0 && "border-l-4 border-l-blue-soft")}>
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
              {g.result !== "IN_PROGRESS" ? <span className={cn("rounded-md px-2 py-0.5 text-caption font-medium", RESULT_TONE[g.result])}>{RESULTS.find((r) => r.value === g.result)!.label}</span> : null}
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

function GoalModal({
  mode,
  goal,
  parent,
  quarter,
  teams,
  defaultTeam,
  goals,
  onClose,
  run,
}: {
  mode: "create" | "edit";
  goal?: GoalNode;
  parent?: GoalNode;
  quarter: string;
  teams: { id: string; name: string }[];
  defaultTeam: string | null;
  goals: GoalNode[];
  onClose: () => void;
  run: Run;
}) {
  const [team, setTeam] = useState(goal?.team.id ?? (defaultTeam && teams.some((x) => x.id === defaultTeam) ? defaultTeam : (teams[0]?.id ?? "")));
  const [title, setTitle] = useState(goal?.title ?? "");
  const [code, setCode] = useState(goal?.code ?? "");
  const [metric, setMetric] = useState(goal?.metric ?? "");
  const [base, setBase] = useState(goal?.base ?? "");
  const [target, setTarget] = useState(goal?.target ?? "");
  const [link, setLink] = useState(goal?.link ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [parentId, setParentId] = useState(goal?.parentId ?? parent?.id ?? "");
  const t = teamOf(team);
  const people = t ? allPeople().filter((p) => p.active && teamPeople(t).includes(p.slug)) : allPeople().filter((p) => p.active);
  const [owner, setOwner] = useState(goal?.owner?.slug ?? t?.leader ?? "");
  const parents = goals.filter((g) => g.id !== goal?.id);
  const deletable = mode === "edit" && goal && !goal.tasks.length && !goal.childIds.length;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={mode === "create" ? `Новая цель на ${quarterLabel(quarter)}` : "Изменить цель"} description="Цель одной мыслью, метрика и целевое значение. Сами цифры живут в бордах и недельном отчёте">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const input = { title, code: code || null, metric: metric || null, base: base || null, target: target || null, link: link || null, description: description || null, owner: owner || null, parent: parentId || null };
          if (mode === "create") run(() => createGoalAction({ ...input, quarter, team }), "Цель заведена");
          else run(() => updateGoalAction(goal!.id, input), "Цель сохранена");
          onClose();
        }}
      >
        {mode === "create" ? <SelectField label="Команда" id="g-team" value={team} onChange={(e) => setTeam(e.target.value)} options={teams.map((x) => ({ value: x.id, label: x.name }))} /> : null}
        <TextInput label="Цель" id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} required />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput label="Номер" id="g-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} hint="Как в борде, если есть" />
          <TextInput label="База" id="g-base" value={base} onChange={(e) => setBase(e.target.value)} maxLength={120} />
          <TextInput label="Целевое значение" id="g-target" value={target} onChange={(e) => setTarget(e.target.value)} maxLength={300} />
        </div>
        <TextInput label="Метрика" id="g-metric" value={metric} onChange={(e) => setMetric(e.target.value)} maxLength={500} hint="Как проверяем" />
        <SelectField label="Владелец" id="g-owner" value={owner} onChange={(e) => setOwner(e.target.value)} options={[{ value: "", label: "Руководитель команды" }, ...people.map((p) => ({ value: p.slug, label: p.fullName }))]} />
        <SelectField
          label="Цель выше"
          id="g-parent"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          options={[{ value: "", label: "Нет: цель верхнего уровня" }, ...parents.map((g) => ({ value: g.id, label: `${g.team.name}: ${g.code ? `${g.code}. ` : ""}${g.title}` }))]}
        />
        <TextInput label="Ссылка на строку в борде" id="g-link" value={link} onChange={(e) => setLink(e.target.value)} maxLength={500} placeholder="https://docs.google.com/spreadsheets/..." />
        <TextArea label="Описание" id="g-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        <div className="flex flex-wrap justify-between gap-2">
          {deletable ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                run(() => deleteGoalAction(goal!.id), "Цель удалена");
                onClose();
              }}
            >
              Удалить цель
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={!title.trim() || !team}>
              {mode === "create" ? "Завести цель" : "Сохранить"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function MarkModal({ goal, onClose, run }: { goal: GoalNode; onClose: () => void; run: Run }) {
  const [atRisk, setAtRisk] = useState(goal.atRisk);
  const [note, setNote] = useState(goal.riskNote ?? "");
  const [result, setResult] = useState<GoalResult>(goal.result);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Риск и итог квартала" description={goal.title}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateGoalAction(goal.id, { atRisk, riskNote: atRisk ? note : null, result }), "Цель отмечена");
          onClose();
        }}
      >
        <label className="flex items-start gap-3 text-body text-ink">
          <input type="checkbox" checked={atRisk} onChange={(e) => setAtRisk(e.target.checked)} className="mt-1 h-4 w-4 accent-blue-700" />
          <span>
            Цель в риске
            <span className="block text-small text-muted">Красный статус безопасен: на риск отвечаем помощью</span>
          </span>
        </label>
        {atRisk ? <TextInput label="Почему в риске и какая помощь нужна" id="g-risk" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required /> : null}
        <SelectField label="Итог квартала" id="g-result" value={result} onChange={(e) => setResult(e.target.value as GoalResult)} options={RESULTS} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportDrawer({ teams, defaultTeam, quarter, bordTabs, onClose }: { teams: { id: string; name: string }[]; defaultTeam: string | null; quarter: string; bordTabs: string[] | null; onClose: () => void }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [source, setSource] = useState<"paste" | "bord">("paste");
  const [team, setTeam] = useState(defaultTeam && teams.some((t) => t.id === defaultTeam) ? defaultTeam : (teams[0]?.id ?? ""));
  const [text, setText] = useState("");
  const [tab, setTab] = useState("");
  const [plan, setPlan] = useState<GoalsPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const check = () =>
    start(async () => {
      setError(null);
      const r = source === "paste" ? await previewGoalsAction(text, team, quarter) : await previewBordGoalsAction(tab, team, quarter);
      if (r.ok) setPlan(r.value);
      else {
        setPlan(null);
        setError(r.error);
      }
    });
  const apply = () =>
    start(async () => {
      const r = source === "paste" ? await applyGoalsAction(text, team, quarter) : await applyBordGoalsAction(tab, team, quarter);
      if (!r.ok) return setError(r.error);
      notify(`Цели загружены: новых ${r.value.added}, изменено ${r.value.changed}`);
      onClose();
      router.refresh();
    });
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title="Загрузить цели"
      description="Вкладка целей из борда лидера или своя таблица. Сначала проверка: база меняется только по кнопке «Загрузить»"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="secondary" disabled={pending || (source === "paste" ? !text.trim() : !tab.trim())} onClick={check}>
            Проверить
          </Button>
          <Button disabled={!plan || plan.problems.length > 0 || pending} onClick={apply}>
            {pending ? "Подождите…" : "Загрузить"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {bordTabs ? (
          <Segmented
            label="Откуда"
            value={source}
            onChange={(v) => {
              setSource(v);
              setPlan(null);
            }}
            options={[
              { value: "paste", label: "Вставить ячейки" },
              { value: "bord", label: "Вкладка Bord" },
            ]}
          />
        ) : null}
        <SelectField label="Команда для целей без колонки «Команда»" id="gi-team" value={team} onChange={(e) => setTeam(e.target.value)} options={teams.map((t) => ({ value: t.id, label: t.name }))} />
        <p className="text-small text-muted">
          Читаются колонки: № или ID, Квартал, Команда, Владелец, Цель или «Запланировано», Метрика или «Как проверяем», База или Start, Целевое значение или «Целевые», Родительская цель или «Сквозная цель», Ссылка, Итог или «Закрытие». Разделы «Запланировано на Q4 2026» задают квартал, договорённости и бэклог не читаются. Без квартала цели идут в {quarterLabel(quarter)}.
        </p>
        {source === "paste" ? (
          <TextArea label="Ячейки из таблицы" id="gi-text" value={text} onChange={(e) => setText(e.target.value)} rows={8} hint="Выделите вкладку вместе со строкой заголовков, скопируйте и вставьте" />
        ) : (
          <div className="flex flex-col gap-1.5">
            <TextInput label="Вкладка целей в Bord" id="gi-tab" value={tab} onChange={(e) => setTab(e.target.value)} list="gi-tabs" hint="Ресурс только читает вкладку тем же служебным аккаунтом, что и задачи" />
            <datalist id="gi-tabs">
              {bordTabs!.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
        )}
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-small text-danger-ink">
            {error}
          </p>
        ) : null}
        {plan ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <p className="text-body text-ink">
              Новых целей {plan.add.length}, изменится {plan.change.length}, без изменений {plan.same}
            </p>
            {plan.problems.length ? (
              <ul className="flex list-disc flex-col gap-0.5 rounded-lg bg-danger-soft py-3 pl-8 pr-4 text-small text-danger-ink">
                {plan.problems.map((p, i) => (
                  <li key={i}>
                    Строка {p.line}: {p.text}
                  </li>
                ))}
              </ul>
            ) : null}
            {plan.add.length ? (
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-ink">
                {plan.add.map((a) => (
                  <li key={a.line}>
                    {quarterLabel(a.quarter)}, {a.team}: {a.code ? `${a.code}. ` : ""}
                    {a.title}
                  </li>
                ))}
              </ul>
            ) : null}
            {plan.change.length ? (
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-small text-ink">
                {plan.change.map((c) => (
                  <li key={c.line}>
                    {c.title}: {c.changes.join("; ")}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
