"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, CalendarClock, Check, Link2, MessageSquare, Pencil, History as HistoryIcon } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { authorName, compactName, ownerName, personOf } from "@/domain/people";
import { directionLabel, sourceLabel } from "@/domain/dictionaries";
import { formatAgo, formatLong, formatShort } from "@/domain/dates";
import { isOverdue, isStale, overdueDays } from "@/domain/rules";
import type { HistoryItem, Task } from "@/domain/types";
import { archiveTaskAction, getTaskAction, moveTaskAction, taskHistoryAction } from "@/app/(app)/tasks/actions";
import { TOP_TEAM, teamName } from "@/domain/teams";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Avatar, Meta, Segmented, TextArea } from "@/components/ui/primitives";
import { OverdueNote, StaleNote } from "@/components/ui/task-badges";
import { PrioritySelect, StateSelect, StatusSelect, useTaskPermissions } from "./task-fields";
import { useTaskActions } from "./task-actions";
import { TaskEditModal, TaskLinks } from "./task-edit";
import { TaskExtrasBlock } from "./task-extras";

function personInitials(slug: string) {
  const p = personOf(slug as Parameters<typeof personOf>[0]);
  const [last, first] = p.fullName.split(" ");
  return `${first!.charAt(0)}${last!.charAt(0)}`;
}

export function TaskCard({ task: listed, standalone }: { task: Task; standalone?: boolean }) {
  const { data, me, addComment, runTask, notify, team, leads, manage, observer } = usePrototype();
  // В списке задача могла прийти без текста комментариев: дозагружаем её целиком (этап 14)
  const [loaded, setLoaded] = useState<Task | null>(null);
  useEffect(() => {
    if (!listed.partial) return setLoaded(null);
    let alive = true;
    getTaskAction(listed.number)
      .then((r) => alive && r.ok && r.task && setLoaded(r.task))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [listed.partial, listed.number, listed.updatedAt]);
  const task = listed.partial && loaded && loaded.number === listed.number ? { ...listed, comments: loaded.comments, partial: false } : listed;
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  const [where, setWhere] = useState(task.where);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<"comments" | "history">("comments");
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Задачу поменяли (здесь или у коллеги): поле «где сейчас» и история берутся заново
  useEffect(() => setWhere(task.where), [task.where]);
  useEffect(() => {
    if (tab !== "history") return;
    let alive = true;
    taskHistoryAction(task.number)
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          setHistory(result.items);
          setHistoryError(null);
        } else setHistoryError(result.error);
      })
      .catch(() => alive && setHistoryError("История не загрузилась. Обновите страницу"));
    return () => {
      alive = false;
    };
  }, [tab, task.number, task.updatedAt, task.comments.length]);
  const overdue = isOverdue(task, data.today);
  const stale = isStale(task, data.today);
  const whereChanged = where.trim() !== task.where;
  // На отдельной странице заголовок задачи h1, в боковой панели h2: подзаголовки на уровень ниже
  const H = standalone ? "h2" : "h3";

  const copyLink = async () => {
    const url = `${window.location.origin}/tasks/${task.number}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("Ссылка на задачу скопирована");
    } catch {
      notify(url);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Строка управления: статус, состояние, приоритет меняются в один клик */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <StatusSelect task={task} />
        <StateSelect task={task} />
        <PrioritySelect task={task} />
      </div>

      {task.status === "proposed" && can.confirm ? (
        <div className="flex flex-col gap-3 rounded-xl bg-blue-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-small text-blue-700">Предложил {authorName(task.createdBy, "full", "участник встречи")}. Задачей она станет после вашего подтверждения.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => actions.changeStatus(task, "cancelled")}>
              Отклонить
            </Button>
            <Button size="sm" onClick={() => actions.changeStatus(task, "in-progress")}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Принять в работу
            </Button>
          </div>
        </div>
      ) : null}

      {task.status === "proposed" && !can.confirm ? (
        <p className="rounded-xl bg-blue-soft px-4 py-3 text-small text-blue-700">
          Задача предложена. Задачей она станет после подтверждения {task.team === TOP_TEAM ? "владельцем или администратором" : "адресатом, его руководителем или руководителем команды"}.
        </p>
      ) : null}

      {task.archived ? (
        <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-small text-ink">Задача в архиве: её видит только владелец.</p>
          {can.archive ? (
            <Button size="sm" variant="secondary" onClick={() => void runTask(() => archiveTaskAction(task.number, false), `Задача ${task.number} возвращена из архива`)}>
              <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
              Вернуть из архива
            </Button>
          ) : null}
        </div>
      ) : null}

      {task.state === "blocked" && task.blockedBy ? (
        <div className="rounded-xl border-l-4 border-danger bg-danger-soft px-4 py-3">
          <p className="text-caption font-semibold text-danger-ink">Заблокирована</p>
          <p className="mt-0.5 text-body text-ink">{task.blockedBy}</p>
        </div>
      ) : null}

      {task.resolution && (task.status === "done" || task.status === "failed" || task.status === "cancelled") ? (
        <div className={cn("rounded-xl px-4 py-3", task.status === "done" ? "bg-green-soft" : "bg-surface")}>
          <p className={cn("text-caption font-semibold", task.status === "done" ? "text-green-ink" : "text-muted")}>
            {task.status === "done" ? "Итог" : "Причина"}
          </p>
          <p className="mt-0.5 text-body text-ink">{task.resolution}</p>
        </div>
      ) : null}

      {/* Где сейчас: главное поле для лидера, видно прямо в списке */}
      <section aria-labelledby={`where-${task.number}`}>
        {can.where ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (whereChanged) void actions.updateWhere(task, where.trim());
            }}
            className="flex flex-col gap-2"
          >
            <TextArea
              id={`where-${task.number}`}
              label="Где сейчас"
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              rows={2}
              hint={`Обновлено ${formatAgo(task.whereUpdatedAt, data.today)}${stale ? ". Задача давно не обновлялась" : ""}`}
            />
            {whereChanged ? (
              <div className="flex gap-2">
                <Button size="sm" type="submit">Сохранить</Button>
                <Button size="sm" type="button" variant="ghost" onClick={() => setWhere(task.where)}>
                  Отменить
                </Button>
              </div>
            ) : null}
          </form>
        ) : (
          <>
            <H id={`where-${task.number}`} className="text-sm font-medium text-ink">Где сейчас</H>
            <p className="mt-1 whitespace-pre-line text-body text-ink">{task.where || <span className="text-muted">Пока без комментария</span>}</p>
            <p className="mt-1 text-caption text-muted">
              Обновлено {formatAgo(task.whereUpdatedAt, data.today)} {stale ? <StaleNote className="ml-1" /> : null}
            </p>
          </>
        )}
      </section>

      <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Meta label="Что нужно сделать" className="sm:col-span-2">
          <span className="whitespace-pre-line">{task.outcome}</span>
        </Meta>
        <Meta label="Ответственный">
          <span className="inline-flex items-center gap-2">
            {task.owner !== "all" ? <Avatar text={personInitials(task.owner)} size="sm" /> : null}
            {ownerName(task.owner)}
          </span>
        </Meta>
        <Meta label="Соисполнители">{task.coExecutors.length ? task.coExecutors.map((c) => compactName(c)).join(", ") : <span className="text-muted">Нет</span>}</Meta>
        <Meta label="Срок">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular-nums">{formatLong(task.due)}</span>
            {overdue ? <OverdueNote days={overdueDays(task, data.today)} /> : null}
          </span>
          {task.transfers.length ? (
            <span className="mt-0.5 block text-caption text-muted">
              {task.transfers[0]?.from === null ? "Исходный срок не записан" : `Исходный срок ${formatLong(task.originalDue)}`}, переносов {task.transfers.length}
            </span>
          ) : null}
          {can.due && task.status !== "done" && task.status !== "cancelled" && task.status !== "failed" ? (
            <button type="button" onClick={() => actions.transfer(task)} className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-md text-small font-medium text-blue-700 hover:underline">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Перенести срок
            </button>
          ) : null}
        </Meta>
        <Meta label="Команда">
          <TaskTeam task={task} options={team.options} movable={!observer && (manage || leads.includes(task.team))} leads={leads} manage={manage} onMove={(to) => void runTask(() => moveTaskAction(task.number, to), `Задача ${task.number} перенесена: ${teamName(to)}`)} />
        </Meta>
        <Meta label="Направление">{directionLabel(task.direction)}</Meta>
        <Meta label="Источник">
          {sourceLabel(task.source.kind)}
          {task.source.note && task.source.note !== sourceLabel(task.source.kind) ? <span className="block text-caption text-muted">{task.source.note}</span> : null}
        </Meta>
        <Meta label="Ссылки на артефакты">
          <TaskLinks task={task} />
        </Meta>
        <Meta label="Поставлена">
          {formatLong(task.createdAt)}, {task.createdBy ? compactName(task.createdBy) : "на встрече"}
        </Meta>
        <Meta label="Обновлена">{formatAgo(task.updatedAt, data.today)}</Meta>
      </dl>

      <TaskExtrasBlock task={task} headingLevel={H} />

      {task.transfers.length ? (
        <section aria-labelledby={`transfers-${task.number}`}>
          <H id={`transfers-${task.number}`} className="mb-2 text-sm font-medium text-ink">
            История переносов
          </H>
          <ol className="flex flex-col gap-2">
            {task.transfers.map((t, i) => (
              <li key={i} className="rounded-lg bg-surface px-3.5 py-2.5 text-small">
                <span className="font-medium tabular-nums text-ink">
                  {t.from ? `${formatShort(t.from)} на ${formatShort(t.to)}` : `На ${formatShort(t.to)}`}
                </span>
                {t.by && t.at ? <span className="text-muted">, {compactName(t.by)}, {formatShort(t.at)}</span> : null}
                <p className="mt-0.5 text-ink">{t.reason}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section>
        <Segmented
          label="Комментарии или история"
          value={tab}
          onChange={setTab}
          options={[
            { value: "comments", label: "Комментарии", count: task.partial ? task.commentCount : task.comments.length },
            { value: "history", label: "История", count: history?.length },
          ]}
        />
        {tab === "comments" ? (
          <div className="mt-4 flex flex-col gap-4">
            {task.partial ? <p className="text-small text-muted">Загружаю комментарии…</p> : task.comments.length === 0 ? <p className="text-small text-muted">Комментариев пока нет.</p> : null}
            <ol className="flex flex-col gap-4">
              {task.comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar text={personInitials(c.author)} size="sm" tone={c.author === me.slug ? "navy" : "light"} />
                  <div className="min-w-0">
                    <p className="text-caption text-muted">
                      <span className="font-semibold text-ink">{compactName(c.author)}</span> {formatShort(c.at)}, {c.time}
                    </p>
                    <p className="mt-0.5 text-body leading-relaxed text-ink">{c.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!comment.trim() || sending) return;
                setSending(true);
                const ok = await addComment(task.number, comment.trim());
                setSending(false);
                if (ok) setComment("");
              }}
              className="flex flex-col gap-2"
            >
              <TextArea id={`comment-${task.number}`} label="Новый комментарий" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
              <div>
                <Button size="sm" type="submit" variant="secondary" disabled={!comment.trim() || sending}>
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Отправить
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <ol className="mt-4 flex flex-col gap-3 border-l-2 border-line pl-4" aria-busy={history === null}>
            {historyError ? <li className="text-small text-danger-ink">{historyError}</li> : null}
            {history === null && !historyError ? <li className="text-small text-muted">Загружаю историю…</li> : null}
            {history?.length === 0 ? <li className="text-small text-muted">Изменений пока нет.</li> : null}
            {(history ?? []).map((h) => (
              <li key={h.id} className="text-small">
                <p className="text-caption text-muted">
                  {formatShort(h.at)}
                  {h.time ? `, ${h.time}` : ""}, {h.by === "system" ? "из таблицы" : compactName(h.by as Parameters<typeof compactName>[0])}
                </p>
                <p className="text-ink">
                  <span className="font-medium">{h.field}</span>
                  {h.before ? <span className="text-muted">: было «{h.before}»</span> : null}
                  {h.after ? <span>{h.before ? ", стало" : ":"} «{h.after}»</span> : null}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {can.edit || can.owner || can.coExecutors ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Изменить
          </Button>
        ) : null}
        <Button size="sm" variant="secondary" onClick={copyLink}>
          <Link2 className="h-4 w-4" aria-hidden="true" />
          Скопировать ссылку
        </Button>
        {!standalone ? (
          <Link href={`/tasks/${task.number}`} className="inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold text-navy hover:bg-surface">
            <HistoryIcon className="h-4 w-4" aria-hidden="true" />
            Открыть отдельной страницей
          </Link>
        ) : null}
        {can.archive && !task.archived ? (
          <Button size="sm" variant="ghost" onClick={() => void runTask(() => archiveTaskAction(task.number, true), `Задача ${task.number} в архиве`)}>
            <Archive className="h-4 w-4" aria-hidden="true" />
            В архив
          </Button>
        ) : null}
      </div>
      <TaskEditModal task={task} open={editing} onOpenChange={setEditing} />
    </div>
  );
}

/** Команда задачи и перенос в другую команду: режим управления или руководитель обеих команд (этап 14) */
function TaskTeam({
  task,
  options,
  movable,
  leads,
  manage,
  onMove,
}: {
  task: Task;
  options: { id: string; name: string }[];
  movable: boolean;
  leads: string[];
  manage: boolean;
  onMove: (to: string) => void;
}) {
  const targets = options.filter((o) => o.id !== task.team && (manage || leads.includes(o.id)));
  if (!movable || !targets.length) return <>{teamName(task.team)}</>;
  return (
    <span className="flex flex-col gap-1">
      <span>{teamName(task.team)}</span>
      <label className="sr-only" htmlFor={`move-${task.number}`}>
        Перенести задачу в другую команду
      </label>
      <select
        id={`move-${task.number}`}
        value=""
        onChange={(e) => e.target.value && onMove(e.target.value)}
        className="h-9 max-w-[260px] rounded-md border border-line bg-white px-2 text-small text-blue-700 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
      >
        <option value="">Перенести в команду…</option>
        {targets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </span>
  );
}
