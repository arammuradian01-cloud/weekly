"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, Check, ExternalLink, Link2, MessageSquare, History as HistoryIcon } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { compactName, ownerName, personOf } from "@/prototype/people";
import { directionLabel, sourceLabel } from "@/prototype/dictionaries";
import { formatAgo, formatLong, formatShort } from "@/prototype/dates";
import { isOverdue, isStale, overdueDays } from "@/prototype/rules";
import type { Task } from "@/prototype/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Avatar, Meta, Segmented, TextArea } from "@/components/ui/primitives";
import { OverdueNote, StaleNote } from "@/components/ui/task-badges";
import { PrioritySelect, StateSelect, StatusSelect, useTaskPermissions } from "./task-fields";
import { useTaskActions } from "./task-actions";

function personInitials(slug: string) {
  const p = personOf(slug as Parameters<typeof personOf>[0]);
  const [last, first] = p.fullName.split(" ");
  return `${first!.charAt(0)}${last!.charAt(0)}`;
}

export function TaskCard({ task, standalone }: { task: Task; standalone?: boolean }) {
  const { data, me, manage, addComment, updateTask, notify } = usePrototype();
  const actions = useTaskActions();
  const can = useTaskPermissions(task);
  const [where, setWhere] = useState(task.where);
  const [comment, setComment] = useState("");
  const [tab, setTab] = useState<"comments" | "history">("comments");
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

      {task.status === "proposed" && manage ? (
        <div className="flex flex-col gap-3 rounded-xl bg-blue-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[14px] text-blue-700">Предложил {personOf(task.createdBy).fullName}. Задачей она станет после вашего подтверждения.</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => actions.changeStatus(task, "cancelled")}>
              Отклонить
            </Button>
            <Button size="sm" onClick={() => updateTask(task.number, { status: "in-progress" }, { field: "Статус", before: "Предложена", after: "В работе" }, `Задача ${task.number} принята в работу`)}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Принять в работу
            </Button>
          </div>
        </div>
      ) : null}

      {task.state === "blocked" && task.blockedBy ? (
        <div className="rounded-xl border-l-4 border-danger bg-danger-soft px-4 py-3">
          <p className="text-[13px] font-semibold text-danger-ink">Заблокирована</p>
          <p className="mt-0.5 text-[15px] text-ink">{task.blockedBy}</p>
        </div>
      ) : null}

      {task.resolution && (task.status === "done" || task.status === "failed" || task.status === "cancelled") ? (
        <div className={cn("rounded-xl px-4 py-3", task.status === "done" ? "bg-green-soft" : "bg-surface")}>
          <p className={cn("text-[13px] font-semibold", task.status === "done" ? "text-green-ink" : "text-muted")}>
            {task.status === "done" ? "Итог" : "Причина"}
          </p>
          <p className="mt-0.5 text-[15px] text-ink">{task.resolution}</p>
        </div>
      ) : null}

      {/* Где сейчас: главное поле для лидера, видно прямо в списке */}
      <section aria-labelledby={`where-${task.number}`}>
        {can.where ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (whereChanged) actions.updateWhere(task, where.trim());
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
            <p className="mt-1 text-[15px] text-ink">{task.where}</p>
            <p className="mt-1 text-[13px] text-muted">
              Обновлено {formatAgo(task.whereUpdatedAt, data.today)} {stale ? <StaleNote className="ml-1" /> : null}
            </p>
          </>
        )}
      </section>

      <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
        <Meta label="Что нужно сделать" className="sm:col-span-2">{task.outcome}</Meta>
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
            <span className="mt-0.5 block text-[13px] text-muted">
              Исходный срок {formatLong(task.originalDue)}, переносов {task.transfers.length}
            </span>
          ) : null}
          {can.due && task.status !== "done" && task.status !== "cancelled" && task.status !== "failed" ? (
            <button type="button" onClick={() => actions.transfer(task)} className="mt-1.5 inline-flex h-9 items-center gap-1.5 rounded-md text-[14px] font-medium text-blue-700 hover:underline">
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              Перенести срок
            </button>
          ) : null}
        </Meta>
        <Meta label="Направление">{directionLabel(task.direction)}</Meta>
        <Meta label="Источник">
          {sourceLabel(task.source.kind)}
          {task.source.note && task.source.note !== sourceLabel(task.source.kind) ? <span className="block text-[13px] text-muted">{task.source.note}</span> : null}
        </Meta>
        <Meta label="Ссылки на артефакты">
          {task.links.length ? (
            <ul className="flex flex-col gap-1">
              {task.links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-blue-700 hover:underline">
                    {l.title}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-muted">Пока нет</span>
          )}
        </Meta>
        <Meta label="Поставлена">
          {formatLong(task.createdAt)}, {compactName(task.createdBy)}
        </Meta>
        <Meta label="Обновлена">{formatAgo(task.updatedAt, data.today)}</Meta>
      </dl>

      {task.transfers.length ? (
        <section aria-labelledby={`transfers-${task.number}`}>
          <H id={`transfers-${task.number}`} className="mb-2 text-sm font-medium text-ink">
            История переносов
          </H>
          <ol className="flex flex-col gap-2">
            {task.transfers.map((t, i) => (
              <li key={i} className="rounded-lg bg-surface px-3.5 py-2.5 text-[14px]">
                <span className="font-medium tabular-nums text-ink">
                  {formatShort(t.from)} на {formatShort(t.to)}
                </span>
                <span className="text-muted">, {compactName(t.by)}, {formatShort(t.at)}</span>
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
            { value: "comments", label: "Комментарии", count: task.comments.length },
            { value: "history", label: "История", count: task.history.length },
          ]}
        />
        {tab === "comments" ? (
          <div className="mt-4 flex flex-col gap-4">
            {task.comments.length === 0 ? <p className="text-[14px] text-muted">Комментариев пока нет.</p> : null}
            <ol className="flex flex-col gap-4">
              {task.comments.map((c) => (
                <li key={c.id} className="flex gap-3">
                  <Avatar text={personInitials(c.author)} size="sm" tone={c.author === me.slug ? "navy" : "light"} />
                  <div className="min-w-0">
                    <p className="text-[13px] text-muted">
                      <span className="font-semibold text-ink">{compactName(c.author)}</span> {formatShort(c.at)}, {c.time}
                    </p>
                    <p className="mt-0.5 text-[15px] leading-relaxed text-ink">{c.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                addComment(task.number, comment.trim());
                setComment("");
              }}
              className="flex flex-col gap-2"
            >
              <TextArea id={`comment-${task.number}`} label="Новый комментарий" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
              <div>
                <Button size="sm" type="submit" variant="secondary" disabled={!comment.trim()}>
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Отправить
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <ol className="mt-4 flex flex-col gap-3 border-l-2 border-line pl-4">
            {task.history.map((h) => (
              <li key={h.id} className="text-[14px]">
                <p className="text-[13px] text-muted">
                  {formatShort(h.at)}, {h.time}, {h.by === "system" ? "система" : compactName(h.by)}
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
      </div>
    </div>
  );
}
