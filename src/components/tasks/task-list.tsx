"use client";

// Список задач (этап 25, модуль М10): фильтры, группировка и сортировка живут в адресе страницы, виды сохраняются
// под именем, управление и руководители меняют статус, ответственного, срок и приоритет сразу у нескольких задач

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName, ownerName } from "@/domain/people";
import { DIRECTIONS, PRIORITIES, directionLabel, priorityOf } from "@/domain/dictionaries";
import { formatShort } from "@/domain/dates";
import { isClosed, isOverdue, isStale, overdueDays } from "@/domain/rules";
import type { Task } from "@/domain/types";
import { cn } from "@/lib/cn";
import { Chip, SelectField } from "@/components/ui/primitives";
import { GreenOutsideNote, LateWaits, OverdueNote, StaleNote } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
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
              className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-body text-ink placeholder:text-muted/80 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
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
  const Icon = activeSort ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th scope="col" aria-sort={activeSort ? (dir === "asc" ? "ascending" : "descending") : "none"} className={cn("py-2.5 font-medium", className)}>
      {onSort ? (
        <button type="button" onClick={() => onSort(k)} className={cn("group inline-flex items-center gap-1 rounded hover:text-ink", activeSort && "text-ink")}>
          {label}
          <Icon className={cn("h-3.5 w-3.5", activeSort ? "text-blue-700" : "text-muted/50 group-hover:text-muted")} aria-hidden="true" />
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
    <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-line">
      {/* Ноутбук: таблица */}
      <table className="hidden w-full table-fixed text-left text-small lg:table">
        <caption className="sr-only">Задачи команды</caption>
        <colgroup>
          {selection ? <col className="w-11" /> : null}
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
            {selection ? (
              <th scope="col" className="px-3 py-2.5">
                <span className="sr-only">Выбрать</span>
              </th>
            ) : null}
            <SortHeader label="№" k="number" sort={sort} dir={dir} onSort={onSort} className="px-4" />
            <SortHeader label="Задача и где сейчас" k="title" sort={sort} dir={dir} onSort={onSort} className="px-2" />
            {showOwner ? <SortHeader label="Ответственный" k="owner" sort={sort} dir={dir} onSort={onSort} className="px-2" /> : null}
            <SortHeader label="Приоритет" k="priority" sort={sort} dir={dir} onSort={onSort} className="px-2" />
            <SortHeader label="Статус" k="status" sort={sort} dir={dir} onSort={onSort} className="px-2" />
            <th scope="col" className="px-2 py-2.5 font-medium">Состояние</th>
            <SortHeader label="Срок" k="due" sort={sort} dir={dir} onSort={onSort} className="px-3" />
          </tr>
        </thead>
        {groups.map((g) => {
          const numbers = g.tasks.map((t) => t.number);
          const allOn = selection ? numbers.every((n) => selection.selected.has(n)) : false;
          return (
            <tbody key={g.key} className="divide-y divide-line border-t border-line">
              {g.title ? (
                <tr className="bg-white">
                  {selection ? (
                    <td className="px-3 pb-2 pt-4 align-middle">
                      <input type="checkbox" checked={allOn} onChange={(e) => selection.toggleMany(numbers, e.target.checked)} aria-label={`Выбрать все: ${g.title}`} className="h-4 w-4 accent-blue-700" />
                    </td>
                  ) : null}
                  <th scope="colgroup" colSpan={cols - (selection ? 1 : 0)} className="px-4 pb-2 pt-4 text-body font-semibold text-ink">
                    {g.title} <span className="font-normal text-muted">{g.tasks.length}</span>
                  </th>
                </tr>
              ) : null}
              {g.tasks.map((t) => {
                const overdue = isOverdue(t, data.today);
                const stale = isStale(t, data.today);
                const closed = isClosed(t);
                const picked = selection?.selected.has(t.number) ?? false;
                const progress = checklistProgress(t);
                return (
                  <tr key={t.number} className={cn("align-top", picked ? "bg-blue-soft/60" : overdue ? "bg-danger-soft" : "bg-white hover:bg-surface/60", closed && "text-muted")}>
                    {selection ? (
                      <td className="px-3 py-3">
                        <input type="checkbox" checked={picked} onChange={() => selection.toggle(t.number)} aria-label={`Выбрать задачу ${t.number}`} className="h-4 w-4 accent-blue-700" />
                      </td>
                    ) : null}
                    <td className="px-4 py-3 tabular-nums text-muted">{t.number}</td>
                    <td className="px-2 py-3">
                      <button type="button" onClick={() => open(t.number)} className={cn("text-left text-body font-medium leading-snug hover:text-blue-700 hover:underline", closed ? "text-muted" : "text-ink")}>
                        {t.title}
                      </button>
                      <p className="mt-0.5 line-clamp-1 text-caption text-muted">
                        {progress ? <span className="mr-2 tabular-nums">☑ {progress.done}/{progress.total}</span> : null}
                        {t.repeat?.active ? <span className="mr-2">↻</span> : null}
                        {t.where}
                      </p>
                      {stale ? <StaleNote className="mt-0.5 block" /> : null}
                      <LateWaits task={t} className="mt-0.5 block" />
                      <GreenOutsideNote task={t} today={data.today} className="mt-0.5 block" />
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
          );
        })}
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
                const picked = selection?.selected.has(t.number) ?? false;
                const progress = checklistProgress(t);
                return (
                  <li key={t.number} className={cn("flex gap-3 px-4 py-3", picked ? "bg-blue-soft/60" : overdue ? "bg-danger-soft" : "bg-white")}>
                    {selection ? <input type="checkbox" checked={picked} onChange={() => selection.toggle(t.number)} aria-label={`Выбрать задачу ${t.number}`} className="mt-1.5 h-4 w-4 shrink-0 accent-blue-700" /> : null}
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => open(t.number)} className="block w-full text-left">
                        <span className="mr-1.5 tabular-nums text-muted">{t.number}</span>
                        <span className="text-body font-medium leading-snug text-ink">{t.title}</span>
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
