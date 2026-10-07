"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AlarmClock, Check, CheckCheck } from "lucide-react";
import type { InboxItem } from "@/lib/inbox/service";
import { markAllDoneAction, markDoneAction, markSeenAction, snoozeAction } from "@/app/(app)/me/actions";
import { usePrototype } from "@/domain/store";
import { isMine, isOverdue, overdueDays } from "@/lib/tasks/rules";
import { addDays, formatShort } from "@/domain/dates";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { cn } from "@/lib/cn";
import type { Result } from "@/lib/action-runner";

const when = (iso: string, today: string) => {
  const at = new Date(iso);
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" }).format(at);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(at);
  if (day === today) return `сегодня в ${time}`;
  if (day === addDays(today, -1)) return `вчера в ${time}`;
  return `${formatShort(day)} в ${time}`;
};

/** Сроки моих открытых задач: просрочено, сегодня, завтра. Считается из задач, событий не требует. Идёт после событий: главное в «Мне» то, что сделали другие */
function Deadlines() {
  const { data, me } = usePrototype();
  const tomorrow = addDays(data.today, 1);
  const open = data.tasks.filter((t) => !t.archived && isMine(t, me.slug, me.role) && ["in-progress", "clarify", "proposed"].includes(t.status));
  const hot = open
    .filter((t) => isOverdue(t, data.today) || t.due <= tomorrow)
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.number - b.number));
  if (!hot.length) return null;
  return (
    <section aria-labelledby="me-deadlines" className="mt-10">
      <h2 id="me-deadlines" className="mb-3 text-title font-semibold text-ink">
        Сроки <span className="font-normal text-muted">{hot.length}</span>
      </h2>
      <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
        {hot.map((t) => {
          const late = isOverdue(t, data.today);
          return (
            <li key={t.number} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <Link href={`/tasks/${t.number}`} className="min-w-0 text-body font-medium text-ink hover:text-blue-700 hover:underline">
                <span className="tabular-nums text-muted">{t.number}</span> {t.title}
              </Link>
              {late ? (
                <Badge tone="red" className="self-start sm:self-auto">
                  просрочена на {overdueDays(t, data.today)} дн.
                </Badge>
              ) : (
                <Badge tone="yellow" className="self-start sm:self-auto">
                  {t.due === data.today ? "срок сегодня" : "срок завтра"}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const itemAction = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-small font-semibold text-navy hover:bg-surface disabled:text-muted";

/** События «Мне»: одна строка на задачу, свежие сверху */
export function InboxList({ items, snoozed }: { items: InboxItem[]; snoozed: number }) {
  const run = useRunAction();
  const { data } = usePrototype();
  const [busy, setBusy] = useState<string | null>(null);
  // Человек открыл «Мне» и видит события: письма о них уже не нужны (этап 20)
  const seenKey = items.map((i) => `${i.subject}:${i.count}`).join("|");
  useEffect(() => {
    if (seenKey) markSeenAction().catch(() => undefined);
  }, [seenKey]);

  const act = async (subject: string, fn: () => Promise<Result<unknown>>, ok: string) => {
    setBusy(subject);
    await run(fn, ok);
    setBusy(null);
  };

  return (
    <div>
      <section aria-labelledby="me-events">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="me-events" className="text-title font-semibold text-ink">
            События <span className="font-normal text-muted">{items.length}</span>
          </h2>
          {items.length > 1 ? (
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act("*", () => markAllDoneAction(), "Всё разобрано")}>
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Разобрать всё
            </Button>
          ) : null}
        </div>
        {items.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
            {items.map((item) => (
              <li key={item.subject} className={cn("flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between", busy === item.subject && "opacity-60")}>
                <div className="min-w-0">
                  {item.requestNumber ? (
                    <Link href={`/requests/${item.requestNumber}`} className="text-body font-semibold text-ink hover:text-blue-700 hover:underline">
                      <span className="text-muted">Просьба {item.requestNumber}:</span> {item.requestText}
                    </Link>
                  ) : item.taskNumber ? (
                    <Link href={`/tasks/${item.taskNumber}`} className="text-body font-semibold text-ink hover:text-blue-700 hover:underline">
                      <span className="tabular-nums text-muted">{item.taskNumber}</span> {item.taskTitle}
                    </Link>
                  ) : item.entryId ? (
                    <Link href={`/weekly/entry/${item.entryId}`} className="text-body font-semibold text-ink hover:text-blue-700 hover:underline">
                      <span className="text-muted">Запись weekly:</span> {item.entryTitle}
                    </Link>
                  ) : item.subject.startsWith("meeting:") ? (
                    <Link href={`/weekly/meeting?week=${item.subject.slice("meeting:".length)}`} className="text-body font-semibold text-ink hover:text-blue-700 hover:underline">
                      Встреча
                    </Link>
                  ) : item.subject.startsWith("decision:") ? (
                    <Link href="/decisions" className="text-body font-semibold text-ink hover:text-blue-700 hover:underline">
                      Решение встречи
                    </Link>
                  ) : item.subject.startsWith("thanks:") ? (
                    <Link href={`/weekly?week=${item.subject.split(":")[1]}`} className="text-body font-semibold text-ink hover:text-blue-700 hover:underline">
                      Благодарность в weekly
                    </Link>
                  ) : null}
                  <p className="mt-0.5 text-body text-ink">{item.text}</p>
                  <p className="mt-0.5 text-caption text-muted">
                    {item.actorName ?? "Система"}, {when(item.at, data.today)}
                    {item.count > 1 ? `. Ещё событий по ${item.requestNumber ? "просьбе" : item.entryId ? "записи" : "задаче"}: ${item.count - 1}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  <button
                    type="button"
                    className={itemAction}
                    disabled={busy !== null}
                    onClick={() => void act(item.subject, () => markDoneAction(item.subject), "Разобрано")}
                    aria-label={`Разобрано: ${item.requestText ?? item.taskTitle ?? item.entryTitle ?? item.text}`}
                  >
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Разобрано
                  </button>
                  <Menu.Root>
                    <Menu.Trigger className={itemAction} disabled={busy !== null} aria-label={`Напомнить: ${item.requestText ?? item.taskTitle ?? item.entryTitle ?? item.text}`}>
                      <AlarmClock className="h-4 w-4" aria-hidden="true" />
                      Напомнить
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-lg border border-line bg-white p-1 shadow-menu">
                        {(
                          [
                            ["tomorrow", "Завтра в 9:00"],
                            ["monday", "В понедельник в 9:00"],
                          ] as const
                        ).map(([choice, label]) => (
                          <Menu.Item
                            key={choice}
                            onSelect={() => void act(item.subject, () => snoozeAction(item.subject, choice), `Напомним: ${label.toLowerCase()}`)}
                            className="flex h-10 cursor-pointer select-none items-center rounded-md px-2.5 text-small text-ink outline-none data-[highlighted]:bg-surface"
                          >
                            {label}
                          </Menu.Item>
                        ))}
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Всё разобрано">
            Здесь появится то, что ждёт вас: задачи, которые вам поставили или передали, ответы на ваши просьбы, комментарии к вашим задачам и записям weekly, упоминания, реакции, переносы сроков.
          </EmptyState>
        )}
        {snoozed ? <p className="mt-3 text-caption text-muted">Отложено до напоминания: {snoozed}</p> : null}
      </section>
      <Deadlines />
    </div>
  );
}
