"use client";

// Карточка просьбы (этап 21): кто, кому, что, к какому сроку, состояние, следующий шаг, связанная задача или запись,
// ответ и история.

import { useEffect, useState } from "react";
import Link from "next/link";
import { compactName, ownerName } from "@/domain/people";
import { formatLong } from "@/domain/dates";
import { isActiveRequest, type RequestView } from "@/domain/requests";
import { Meta } from "@/components/ui/primitives";
import { RequestActions } from "./request-actions";
import { RequestBadge } from "./request-parts";

type HistoryRow = { at: string; by: string | null; field: string; before: string | null; after: string | null };

const moment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function RequestCard({ request, history }: { request: RequestView; history: HistoryRow[] }) {
  const [r, setR] = useState(request);
  useEffect(() => setR(request), [request]);
  const active = isActiveRequest(r.status);
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl px-4 py-5 ring-1 ring-line sm:px-6">
        <RequestBadge status={r.status} stuck={r.stuck} />
        <p className="mt-3 whitespace-pre-line text-title font-semibold leading-snug text-ink">{r.text}</p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Meta label="Просит">{ownerName(r.author)}</Meta>
          <Meta label="Кого">{ownerName(r.addressee)}</Meta>
          <Meta label="Нужно к">{formatLong(r.due)}</Meta>
          <Meta label="Срок адресата">
            {r.acceptedDue ? <span className={r.overdue ? "font-semibold text-danger-ink" : undefined}>{formatLong(r.acceptedDue)}{r.overdue ? ", срок прошёл" : ""}</span> : "Ещё не назван"}
          </Meta>
          {r.task ? (
            <Meta label="Задача">
              <Link href={`/tasks/${r.task.number}`} className="text-blue-700 hover:underline">
                <span className="tabular-nums">{r.task.number}</span> {r.task.title}
              </Link>
            </Meta>
          ) : null}
          {r.entry ? (
            <Meta label="Запись weekly">
              <Link href={`/weekly/entry/${r.entry.id}`} className="text-blue-700 hover:underline">
                {r.entry.what}
              </Link>
            </Meta>
          ) : null}
          {r.resultTask ? (
            <Meta label="Задача адресата">
              <Link href={`/tasks/${r.resultTask.number}`} className="text-blue-700 hover:underline">
                <span className="tabular-nums">{r.resultTask.number}</span> {r.resultTask.title}
              </Link>
            </Meta>
          ) : null}
          {r.answer ? <Meta label={r.status === "declined" ? "Причина отказа" : "Итог"}>{r.answer}</Meta> : null}
        </dl>
        <p className="mt-5 text-small text-muted">
          {active
            ? `Следующий шаг делает адресат, ${compactName(r.addressee)}: ${r.status === "open" ? "принять со сроком или отклонить" : "сделать к сроку и отметить «Выполнено»"}.`
            : "Просьба закрыта."}
          {r.remindedAt ? ` Последнее напоминание: ${moment(r.remindedAt)}.` : ""}
        </p>
        <div className="mt-4">
          <RequestActions request={r} size="md" onChanged={setR} />
        </div>
      </section>

      <section aria-labelledby="rq-history">
        <h2 id="rq-history" className="mb-3 text-title font-semibold text-ink">
          История
        </h2>
        <ol className="flex flex-col gap-3">
          {history.map((h, i) => (
            <li key={i} className="text-small leading-relaxed text-ink">
              <span className="text-muted">
                {moment(h.at)}, {h.by ?? "система"}.
              </span>{" "}
              {h.field}: {h.before ? `было «${h.before}», стало «${h.after ?? ""}»` : (h.after ?? "")}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
