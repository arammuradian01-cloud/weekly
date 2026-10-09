"use client";

// Список задач (этап 25, модуль М10): фильтры, группировка и сортировка живут в адресе страницы, виды сохраняются
// под именем, управление и руководители меняют статус, ответственного, срок и приоритет сразу у нескольких задач

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown, OctagonAlert, Repeat, Search, SquareCheck, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName, initials as personInitials, ownerName } from "@/domain/people";
import { greenOutside } from "@/lib/tasks/green-outside";
import { DIRECTIONS, PRIORITIES, directionLabel, priorityOf } from "@/domain/dictionaries";
import { formatShort } from "@/domain/dates";
import { isClosed, isOverdue, isStale, overdueDays } from "@/domain/rules";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Avatar, Chip, SelectField } from "@/components/ui/primitives";
import { GoalTag, GreenOutsideNote, LateWaits, OverdueNote, StaleNote } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { SavedViewDto } from "@/lib/views/service";
import { QUICK_FILTERS, DEFAULT_PARAMS, applyListParams, hasFilters, listParamsToQuery, parseListParams, quickPredicate, sortTasks, type ListParams, type QuickFilter, type SortDir, type SortKey } from "@/lib/tasks/list-params";
import { PrioritySelect, StateSelect, StatusSelect } from "./task-fields";
import { useOpenTask } from "./task-drawer";
import { SavedViews } from "./saved-views";
import { BulkBar, useBulkSelection } from "./bulk-actions";
import { checklistProgress } from "./task-checklist";

export function TaskList({ views = [] }: { views?: SavedViewDto[] }) {
  const { data, me, manageRole, manage, leads, teamPeople, observer, limited } = usePrototype();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = useMemo(() => parseListParams(new URLSearchParams(params.toString())), [params]);
  // Экран меняется сразу, адрес догоняет: пока router.replace в пути, действует местная копия параметров
  const [local, setLocal] = useState<ListParams | null>(null);
  useEffect(() => setLocal(null), [fromUrl]);
  const p = local ?? fromUrl;
  // Текст поиска набирается без ожидания ответа адреса: в адрес уходит с задержкой. Из адреса поле берётся только
  // при внешней навигации (ссылка, вид), а не после своего же ввода, иначе пропадали бы пробелы и буквы
  const [q, setQ] = useState(p.q);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef(p.q);
  useEffect(() => {
    if (fromUrl.q !== lastSent.current) {
      lastSent.current = fromUrl.q;
      setQ(fromUrl.q);
    }
  }, [fromUrl.q]);

  const setParams = useCallback(
    (patch: Partial<ListParams>) => {
      const next = { ...p, ...patch };
      // Архив виден только владельцу в режиме управления: в адрес не пишем у остальных
      if (manageRole !== "OWNER") next.archive = false;
      setLocal(next);
      const query = listParamsToQuery(next);
      const task = params.get("task");
      const full = [query, task ? `task=${encodeURIComponent(task)}` : ""].filter(Boolean).join("&");
      router.replace(full ? `${pathname}?${full}` : pathname, { scroll: false });
    },
    [p, params, pathname, router, manageRole],
  );
  const onQ = (value: string) => {
    setQ(value);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => {
      lastSent.current = value.trim();
      setParams({ q: value });
    }, 250);
  };

  const today = data.today;
  const archive = p.archive && manageRole === "OWNER";
  const base = data.teamTasks.filter((t) => (archive ? t.archived : !t.archived));
  const counts = Object.fromEntries(QUICK_FILTERS.map((f) => [f.key, base.filter(quickPredicate(f.key, me, today)).length])) as Record<QuickFilter, number>;
  const archivedCount = data.teamTasks.filter((t) => t.archived).length;

  const filtered = useMemo(() => sortTasks(applyListParams(data.teamTasks, { ...p, archive }, me, today), p.sort, p.dir, today), [data.teamTasks, p, archive, me, today]);
  const closedCount = useMemo(() => applyListParams(data.teamTasks, { ...p, archive, closed: true }, me, today).filter((t) => isClosed(t)).length, [data.teamTasks, p, archive, me, today]);

  const groups = useMemo(() => {
    if (p.group === "none") return [{ key: "all", title: "", tasks: filtered }];
    // По цели (этап 31): цели в порядке кода, задачи без цели в конце
    if (p.group === "goal") {
      const goals = new Map<string, NonNullable<Task["goal"]>>();
      for (const t of filtered) if (t.goal) goals.set(t.goal.id, t.goal);
      const ordered = [...goals.values()].sort((a, b) => a.title.localeCompare(b.title, "ru", { numeric: true }));
      return [
        ...ordered.map((g) => ({ key: g.id, title: `Цель ${g.title}`, tasks: filtered.filter((t) => t.goal?.id === g.id) })),
        { key: "no-goal", title: "Без цели", tasks: filtered.filter((t) => !t.goal) },
      ].filter((g) => g.tasks.length > 0);
    }
    const keyOf = (t: Task) => (p.group === "owner" ? t.owner : p.group === "direction" ? t.direction : t.priority);
    // Порядок справочника, а в конце те, кого уже выключили или скрыли: их задачи не пропадают из списка
    const known =
      p.group === "owner"
        ? [...teamPeople.map((x) => x.slug as string), "all"]
        : p.group === "direction"
          ? DIRECTIONS.map((d) => d.code as string)
          : [...PRIORITIES.map((x) => x.code as string), "unset"];
    const order = [...new Set([...known, ...filtered.map((t) => keyOf(t) as string)])];
    const titleOf = (k: string) =>
      p.group === "owner" ? ownerName(k as Task["owner"]) : p.group === "direction" ? directionLabel(k as Task["direction"]) : priorityOf(k as Task["priority"]).label;
    return order.map((k) => ({ key: k, title: titleOf(k), tasks: filtered.filter((t) => keyOf(t) === k) })).filter((g) => g.tasks.length > 0);
  }, [filtered, p.group, teamPeople]);

  const toggle = (f: QuickFilter) => setParams({ filters: p.filters.includes(f) ? p.filters.filter((x) => x !== f) : [...p.filters, f] });
  const sortBy = (key: SortKey) => {
    if (p.sort !== key) return setParams({ sort: key, dir: key === "updated" ? "desc" : "asc" });
    if (p.dir === "asc") return setParams({ dir: "desc" });
    setParams({ sort: null, dir: "asc" });
  };
  const reset = () => {
    if (qTimer.current) clearTimeout(qTimer.current);
    lastSent.current = "";
    setQ("");
    setParams({ ...DEFAULT_PARAMS, archive: p.archive });
  };
  const active = hasFilters(p);
  const query = listParamsToQuery({ ...p, archive: false });

  // Массовые действия (этап 25): управление и руководители команд, не при общем логине
  const canBulk = !observer && !limited && (manage || leads.length > 0);
  const bulk = useBulkSelection(filtered);

  const ownerOptions = [{ value: "", label: "Все ответственные" }, ...teamPeople.map((x) => ({ value: x.slug, label: x.fullName })), { value: "all", label: "Все лидеры (общие)" }];
  if (p.owner && !ownerOptions.some((o) => o.value === p.owner)) ownerOptions.push({ value: p.owner, label: ownerName(p.owner) });

  return (
    <div>
      <SavedViews views={views} path="/tasks" current={query} canSave={active && !limited} />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Быстрые фильтры">
          {QUICK_FILTERS.map((f) => (
            <Chip key={f.key} active={p.filters.includes(f.key)} onClick={() => toggle(f.key)} count={counts[f.key]} tone={f.key === "overdue" ? "danger" : "default"}>
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="relative sm:w-64">
            <label htmlFor="task-search" className="sr-only">
              Поиск по тексту и номеру
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
            <input
              id="task-search"
              type="search"
              value={q}
              onChange={(e) => onQ(e.target.value)}
              placeholder="Текст или номер задачи"
              className="sv-control h-11 w-full pl-9 pr-3 text-body"
            />
          </div>
          <SelectField label="Ответственный" id="filter-owner" value={p.owner ?? ""} onChange={(e) => setParams({ owner: e.target.value || null })} className="sm:w-52" options={ownerOptions} />
          <SelectField
            label="Группировать"
            id="group-by"
            value={p.group}
            onChange={(e) => setParams({ group: e.target.value as ListParams["group"] })}
            className="sm:w-48"
            options={[
              { value: "owner", label: "По ответственному" },
              { value: "direction", label: "По направлению" },
              { value: "goal", label: "По цели" },
              { value: "priority", label: "По приоритету" },
              { value: "none", label: "Без группировки" },
            ]}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-small text-muted">
        <p aria-live="polite">
          Показано {filtered.length} {active ? "по фильтрам" : archive ? "в архиве" : "открытых"}
          {active ? (
            <button type="button" onClick={reset} className="ml-3 inline-flex items-center gap-1 font-medium text-blue-700 hover:underline">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Сбросить
            </button>
          ) : null}
          {p.sort ? <span className="ml-3">Сортировка: {SORT_LABELS[p.sort]}{p.dir === "desc" ? ", по убыванию" : ""}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {archive ? null : (
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-ink">
              <input type="checkbox" checked={p.closed} onChange={(e) => setParams({ closed: e.target.checked })} className="h-4 w-4 accent-blue-700" />
              Показать закрытые ({closedCount})
            </label>
          )}
          {manageRole === "OWNER" ? (
            <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-ink">
              <input type="checkbox" checked={archive} onChange={(e) => setParams({ archive: e.target.checked })} className="h-4 w-4 accent-blue-700" />
              Архив ({archivedCount})
            </label>
          ) : null}
        </div>
      </div>

      {archive ? (
        <p className="mt-3 sv-card sv-card--soft px-5 py-3 text-body text-ink">Задачи в архиве. Откройте задачу и нажмите «Вернуть из архива», она снова появится в списке.</p>
      ) : null}
      {filtered.length === 0 ? (
        <EmptyState
          title={archive ? "В архиве пусто" : base.length === 0 ? "В команде пока нет задач" : "Под эти фильтры задач нет"}
          className="mt-4"
          action={
            // Этап 36: у пустого списка по фильтрам одно действие, вернуть все задачи
            !archive && base.length > 0 ? (
              <Button size="sm" variant="secondary" onClick={reset}>
                Показать все задачи
              </Button>
            ) : undefined
          }
        >
          {archive
            ? "Сюда попадают задачи, которые владелец отправил в архив."
            : base.length === 0
              ? "Поставьте первую задачу кнопкой «Новая задача». Задачи других команд открываются переключателем команды в шапке."
              : "Снимите часть фильтров или поищите по номеру задачи."}
        </EmptyState>
      ) : (
        <TaskTable groups={groups} sort={p.sort} dir={p.dir} onSort={sortBy} selection={canBulk && !archive ? bulk : undefined} />
      )}
      {canBulk && !archive ? <BulkBar selection={bulk} tasks={filtered} /> : null}
    </div>
  );
}

const SORT_LABELS: Record<SortKey, string> = { number: "по номеру", title: "по названию", owner: "по ответственному", priority: "по приоритету", status: "по статусу", due: "по сроку", updated: "по обновлению" };

export type Selection = { selected: Set<number>; toggle: (n: number) => void; toggleMany: (ns: number[], on: boolean) => void; clear: () => void };

function SortHeader({ label, k, sort, dir, onSort, className }: { label: string; k: SortKey; sort: SortKey | null; dir: SortDir; onSort?: (k: SortKey) => void; className?: string }) {
  const activeSort = sort === k;
  const Icon = activeSort ? (dir === "asc" ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={activeSort ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn(onSort && "is-sortable", activeSort && "is-sorted", className)}>
      {onSort ? (
        <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-0.5 rounded hover:text-ink">
          {label}
          <Icon className={cn("ml-0.5 h-3.5 w-3.5", activeSort ? "text-link" : "text-icon")} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function TaskTable({
  groups,
  showOwner = true,
  onOpen,
  sort = null,
  dir = "asc",
  onSort,
  selection,
}: {
  groups: { key: string; title: string; tasks: Task[] }[];
  showOwner?: boolean;
  /** Своё действие по щелчку на задаче: образец компонентов не открывает карточку */
  onOpen?: (number: number) => void;
  sort?: SortKey | null;
  dir?: SortDir;
  /** Щелчок по заголовку колонки меняет сортировку (этап 25) */
  onSort?: (k: SortKey) => void;
  /** Флажки для массовых действий (этап 25) */
  selection?: Selection;
}) {
  const { data } = usePrototype();
  const { open: openTask } = useOpenTask();
  const open = onOpen ?? openTask;
  const cols = (showOwner ? 7 : 6) + (selection ? 1 : 0);
  return (
    <div className="mt-4">
      {/* Ноутбук: таблица по дизайн-системе (tasks/TaskTable.jsx): залипающая шапка, группы, подсветка просрочки */}
      <div className="sv-table-wrap hidden lg:block">
      <table className="sv-table table-fixed">
        <caption className="sr-only">Задачи команды</caption>
        <colgroup>
          {selection ? <col className="w-10" /> : null}
          <col className="w-14" />
          <col />
          {showOwner ? <col className="w-[156px]" /> : null}
          <col className="w-[128px]" />
          <col className="w-[176px]" />
          <col className="w-[148px]" />
          <col className="w-[164px]" />
        </colgroup>
        <thead>
          <tr>
            {selection ? (
              <th scope="col" className="is-check">
                <span className="sr-only">Выбрать</span>
              </th>
            ) : null}
            <SortHeader label="№" k="number" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader label="Задача и где сейчас" k="title" sort={sort} dir={dir} onSort={onSort} />
            {showOwner ? <SortHeader label="Ответственный" k="owner" sort={sort} dir={dir} onSort={onSort} /> : null}
            <SortHeader label="Приоритет" k="priority" sort={sort} dir={dir} onSort={onSort} />
            <SortHeader label="Статус" k="status" sort={sort} dir={dir} onSort={onSort} />
            <th scope="col">Состояние</th>
            <SortHeader label="Срок" k="due" sort={sort} dir={dir} onSort={onSort} />
          </tr>
        </thead>
        {groups.map((g) => {
          const numbers = g.tasks.map((t) => t.number);
          const allOn = selection ? numbers.every((n) => selection.selected.has(n)) : false;
          return (
            <tbody key={g.key}>
              {g.title ? (
                <tr className="sv-table__group">
                  {selection ? (
                    <td className="is-check">
                      <input type="checkbox" checked={allOn} onChange={(e) => selection.toggleMany(numbers, e.target.checked)} aria-label={`Выбрать все: ${g.title}`} className="h-4 w-4" />
                    </td>
                  ) : null}
                  <th scope="colgroup" colSpan={cols - (selection ? 1 : 0)} className="!static !h-8 !border-b !bg-canvas !px-3 !text-caption">
                    {g.title}
                    <span className="sv-counter sv-counter--neutral ml-1.5">{g.tasks.length}</span>
                  </th>
                </tr>
              ) : null}
              {g.tasks.map((t) => {
                const overdue = isOverdue(t, data.today);
                const stale = isStale(t, data.today);
                const closed = isClosed(t);
                const picked = selection?.selected.has(t.number) ?? false;
                const progress = checklistProgress(t);
                const outside = !!greenOutside(t, data.today);
                return (
                  <tr key={t.number} className={cn("!cursor-default", picked && "is-selected", overdue && !closed && "is-overdue", closed && "is-closed", outside && "is-outside")}>
                    {selection ? (
                      <td className="is-check">
                        <input type="checkbox" checked={picked} onChange={() => selection.toggle(t.number)} aria-label={`Выбрать задачу ${t.number}`} className="h-4 w-4" />
                      </td>
                    ) : null}
                    <td className="is-id">{t.number}</td>
                    <td className="!whitespace-normal py-2">
                      <div className="sv-task">
                        <button type="button" onClick={() => open(t.number)} className="sv-task__title !max-w-none text-left hover:text-link" title={t.title}>
                          {t.state === "blocked" ? <OctagonAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-label="Заблокирована" /> : null}
                          <span className="truncate">{t.title}</span>
                        </button>
                        <span className={cn("sv-task__now !max-w-none", !t.where && !progress && "sv-task__now--empty")}>
                          {progress ? (
                            <span className="mr-2 inline-flex items-center gap-1 tabular-nums">
                              <SquareCheck className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
                              {progress.done}/{progress.total}
                            </span>
                          ) : null}
                          {t.repeat?.active ? <Repeat className="mr-1.5 inline h-3 w-3" strokeWidth={1.75} aria-label="Повторяется" /> : null}
                          {t.where || (progress ? "" : "Где сейчас: не заполнено")}
                        </span>
                        {stale ? <StaleNote className="block" /> : null}
                        <LateWaits task={t} className="block" />
                        <GreenOutsideNote task={t} today={data.today} className="block" />
                        {t.goal ? <GoalTag goal={t.goal} className="mt-1 self-start" /> : null}
                      </div>
                    </td>
                    {showOwner ? (
                      <td>
                        {t.owner === "all" ? (
                          <span className="sv-cell-person text-text-secondary">Все лидеры</span>
                        ) : (
                          <span className="sv-cell-person min-w-0">
                            <Avatar text={personInitials(t.owner)} name={ownerName(t.owner)} size="sm" />
                            <span className="truncate">{compactName(t.owner)}</span>
                          </span>
                        )}
                      </td>
                    ) : null}
                    <td><PrioritySelect task={t} /></td>
                    <td><StatusSelect task={t} /></td>
                    <td><StateSelect task={t} /></td>
                    <td className="!whitespace-normal">
                      <span className={cn("sv-due block", overdue && !closed && "!font-semibold !text-danger-ink")}>{formatShort(t.due)}</span>
                      {overdue && !closed ? <OverdueNote days={overdueDays(t, data.today)} /> : null}
                      {t.transfers.length ? <span className="block text-caption text-text-secondary">переносов {t.transfers.length}</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>
      </div>

      {/* Телефон и планшет: строки в одну колонку */}
      <div className="sv-table-wrap lg:hidden">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.title || "Задачи"}>
            {g.title ? (
              <h2 className="border-b border-line bg-canvas px-4 py-2 text-caption font-semibold text-text-secondary">
                {g.title} <span className="sv-counter sv-counter--neutral ml-1">{g.tasks.length}</span>
              </h2>
            ) : null}
            <ul className="divide-y divide-line">
              {g.tasks.map((t) => {
                const overdue = isOverdue(t, data.today);
                const picked = selection?.selected.has(t.number) ?? false;
                const progress = checklistProgress(t);
                return (
                  <li key={t.number} className={cn("flex gap-3 px-4 py-3", picked ? "bg-[var(--color-row-selected)]" : overdue ? "bg-[var(--color-row-overdue)]" : "bg-surface")}>
                    {selection ? <input type="checkbox" checked={picked} onChange={() => selection.toggle(t.number)} aria-label={`Выбрать задачу ${t.number}`} className="mt-1.5 h-4 w-4 shrink-0" /> : null}
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => open(t.number)} className="block w-full text-left">
                        <span className="mr-1.5 tabular-nums text-muted">{t.number}</span>
                        <span className="text-body font-semibold leading-snug text-ink">{t.title}</span>
                      </button>
                      <p className="mt-1 line-clamp-2 text-caption text-muted">
                        {progress ? <span className="mr-2 tabular-nums">☑ {progress.done}/{progress.total}</span> : null}
                        {t.where}
                      </p>
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
                        <LateWaits task={t} />
                        <GreenOutsideNote task={t} today={data.today} />
                        {t.goal ? <GoalTag goal={t.goal} /> : null}
                      </p>
                    </div>
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
