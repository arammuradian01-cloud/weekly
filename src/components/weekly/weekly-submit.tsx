"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Cloud, Pencil, Plus, Trash2 } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { entryTypeLabel, ENTRY_TYPES } from "@/prototype/dictionaries";
import { formatShort } from "@/prototype/dates";
import { isDueNextWeek, isDueThisWeek, isMine, isOverdue, isStale, overdueDays } from "@/prototype/rules";
import type { PersonWeekly, Task, WeeklyEntry } from "@/prototype/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { OverdueNote, StaleNote, WeeklyBadge } from "@/components/ui/task-badges";
import { TextArea } from "@/components/ui/primitives";
import { StateSelect, StatusSelect } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { EntryForm } from "./entry-form";
import { EntryItem } from "./entry-item";

const HEADLINE_MAX = 150;

function nowTime() {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

/**
 * Сдача weekly в три шага на одном экране (раздел 3 ТЗ):
 * обновить свои задачи, написать главное и записи, проверить и сдать.
 */
export function WeeklySubmit({ deadlineText, timeLeft, late }: { deadlineText: string; timeLeft: string; late: boolean }) {
  const { data, me, saveWeekly, saveEntry, removeEntry } = usePrototype();
  const week = data.reportingWeek;
  const weekly: PersonWeekly = data.weeklies.find((w) => w.week === week && w.author === me.slug) ?? { week, author: me.slug, headline: "", state: "not-started" };
  const entries = data.entries.filter((e) => e.week === week && e.author === me.slug);
  const submitted = weekly.state === "submitted" || weekly.state === "late";

  const [headline, setHeadline] = useState(weekly.headline);
  const [editing, setEditing] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Черновик сохраняется на сервере сам. В прототипе показываем, как это будет выглядеть
  useEffect(() => {
    if (headline === weekly.headline) return;
    setSaving(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveWeekly({ ...weekly, headline, state: weekly.state === "not-started" ? "draft" : weekly.state }, "Черновик сохранён");
      setSaving(false);
      setSavedAt(nowTime());
    }, 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headline]);

  const tasks = data.tasks.filter(
    (t) =>
      isMine(t, me.slug, me.role) &&
      (isOverdue(t, data.today) || isDueThisWeek(t, data.today) || isDueNextWeek(t, data.today) || isStale(t, data.today)),
  );

  const newEntry = (): WeeklyEntry => ({
    id: `new-${Date.now()}`,
    week,
    author: me.slug,
    direction: me.direction,
    block: "key-changes",
    type: "event",
    what: "",
    links: [],
    ceo: false,
  });
  const [draft, setDraft] = useState<WeeklyEntry | null>(null);

  const onSaveEntry = (entry: WeeklyEntry) => {
    saveEntry(entry);
    if (weekly.state === "not-started") saveWeekly({ ...weekly, headline, state: "draft" }, "Запись сохранена");
    setDraft(null);
    setEditing(null);
    setSavedAt(nowTime());
  };

  const submit = () => {
    saveWeekly({ ...weekly, headline, state: late ? "late" : "submitted", submittedAt: nowTime() }, late ? "Weekly сдан с опозданием" : "Weekly сдан");
  };

  const problems = [
    !headline.trim() ? "Нет главной фразы недели" : null,
    entries.length === 0 ? "Нет ни одной записи" : null,
    headline.length > HEADLINE_MAX ? "Главная фраза длиннее 150 знаков" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-10">
      <aside className="mb-6 lg:mb-0">
        <div className="lg:sticky lg:top-24">
          <WeeklyBadge state={weekly.state} />
          <p className="mt-3 text-[14px] text-muted">
            Срок: {deadlineText}. {late ? <span className="font-medium text-danger-ink">Срок прошёл.</span> : `Осталось ${timeLeft}.`}
          </p>
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted" aria-live="polite">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            {saving ? "Сохраняем черновик" : savedAt ? `Черновик сохранён в ${savedAt}` : "Черновик сохраняется сам каждые 10 секунд"}
          </p>
          <nav aria-label="Шаги сдачи" className="mt-6 hidden lg:block">
            <ol className="flex flex-col gap-1">
              {[
                { href: "#step-tasks", label: "Обновить задачи", note: `${tasks.length}` },
                { href: "#step-entries", label: "Главное и записи", note: `${entries.length}` },
                { href: "#step-submit", label: "Проверить и сдать", note: submitted ? "сдан" : "" },
              ].map((s, i) => (
                <li key={s.href}>
                  <a href={s.href} className="flex h-10 items-center gap-3 rounded-lg px-2 text-[15px] text-ink hover:bg-surface">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-[12px] font-semibold text-white">{i + 1}</span>
                    <span className="flex-1">{s.label}</span>
                    <span className="text-[13px] tabular-nums text-muted">{s.note}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-10">
        <Step id="step-tasks" n={1} title="Обновить задачи" description="Только то, что требует внимания: просроченные, срок на этой и следующей неделе, давно без обновлений">
          {tasks.length === 0 ? (
            <p className="text-[15px] text-muted">Срочных задач нет. Можно сразу писать главное за неделю.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {tasks.map((t) => (
                <TaskUpdateRow key={`${t.number}-${t.where}`} task={t} />
              ))}
            </ul>
          )}
        </Step>

        <Step id="step-entries" n={2} title="Главное за неделю" description="Одна фраза о главном и записи о событиях, обычно от 3 до 7">
          <TextArea
            label="Главное одной фразой"
            id="headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            rows={2}
            counter={{ value: headline.length, max: HEADLINE_MAX }}
          />
          <div className="mt-6 flex flex-col gap-4">
            <h3 className="text-[16px] font-semibold text-ink">
              Записи <span className="font-normal text-muted">{entries.length}</span>
            </h3>
            {entries.length === 0 && !draft ? <p className="text-[15px] text-muted">Пока ни одной записи.</p> : null}
            <ul className="flex flex-col gap-3">
              {entries.map((e) =>
                editing === e.id ? (
                  <li key={e.id}>
                    <EntryForm initial={e} onSave={onSaveEntry} onCancel={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={e.id} className="flex flex-col gap-3 rounded-xl px-4 py-3 ring-1 ring-line sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <EntryItem entry={e} />
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e.id)} aria-label={`Изменить запись «${e.what}»`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Изменить
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeEntry(e.id)} aria-label={`Удалить запись «${e.what}»`}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ),
              )}
            </ul>
            {draft ? (
              <EntryForm initial={draft} onSave={onSaveEntry} onCancel={() => setDraft(null)} />
            ) : (
              <div>
                <Button variant="secondary" onClick={() => setDraft(newEntry())}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Добавить запись
                </Button>
              </div>
            )}
          </div>
        </Step>

        <Step id="step-submit" n={3} title="Проверить и сдать" description="После сдачи править можно до закрытия недели. Каждая правка попадает в журнал">
          {submitted ? (
            <div className="flex flex-col gap-3 rounded-xl bg-green-soft p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="inline-flex items-start gap-2 text-[16px] text-green-ink">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{weekly.state === "late" ? "Сдан с опозданием" : "Weekly сдан"}</span>
                  {weekly.submittedAt ? ` в ${weekly.submittedAt}` : ""}. Правки до закрытия недели разрешены.
                </span>
              </p>
              <Link href="/weekly" className="inline-flex h-11 items-center rounded-lg px-4 text-[15px] font-semibold text-navy hover:bg-white/60">
                Открыть ленту недели
              </Link>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-line">
              <dl className="grid gap-4 p-5 sm:grid-cols-3">
                <div>
                  <dt className="text-[13px] text-muted">Главное</dt>
                  <dd className={cn("mt-1 text-[15px]", headline.trim() ? "text-ink" : "text-danger-ink")}>{headline.trim() || "Не написано"}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted">Записи</dt>
                  <dd className="mt-1 text-[15px] text-ink">
                    {entries.length
                      ? ENTRY_TYPES.map((t) => ({ t, n: entries.filter((e) => e.type === t.code).length }))
                          .filter((x) => x.n)
                          .map((x) => `${entryTypeLabel(x.t.code)}: ${x.n}`)
                          .join(", ")
                      : "Нет"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[13px] text-muted">Задачи на внимание</dt>
                  <dd className="mt-1 text-[15px] text-ink">
                    {tasks.filter((t) => t.whereUpdatedAt === data.today).length} из {tasks.length} обновлены сегодня
                  </dd>
                </div>
              </dl>
              <div className="flex flex-col gap-3 border-t border-line p-5 sm:flex-row sm:items-center sm:justify-between">
                {problems.length ? (
                  <ul className="text-[14px] text-danger-ink">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-muted">Всё на месте. После сдачи weekly увидит вся команда.</p>
                )}
                <Button onClick={submit} disabled={problems.length > 0} className="sm:min-w-44">
                  Сдать weekly
                </Button>
              </div>
            </div>
          )}
        </Step>
      </div>
    </div>
  );
}

function Step({ id, n, title, description, children }: { id: string; n: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-[15px] font-semibold text-white" aria-hidden="true">
          {n}
        </span>
        <div>
          <h2 id={`${id}-title`} className="text-[20px] font-semibold text-ink">
            <span className="sr-only">Шаг {n}. </span>
            {title}
          </h2>
          <p className="mt-0.5 text-[14px] text-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Строка задачи в первом шаге: статус, состояние и «где сейчас» меняются без открытия карточки */
function TaskUpdateRow({ task }: { task: Task }) {
  const { data } = usePrototype();
  const actions = useTaskActions();
  const { open } = useOpenTask();
  const [where, setWhere] = useState(task.where);
  const overdue = isOverdue(task, data.today);
  const changed = where.trim() !== task.where && where.trim().length > 0;
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3", overdue && "bg-danger-soft")}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <button type="button" onClick={() => open(task.number)} className="text-left text-[15px] font-medium leading-snug text-ink hover:text-blue-700 hover:underline">
          <span className="mr-1.5 font-normal tabular-nums text-muted">{task.number}</span>
          {task.title}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-[13px]">
          <span className={cn("tabular-nums", overdue ? "font-semibold text-danger-ink" : "text-muted")}>срок {formatShort(task.due)}</span>
          {overdue ? <OverdueNote days={overdueDays(task, data.today)} /> : null}
          {isStale(task, data.today) ? <StaleNote /> : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        <StatusSelect task={task} />
        <StateSelect task={task} />
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) actions.updateWhere(task, where.trim());
        }}
      >
        <label htmlFor={`w-${task.number}`} className="sr-only">
          Где сейчас по задаче {task.number}
        </label>
        <input
          id={`w-${task.number}`}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          className="h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-[14px] text-ink focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25 sm:h-10 sm:flex-1"
        />
        {changed ? (
          <Button size="sm" type="submit" className="h-11 sm:h-10">
            Сохранить
          </Button>
        ) : task.whereUpdatedAt === data.today ? (
          <span className="text-[13px] text-green-ink">Обновлено сегодня</span>
        ) : null}
      </form>
    </li>
  );
}
