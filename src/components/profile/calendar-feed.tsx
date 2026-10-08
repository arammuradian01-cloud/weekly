"use client";

import { useId, useRef, useState } from "react";
import { CalendarDays, Copy } from "lucide-react";
import type { FeedView } from "@/lib/calendar/service";
import { calendarTitlesAction, createCalendarAction, revokeCalendarAction } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";

const when = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const TITLES_WARNING =
  "Названия задач, имена коллег и названия команд увидит и сохранит у себя сервис календаря: Google, Яндекс или Microsoft. Включайте, только если в названиях нет того, что нельзя выносить за пределы компании.";

/**
 * Календарь сроков (этап 29): личная ссылка для подписки. Сроки задач, срок weekly, встречи команды и один на один.
 * Ссылку видно один раз, сразу после создания: в базе хранится только её отпечаток
 */
export function CalendarFeedSettings({ feed, locked }: { feed: FeedView | null; locked: string | null }) {
  const run = useRunAction();
  const { notify } = usePrototype();
  const [titles, setTitles] = useState(feed?.withTitles ?? false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const warnId = useId();

  if (locked || !feed) return <p className="mt-2 text-body text-muted">{locked}</p>;

  const create = async () => {
    setBusy(true);
    const made = await run(() => createCalendarAction(titles), "Ссылка на календарь готова");
    setBusy(false);
    if (made) {
      setUrl(made);
      // Фокус на ссылку: её сразу можно скопировать, экранный диктор читает только строку «Ссылка готова»
      requestAnimationFrame(() => input.current?.focus());
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify("Ссылка скопирована");
    } catch {
      // Буфер обмена недоступен: ссылка выделена, её можно скопировать вручную
      input.current?.select();
      notify("Выделите ссылку и скопируйте её вручную", "error");
    }
  };

  const titlesBox = (onChange: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={titles}
        disabled={busy}
        aria-describedby={titles ? warnId : undefined}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-blue-700"
      />
      <span>
        <span className="block text-body font-medium text-ink">Показывать названия задач и имена</span>
        <span className="block text-small text-muted">Без этого в календаре только номера задач, слова «срок» и «встреча» и ссылки в ресурс.</span>
        {titles ? (
          <span id={warnId} className="mt-1 block text-small text-warning-ink">
            {TITLES_WARNING}
          </span>
        ) : null}
      </span>
    </label>
  );

  return (
    <div className="mt-4 flex flex-col gap-4">
      {url ? (
        <div className="sv-card sv-card--soft flex flex-col gap-3 p-4">
          <p className="text-body font-medium text-ink" role="status">
            Ссылка готова. Она показывается один раз
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={input}
              readOnly
              value={url}
              aria-label="Ссылка на календарь"
              onFocus={(e) => e.currentTarget.select()}
              className="sv-control min-w-0 flex-1 text-small"
            />
            <Button variant="dark" size="sm" onClick={copy}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              Скопировать
            </Button>
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-muted">
            <li>Google Календарь: «Другие календари», плюс, «Добавить по URL», вставьте ссылку.</li>
            <li>Яндекс Календарь: подписка на календарь по ссылке, вставьте ссылку.</li>
            <li>Outlook: «Добавить календарь», «Подписаться из Интернета», вставьте ссылку.</li>
            <li>
              iPhone и Mac:{" "}
              <a className="text-link hover:underline" href={url.replace(/^https?:/, "webcal:")}>
                открыть в календаре
              </a>
              .
            </li>
          </ul>
          <p className="text-small text-muted">
            Календари обновляют подписку сами: Google раз в несколько часов, остальные чаще. Не пересылайте ссылку: по ней видно ваши сроки без входа. Потеряли
            ссылку: создайте новую, старая перестанет работать. Смена пароля и «выйти везде» тоже отключают ссылку.
          </p>
        </div>
      ) : null}

      {feed.exists ? (
        <>
          <p className="flex items-start gap-2 text-body text-ink">
            <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            <span>
              Ссылка создана {when(feed.createdAt!)}.{" "}
              {feed.lastUsedAt ? `Календарь последний раз забирал данные ${when(feed.lastUsedAt)}.` : "Календарь ещё не забирал данные: добавьте ссылку в свой календарь."}
            </span>
          </p>
          {titlesBox(async (v) => {
            setTitles(v);
            setBusy(true);
            const ok = await run(() => calendarTitlesAction(v), v ? "Названия появятся в календаре при следующем обновлении" : "Названия уберутся из календаря при следующем обновлении");
            setBusy(false);
            if (ok === null) setTitles(!v);
          })}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={create}>
              Новая ссылка
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await run(() => revokeCalendarAction(), "Ссылка отключена: календарь перестанет обновляться");
                setBusy(false);
                if (ok !== null) {
                  setUrl(null);
                  setTitles(false);
                }
              }}
            >
              Отключить ссылку
            </Button>
          </div>
        </>
      ) : (
        <>
          {titlesBox(setTitles)}
          <div>
            <Button variant="secondary" size="sm" disabled={busy} onClick={create}>
              Создать ссылку
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
