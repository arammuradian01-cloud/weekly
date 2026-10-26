"use client";

// Разбор встречи из Notion (этап 61) на странице встречи: кнопка «Разобрать встречу из Notion» и прошлые разборы этой
// встречи. Ведущий вставляет ссылку на страницу встречи, ресурс открывает страницу разбора и разбирает встречу там.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileSearch } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { WeekKey } from "@/domain/types";
import { startParseAction } from "@/app/(app)/meeting/parse-actions";
import type { ParseListItem } from "@/lib/meeting/parse-service";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";

const when = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");

export function NotionParseBar({ team, week, canLead, notionUrl, parses }: { team: { id: string; name: string }; week: WeekKey; canLead: boolean; notionUrl?: string | null; parses: ParseListItem[] }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(notionUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // По этой встрече и странице задачи уже созданы: номера и вопрос, разбирать ли ещё раз
  const [repeat, setRepeat] = useState<number[] | null>(null);
  if (!canLead && !parses.length) return null;

  const start = async (e: React.FormEvent, again = false) => {
    e.preventDefault();
    if (!url.trim()) return setError("Вставьте ссылку на страницу встречи в Notion");
    setBusy(true);
    setError(null);
    try {
      const r = await startParseAction(team.id, week, url.trim(), again);
      if (!r.ok) return setError(r.error);
      if (!r.value.id) return setRepeat(r.value.created ?? []);
      setOpen(false);
      setRepeat(null);
      router.push(`/meeting/notion/${r.value.id}`);
    } catch {
      notify("Нет связи с сервером", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Разбор встречи из Notion" className="mb-4 flex flex-col gap-3 sv-card sv-card--soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="notion-parse-bar">
      <div className="min-w-0">
        <p className="text-body text-ink">Итоги встречи из Notion: ресурс прочитает страницу встречи, покажет итоги, черновик отчёта руководителю и задачи на проверку.</p>
        {parses.length ? (
          <ul className="mt-1 flex flex-col gap-0.5 text-small">
            {parses.map((p) => (
              <li key={p.id} className="min-w-0 break-words">
                <Link href={`/meeting/notion/${p.id}`} className="font-medium text-blue-700 underline-offset-2 hover:underline">
                  Разбор {when(p.createdAt)}
                  {p.title ? `: ${p.title}` : ""}
                </Link>
                <span className="text-muted">. {p.status}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {canLead ? (
        <Button size="sm" className="shrink-0" onClick={() => setOpen(true)}>
          <FileSearch className="h-4 w-4" aria-hidden="true" />
          Разобрать встречу из Notion
        </Button>
      ) : null}
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Разобрать встречу из Notion"
        description={`Встреча ${team.name}. Ресурс прочитает страницу, покажет итоги встречи, черновик отчёта руководителю и черновики задач. Ничего не отправится и не создастся без вашей проверки.`}
      >
        <form onSubmit={start} className="flex flex-col gap-4">
          <TextInput
            label="Ссылка на страницу встречи в Notion"
            id="notion-parse-url"
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setRepeat(null);
            }}
            placeholder="https://www.notion.so/..."
            autoFocus
            autoComplete="off"
            spellCheck={false}
            hint="Страница должна быть расшарена на интеграцию ресурса: в Notion меню с тремя точками справа вверху, «Подключения»"
          />
          {repeat ? (
            <p role="alert" className="sv-card sv-card--soft bg-warning-soft px-4 py-3 text-body text-ink" data-testid="parse-repeat">
              Эту страницу уже разбирали, и по ней созданы задачи: {repeat.join(", ")}. Повторный разбор покажет черновики снова, похожие на созданные задачи будут сняты и помечены. Разобрать ещё раз?
            </p>
          ) : null}
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            {repeat ? (
              <Button type="button" disabled={busy} loading={busy} onClick={(e) => void start(e, true)}>
                {busy ? "Запускаем разбор…" : "Разобрать ещё раз"}
              </Button>
            ) : (
              <Button type="submit" disabled={busy} loading={busy}>
                {busy ? "Запускаем разбор…" : "Разобрать"}
              </Button>
            )}
          </div>
        </form>
      </Modal>
    </section>
  );
}
