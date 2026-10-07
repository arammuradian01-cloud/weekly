"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName, ownerName } from "@/domain/people";
import { DIRECTIONS, PRIORITIES, directionLabel, priorityOf } from "@/domain/dictionaries";
import { formatShort } from "@/domain/dates";
import { defaultOrder, isClosed, isDueThisWeek, isMine, isOverdue, isStale, overdueDays } from "@/domain/rules";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Chip, SelectField } from "@/components/ui/primitives";
import { OverdueNote, StaleNote } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { PrioritySelect, StateSelect, StatusSelect } from "./task-fields";
import { useOpenTask } from "./task-drawer";

type QuickFilter = "mine" | "overdue" | "critical" | "week" | "blocked" | "stale";
type GroupBy = "none" | "owner" | "direction" | "priority";

const QUICK: { key: QuickFilter; label: string }[] = [
  { key: "mine", label: "Мои" },
  { key: "overdue", label: "Просроченные" },
  { key: "critical", label: "Критичные" },
  { key: "week", label: "Срок на этой неделе" },
  { key: "blocked", label: "Заблокированные" },
  { key: "stale", label: "Давно не обновлялись" },
];

function matches(task: Task, q: string): boolean {
  if (!q) return true;
  const query = q.toLowerCase().trim();
  if (/^\d+$/.test(query)) return String(task.number) === query || task.title.toLowerCase().includes(query);
  return [task.title, task.outcome, task.where, ownerName(task.owner)].some((s) => s.toLowerCase().includes(query));
}

export function TaskList() {
  const { data, me, manageRole, teamPeople } = usePrototype();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [active, setActive] = useState<QuickFilter[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("owner");
  const [showClosed, setShowClosed] = useState(false);
  // Архив видит только владелец в режиме управления: отсюда он возвращает задачи (раздел 6 ТЗ)
  const [archive, setArchive] = useState(false);
  const archivedCount = data.teamTasks.filter((t) => t.archived).length;
  const today = data.today;

  const predicates: Record<QuickFilter, (t: Task) => boolean> = {
    mine: (t) => isMine(t, me.slug, me.role),
    overdue: (t) => isOverdue(t, today),
    critical: (t) => t.priority === "critical" && !isClosed(t),
    week: (t) => isDueThisWeek(t, today),
    blocked: (t) => t.state === "blocked" && !isClosed(t),
    stale: (t) => isStale(t, today),
  };

  const base = data.teamTasks.filter((t) => (archive ? t.archived : !t.archived));
  const counts = Object.fromEntries(QUICK.map((f) => [f.key, base.filter(predicates[f.key]).length])) as Record<QuickFilter, number>;

  const filtered = useMemo(
    () =>
      defaultOrder(
        base.filter((t) => (archive || showClosed || !isClosed(t)) && matches(t, q) && active.every((f) => predicates[f](t))),
        today,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.teamTasks, q, active, showClosed, archive, today, me.slug],
  );
  const closedCount = base.filter((t) => isClosed(t) && matches(t, q) && active.every((f) => predicates[f](t))).length;

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", title: "", tasks: filtered }];
    const keyOf = (t: Task) => (groupBy === "owner" ? t.owner : groupBy === "direction" ? t.direction : t.priority);
    // Порядок справочника, а в конце те, кого уже выключили или скрыли: их задачи не пропадают из списка
    const known =
      groupBy === "owner"
        ? [...teamPeople.map((p) => p.slug as string), "all"]
        : groupBy === "direction"
          ? DIRECTIONS.map((d) => d.code as string)
          : [...PRIORITIES.map((p) => p.code as string), "unset"];
    const order = [...new Set([...known, ...filtered.map((t) => keyOf(t) as string)])];
    const titleOf = (k: string) =>
      groupBy === "owner"
        ? ownerName(k as Task["owner"])
        : groupBy === "direction"
          ? directionLabel(k as Task["direction"])
          : priorityOf(k as Task["priority"]).label;
    return order
      .map((k) => ({ key: k, title: titleOf(k), tasks: filtered.filter((t) => keyOf(t) === k) }))
      .filter((g) => g.tasks.length > 0);
  }, [filtered, groupBy, teamPeople]);

  const toggle = (f: QuickFilter) => setActive((a) => (a.includes(f) ? a.filter((x) => x !== f) : [...a, f]));

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Быстрые фильтры">
          {QUICK.map((f) => (
            <Chip key={f.key} active={active.includes(f.key)} onClick={() => toggle(f.key)} count={counts[f.key]} tone={f.key === "overdue" ? "danger" : "default"}>
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative sm:w-72">
            <label htmlFor="task-search" className="sr-only">
              Поиск по тексту и номеру
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="task-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Текст или номер задачи"
              className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-body text-ink placeholder:text-muted/80 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
            />
          </div>
          <SelectField
            label="Группировать"
            id="group-by"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="sm:w-52"
            options={[
              { value: "owner", label: "По ответственному" },
              { value: "direction", label: "По направлению" },
              { value: "priority", label: "По приоритету" },
              { value: "none", label: "Без группировки" },
            ]}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-small text-muted">
        <p aria-live="polite">
          Показано {filtered.length} {active.length || q ? "по фильтрам" : archive ? "в архиве" : "открытых"}
          {active.length || q ? (
            <button
              type="button"
              onClick={() => {
                setActive([]);
                setQ("");
              }}
              className="ml-3 inline-flex items-center gap-1 font-medium text-blue-700 hover:underline"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Сбросить
            </button>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {archive ? null : (
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-ink">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-4 w-4 accent-blue-700" />
              Показать закрытые ({closedCount})
            </label>
          )}
          {manageRole === "OWNER" ? (
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-ink">
              <input type="checkbox" checked={archive} onChange={(e) => setArchive(e.target.checked)} className="h-4 w-4 accent-blue-700" />
              Архив ({archivedCount})
            </label>
          ) : null}
        </div>
      </div>

      {archive ? (
        <p className="mt-3 rounded-xl bg-surface px-5 py-3 text-body text-ink">Задачи в архиве. Откройте задачу и нажмите «Вернуть из архива», она снова появится в списке.</p>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyState title={archive ? "В архиве пусто" : base.length === 0 ? "В команде пока нет задач" : "Под эти фильтры задач нет"} className="mt-4">
          {archive
            ? "Сюда попадают задачи, которые владелец отправил в архив."
            : base.length === 0
              ? "Поставьте первую задачу кнопкой «Новая задача». Задачи других команд открываются переключателем команды в шапке."
              : "Снимите часть фильтров или поищите по номеру задачи."}
        </EmptyState>
      ) : (
        <TaskTable groups={groups} />
      )}
    </div>
  );
}

export function TaskTable({
  groups,
  showOwner = true,
  onOpen,
}: {
  groups: { key: string; title: string; tasks: Task[] }[];
  showOwner?: boolean;
  /** Своё действие по щелчку на задаче: образец компонентов не открывает карточку */
  onOpen?: (number: number) => void;
}) {
  const { data } = usePrototype();
  const { open: openTask } = useOpenTask();
  const open = onOpen ?? openTask;
  return (
    <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-line">
      {/* Ноутбук: таблица */}
      <table className="hidden w-full table-fixed text-left text-small lg:table">
        <caption className="sr-only">Задачи команды</caption>
        <colgroup>
          <col className="w-14" />
          <col />
          {showOwner ? <col className="w-[124px]" /> : null}
          <col className="w-[128px]" />
          <col className="w-[176px]" />
          <col className="w-[148px]" />
          <col className="w-[156px]" />
        </colgroup>
        <thead className="bg-surface text-caption text-muted">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">№</th>
            <th scope="col" className="px-2 py-2.5 font-medium">Задача и где сейчас</th>
            {showOwner ? <th scope="col" className="px-2 py-2.5 font-medium">Ответственный</th> : null}
            <th scope="col" className="px-2 py-2.5 font-medium">Приоритет</th>
            <th scope="col" className="px-2 py-2.5 font-medium">Статус</th>
            <th scope="col" className="px-2 py-2.5 font-medium">Состояние</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Срок</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.key} className="divide-y divide-line border-t border-line">
            {g.title ? (
              <tr className="bg-white">
                <th scope="colgroup" colSpan={showOwner ? 7 : 6} className="px-4 pb-2 pt-4 text-body font-semibold text-ink">
                  {g.title} <span className="font-normal text-muted">{g.tasks.length}</span>
                </th>
              </tr>
            ) : null}
            {g.tasks.map((t) => {
              const overdue = isOverdue(t, data.today);
              const stale = isStale(t, data.today);
              const closed = isClosed(t);
              return (
                <tr key={t.number} className={cn("align-top", overdue ? "bg-danger-soft" : "bg-white hover:bg-surface/60", closed && "text-muted")}>
                  <td className="px-4 py-3 tabular-nums text-muted">{t.number}</td>
                  <td className="px-2 py-3">
                    <button type="button" onClick={() => open(t.number)} className={cn("text-left text-body font-medium leading-snug hover:text-blue-700 hover:underline", closed ? "text-muted" : "text-ink")}>
                      {t.title}
                    </button>
                    <p className="mt-0.5 line-clamp-1 text-caption text-muted">{t.where}</p>
                    {stale ? <StaleNote className="mt-0.5 block" /> : null}
                  </td>
                  {showOwner ? <td className="px-2 py-3 text-ink">{t.owner === "all" ? "Все лидеры" : compactName(t.owner)}</td> : null}
                  <td className="px-2 py-2"><PrioritySelect task={t} /></td>
                  <td className="px-2 py-2"><StatusSelect task={t} /></td>
                  <td className="px-2 py-2"><StateSelect task={t} /></td>
                  <td className="px-3 py-3">
                    <span className={cn("tabular-nums", overdue ? "font-semibold text-danger-ink" : "text-ink")}>{formatShort(t.due)}</span>
                    {overdue ? <OverdueNote days={overdueDays(t, data.today)} className="block" /> : null}
                    {t.transfers.length ? <span className="block text-tiny text-muted">переносов {t.transfers.length}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>

      {/* Телефон и планшет: строки в одну колонку */}
      <div className="lg:hidden">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.title || "Задачи"}>
            {g.title ? (
              <h2 className="border-b border-line bg-surface px-4 py-2 text-body font-semibold text-ink">
                {g.title} <span className="font-normal text-muted">{g.tasks.length}</span>
              </h2>
            ) : null}
            <ul className="divide-y divide-line">
              {g.tasks.map((t) => {
                const overdue = isOverdue(t, data.today);
                return (
                  <li key={t.number} className={cn("px-4 py-3", overdue ? "bg-danger-soft" : "bg-white")}>
                    <button type="button" onClick={() => open(t.number)} className="block w-full text-left">
                      <span className="mr-1.5 tabular-nums text-muted">{t.number}</span>
                      <span className="text-body font-medium leading-snug text-ink">{t.title}</span>
                    </button>
                    <p className="mt-1 line-clamp-2 text-caption text-muted">{t.where}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5">
                      <StatusSelect task={t} />
                      <PrioritySelect task={t} />
                      <StateSelect task={t} />
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-caption text-muted">
                      {showOwner ? <span>{ownerName(t.owner, true)}</span> : null}
                      <span className={cn("tabular-nums", overdue && "font-semibold text-danger-ink")}>срок {formatShort(t.due)}</span>
                      {overdue ? <OverdueNote days={overdueDays(t, data.today)} /> : null}
                      {isStale(t, data.today) ? <StaleNote /> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
