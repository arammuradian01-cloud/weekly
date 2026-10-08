"use client";

// Списки просьб (этап 21): «Просьбы ко мне» в «Мне» и «Жду от коллег» на «Моей неделе».

import Link from "next/link";
import { compactName } from "@/domain/people";
import { formatShort } from "@/domain/dates";
import { currentDue, type RequestView } from "@/domain/requests";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/cn";
import { RequestActions } from "./request-actions";
import { RequestBadge } from "./request-parts";

export function RequestRow({ request, mode }: { request: RequestView; mode: "incoming" | "outgoing" | "any" }) {
  const r = request;
  const active = r.status === "open" || r.status === "accepted";
  const who = mode === "incoming" ? `от ${compactName(r.author)}` : mode === "outgoing" ? `${compactName(r.addressee)}` : `${compactName(r.author)}, адресат ${compactName(r.addressee)}`;
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href={`/requests/${r.number}`} className="text-body font-semibold leading-snug text-ink hover:text-blue-700 hover:underline">
            <span className="mr-1.5 font-normal tabular-nums text-muted">{r.number}</span>
            {r.text}
          </Link>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
          <RequestBadge status={r.status} stuck={r.stuck} />
          <span className="font-medium text-ink">{who}</span>
          {active ? <span className={cn("tabular-nums", r.overdue && "font-semibold text-danger-ink")}>срок {formatShort(currentDue(r))}</span> : null}
          {r.answer && !active ? <span>{r.answer}</span> : null}
          {r.task ? (
            <Link href={`/tasks/${r.task.number}`} className="text-blue-700 hover:underline">
              задача {r.task.number}
            </Link>
          ) : null}
          {r.resultTask ? (
            <Link href={`/tasks/${r.resultTask.number}`} className="text-blue-700 hover:underline">
              стала задачей {r.resultTask.number}
            </Link>
          ) : null}
          {r.entry ? (
            <Link href={`/weekly/entry/${r.entry.id}`} className="text-blue-700 hover:underline">
              запись weekly
            </Link>
          ) : null}
          {r.overdue ? <span className="font-semibold text-danger-ink">срок прошёл</span> : null}
        </p>
      </div>
      <RequestActions request={r} />
    </li>
  );
}

export function RequestList({
  items,
  mode,
  title,
  id,
  empty,
  action,
  total,
}: {
  items: RequestView[];
  mode: "incoming" | "outgoing";
  title: string;
  id: string;
  empty: React.ReactNode;
  action?: React.ReactNode;
  /** Сколько открытых всего, если показана только часть */
  total?: number;
}) {
  const open = total ?? items.filter((r) => r.status === "open" || r.status === "accepted").length;
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className="text-title font-semibold text-ink">
          {title} <span className="font-normal text-muted">{open}</span>
        </h2>
        {action}
      </div>
      {items.length ? (
        <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft">
          {items.map((r) => (
            <RequestRow key={r.number} request={r} mode={mode} />
          ))}
        </ul>
      ) : (
        empty
      )}
    </section>
  );
}

export function NoRequests({ title, children }: { title: string; children: React.ReactNode }) {
  return <EmptyState title={title}>{children}</EmptyState>;
}
