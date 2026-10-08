"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AlarmClock, AtSign, CalendarClock, Check, CheckCheck, FileText, Gavel, Hand, Heart, MessageSquare, Presentation, SquareCheck, type LucideIcon } from "lucide-react";
import type { InboxItem } from "@/lib/inbox/service";
import { markAllDoneAction, markDoneAction, markSeenAction, snoozeAction } from "@/app/(app)/me/actions";
import { acceptRequestAction } from "@/app/(app)/requests/actions";
import { usePrototype } from "@/domain/store";
import { isMine, isOverdue, overdueDays } from "@/lib/tasks/rules";
import { addDays, formatShort } from "@/domain/dates";
import { Button } from "@/components/ui/button";
import { OverdueNote } from "@/components/ui/task-badges";
import { IconCircle } from "@/components/ui/tile";
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
    <section aria-labelledby="me-deadlines" className="sv-section mt-8">
      <div className="sv-section__head">
        <h2 id="me-deadlines" className="sv-section__title">
          Сроки <span className="sv-section__count">{hot.length}</span>
        </h2>
      </div>
      <ul className="sv-event-list m-0 list-none divide-y divide-line p-0">
        {hot.map((t) => {
          const late = isOverdue(t, data.today);
          return (
            <li key={t.number} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <Link href={`/tasks/${t.number}`} className="min-w-0 text-body text-ink hover:text-link">
                <span className="mr-1 tabular-nums text-text-secondary">{t.number}</span> {t.title}
              </Link>
              {late ? (
                <OverdueNote days={overdueDays(t, data.today)} className="self-start sm:self-auto" />
              ) : (
                <span className="sv-due sv-due--soon self-start sm:self-auto">{t.due === data.today ? "срок сегодня" : "срок завтра"}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Иконка события на круге, как в дизайн-системе (inbox/EventRow.jsx): по предмету события
function eventIcon(item: InboxItem): { icon: LucideIcon; tone: "accent" | "info" | "success" | "warning" | "neutral" } {
  if (item.requestNumber) return { icon: Hand, tone: "info" };
  if (item.subject.startsWith("meeting:")) return { icon: Presentation, tone: "neutral" };
  if (item.subject.startsWith("decision:")) return { icon: Gavel, tone: "neutral" };
  if (item.subject.startsWith("thanks:")) return { icon: Heart, tone: "success" };
  if (/упомян/i.test(item.text)) return { icon: AtSign, tone: "accent" };
  if (/срок/i.test(item.text)) return { icon: CalendarClock, tone: "warning" };
  if (item.entryId) return { icon: FileText, tone: "accent" };
  if (/коммент/i.test(item.text)) return { icon: MessageSquare, tone: "accent" };
  return { icon: SquareCheck, tone: "accent" };
}

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
        <div className="sv-section__head mb-3">
          <h2 id="me-events" className="sv-section__title">
            События <span className="sv-section__count">{items.length}</span>
          </h2>
          {items.length > 1 ? (
            <Button size="sm" variant="ghost" className="ml-auto" disabled={busy !== null} onClick={() => void act("*", () => markAllDoneAction(), "Всё разобрано")}>
              <CheckCheck className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
              Разобрать всё
            </Button>
          ) : null}
        </div>
        {items.length ? (
          <ul className="sv-event-list m-0 list-none p-0">
            {items.map((item) => {
              const kind = eventIcon(item);
              return (
              <li key={item.subject} className={cn("sv-event is-unread", busy === item.subject && "opacity-60")}>
                <IconCircle icon={kind.icon} tone={kind.tone} size={40} />
                <div className="min-w-0">
                  {item.requestNumber ? (
                    <Link href={`/requests/${item.requestNumber}`} className="sv-event__text font-semibold hover:text-link">
                      <span className="text-muted">Просьба {item.requestNumber}:</span> {item.requestText}
                    </Link>
                  ) : item.taskNumber ? (
                    <Link href={`/tasks/${item.taskNumber}`} className="sv-event__text font-semibold hover:text-link">
                      <span className="tabular-nums text-muted">{item.taskNumber}</span> {item.taskTitle}
                    </Link>
                  ) : item.entryId ? (
                    <Link href={`/weekly/entry/${item.entryId}`} className="sv-event__text font-semibold hover:text-link">
                      <span className="text-muted">Запись weekly:</span> {item.entryTitle}
                    </Link>
                  ) : item.subject.startsWith("meeting:") ? (
                    <Link href={`/weekly/meeting?week=${item.subject.split(":")[1]}`} className="sv-event__text font-semibold hover:text-link">
                      Встреча
                    </Link>
                  ) : item.subject.startsWith("decision:") ? (
                    <Link href="/decisions" className="sv-event__text font-semibold hover:text-link">
                      Решение встречи
                    </Link>
                  ) : item.subject.startsWith("thanks:") ? (
                    <Link href={`/weekly?week=${item.subject.split(":")[1]}`} className="sv-event__text font-semibold hover:text-link">
                      Благодарность в weekly
                    </Link>
                  ) : null}
                  <p className="sv-event__text mt-0.5">{item.text}</p>
                  {item.requestQuickDue ? (
                    // Принять просьбу прямо отсюда (этап 26): с телефона это второе нажатие после «Мне»
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={busy !== null}
                      onClick={() => {
                        const due = item.requestQuickDue! >= data.today ? item.requestQuickDue! : addDays(data.today, 1);
                        void act(
                          item.subject,
                          async () => {
                            const r = await acceptRequestAction(item.requestNumber!, due);
                            if (r.ok) await markDoneAction(item.subject).catch(() => undefined);
                            return r;
                          },
                          `Просьба принята, срок ${formatShort(due)}`,
                        );
                      }}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Принять к {formatShort(item.requestQuickDue >= data.today ? item.requestQuickDue : addDays(data.today, 1))}
                    </Button>
                  ) : null}
                  <p className="mt-1 text-caption text-text-secondary">
                    <b className="font-semibold">{item.actorName ?? "Система"}</b>
                    {item.count > 1 ? `. Ещё событий по ${item.requestNumber ? "просьбе" : item.entryId ? "записи" : "задаче"}: ${item.count - 1}` : ""}
                  </p>
                </div>
                <div className="sv-event__side">
                  <span className="sv-event__time">{when(item.at, data.today)}</span>
                  <div className="sv-event__actions">
                  <button
                    type="button"
                    className="sv-icon-btn sv-icon-btn--sm"
                    title="Разобрано"
                    disabled={busy !== null}
                    onClick={() => void act(item.subject, () => markDoneAction(item.subject), "Разобрано")}
                    aria-label={`Разобрано: ${item.requestText ?? item.taskTitle ?? item.entryTitle ?? item.text}`}
                  >
                    <Check className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                  <Menu.Root>
                    <Menu.Trigger className="sv-icon-btn sv-icon-btn--sm" title="Напомнить" disabled={busy !== null} aria-label={`Напомнить: ${item.requestText ?? item.taskTitle ?? item.entryTitle ?? item.text}`}>
                      <AlarmClock className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
                        {(
                          [
                            ["tomorrow", "Завтра в 9:00"],
                            ["monday", "В понедельник в 9:00"],
                          ] as const
                        ).map(([choice, label]) => (
                          <Menu.Item
                            key={choice}
                            onSelect={() => void act(item.subject, () => snoozeAction(item.subject, choice), `Напомним: ${label.toLowerCase()}`)}
                            className="sv-menu__item cursor-pointer select-none outline-none data-[highlighted]:bg-field"
                          >
                            {label}
                          </Menu.Item>
                        ))}
                      </Menu.Content>
                    </Menu.Portal>
                  </Menu.Root>
                  </div>
                </div>
              </li>
              );
            })}
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
