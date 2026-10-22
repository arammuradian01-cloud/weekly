"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { AlarmClock, AtSign, CalendarClock, Check, CheckCheck, FileText, Gavel, Hand, Heart, MessageSquare, MessagesSquare, Presentation, Rocket, Rss, SquareCheck, TrendingUp, Users, type LucideIcon } from "lucide-react";
import type { InboxItem } from "@/lib/inbox/service";
import { planHref } from "@/lib/plan/links";
import { markAllDoneAction, markDoneAction, markSeenAction, snoozeAction } from "@/app/(app)/me/actions";
import { acceptRequestAction } from "@/app/(app)/requests/actions";
import { usePrototype } from "@/domain/store";
import { addDays, formatShort } from "@/domain/dates";
import { Button } from "@/components/ui/button";
import { IconCircle } from "@/components/ui/tile";
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

// Иконка события на круге, как в дизайн-системе (inbox/EventRow.jsx): по предмету события
function eventIcon(item: InboxItem): { icon: LucideIcon; tone: "accent" | "info" | "success" | "warning" | "neutral" } {
  if (item.requestNumber) return { icon: Hand, tone: "info" };
  if (item.subject.startsWith("meeting:")) return { icon: Presentation, tone: "neutral" };
  if (item.subject.startsWith("ceo-report:")) return { icon: FileText, tone: "info" };
  if (item.subject.startsWith("meeting-parse:")) return { icon: Presentation, tone: "info" };
  if (item.subject.startsWith("team-report:")) return { icon: FileText, tone: "info" };
  if (item.subject.startsWith("decision:")) return { icon: Gavel, tone: "neutral" };
  if (item.subject.startsWith("thanks:")) return { icon: Heart, tone: "success" };
  if (item.subject.startsWith("1on1:")) return { icon: MessagesSquare, tone: "info" };
  if (item.subject.startsWith("initiative:")) return { icon: Rocket, tone: "accent" };
  if (item.subject.startsWith("plan:")) return { icon: TrendingUp, tone: "warning" };
  if (item.subject.startsWith("news:")) return { icon: Rss, tone: "info" };
  if (item.subject.startsWith("team:") || item.subject.startsWith("join:") || item.subject.startsWith("approval-co:")) return { icon: Users, tone: "info" };
  if (/упомян/i.test(item.text)) return { icon: AtSign, tone: "accent" };
  if (/срок/i.test(item.text)) return { icon: CalendarClock, tone: "warning" };
  if (item.entryId) return { icon: FileText, tone: "accent" };
  if (/коммент/i.test(item.text)) return { icon: MessageSquare, tone: "accent" };
  return { icon: SquareCheck, tone: "accent" };
}

/** События «Мне»: одна строка на задачу, свежие сверху. Этап 44: группа «Прочитать» в общей очереди, только когда события есть */
export function InboxEvents({ items }: { items: InboxItem[] }) {
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
    <section aria-labelledby="me-read" className="sv-section !mt-0 scroll-mt-24" data-testid="me-read">
      <div className="sv-section__head">
        <h2 id="me-read" className="sv-section__title">
          Прочитать <span className="sv-section__count">{items.length}</span>
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
                ) : item.subject.startsWith("ceo-report:") ? (
                  // Этап 61: weekly для CEO отправили из разбора встречи
                  <Link href={`/ceo-report?week=${item.subject.split(":")[1]}`} className="sv-event__text font-semibold hover:text-link">
                    Weekly для CEO
                  </Link>
                ) : item.subject.startsWith("team-report:") ? (
                  // Этап 66: руководитель команды отправил weekly команды по блокам
                  <Link href={`/weekly/team-report?team=${encodeURIComponent(item.subject.split(":")[1] ?? "")}&week=${item.subject.split(":")[2] ?? ""}`} className="sv-event__text font-semibold hover:text-link">
                    Weekly команды по блокам
                  </Link>
                ) : item.subject.startsWith("meeting-parse:") ? (
                  // Этап 61: разбор встречи из Notion готов или не получился
                  <Link href={`/meeting/notion/${encodeURIComponent(item.subject.slice("meeting-parse:".length))}`} className="sv-event__text font-semibold hover:text-link">
                    Разбор встречи из Notion
                  </Link>
                ) : item.subject.startsWith("decision:") ? (
                  <Link href="/decisions" className="sv-event__text font-semibold hover:text-link">
                    Решение встречи
                  </Link>
                ) : item.subject.startsWith("thanks:") ? (
                  <Link href={`/weekly?week=${item.subject.split(":")[1]}`} className="sv-event__text font-semibold hover:text-link">
                    Благодарность в weekly
                  </Link>
                ) : item.subject.startsWith("1on1:") ? (
                  <Link href={`/one-on-one?pair=${encodeURIComponent(item.subject.slice(5))}`} className="sv-event__text font-semibold hover:text-link">
                    {item.actorName ? `Один на один: ${item.actorName}` : "Встреча один на один"}
                  </Link>
                ) : item.subject.startsWith("initiative:") ? (
                  <Link href={`/initiatives#i-${encodeURIComponent(item.subject.slice(11))}`} className="sv-event__text font-semibold hover:text-link">
                    Крупная инициатива
                  </Link>
                ) : item.subject.startsWith("plan:") ? (
                  <Link href={planHref(item.subject)} className="sv-event__text font-semibold hover:text-link">
                    {item.subject.endsWith(":partners") ? "Прогноз месяца: партнёры" : "Прогноз месяца"}
                  </Link>
                ) : item.subject.startsWith("news:") ? (
                  <Link href={`/news?digest=${encodeURIComponent(item.subject.slice(5))}`} className="sv-event__text font-semibold hover:text-link">
                    Дайджест новостей
                  </Link>
                ) : item.subject.startsWith("team:") ? (
                  <Link href={`/people/structure?team=${encodeURIComponent(item.subject.split(":")[1] ?? "")}`} className="sv-event__text font-semibold hover:text-link">
                    Состав команды
                  </Link>
                ) : item.subject.startsWith("join:") ? (
                  <Link href="/people/structure#join-requests" className="sv-event__text font-semibold hover:text-link">
                    Запрос в команду
                  </Link>
                ) : item.subject.startsWith("approval-co:") ? (
                  // Этап 54: соисполнитель из вашей команды в задаче другого департамента. Задачу руководитель может не видеть
                  <p className="sv-event__text font-semibold">Соисполнитель в задаче другого департамента</p>
                ) : null}
                <p className="sv-event__text mt-0.5">{item.text}</p>
                {item.requestQuickDue ? (
                  // Принять просьбу прямо отсюда (этап 26): с телефона это второе нажатие после «Мне»
                  <Button
                    size="sm"
                    className="mt-2"
                    aria-label={`Принять просьбу ${item.requestNumber} к ${formatShort(item.requestQuickDue >= data.today ? item.requestQuickDue : addDays(data.today, 1))}`}
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
      ) : null}
    </section>
  );
}
