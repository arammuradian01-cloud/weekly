"use client";

import Link from "next/link";
import { ExternalLink, HandHelping, Star } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { blockLabel, directionLabel, entryTypeLabel, type EntryTypeCode } from "@/prototype/dictionaries";
import { authorName } from "@/prototype/people";
import type { WeeklyEntry } from "@/prototype/types";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const TYPE_TONE: Record<EntryTypeCode, BadgeTone> = {
  result: "green",
  event: "blue",
  risk: "red",
  plan: "outline",
};

export function EntryTypeBadge({ type }: { type: EntryTypeCode }) {
  return <Badge tone={TYPE_TONE[type]}>{entryTypeLabel(type)}</Badge>;
}

/**
 * Одна запись weekly: одно событие. Флажок «В отчёт CEO» видят и ставят только владелец и администраторы.
 */
export function EntryItem({ entry, showAuthor, large }: { entry: WeeklyEntry; showAuthor?: boolean; large?: boolean }) {
  const { manage, toggleCeo } = usePrototype();
  return (
    <article className={cn("flex flex-col gap-1.5", entry.help && "rounded-lg bg-warning-soft/60 p-3 -mx-3")}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        <EntryTypeBadge type={entry.type} />
        <span>{blockLabel(entry.block)}</span>
        <span aria-hidden="true">/</span>
        <span>{directionLabel(entry.direction)}</span>
        {showAuthor ? (
          <>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-ink">{authorName(entry.author, "compact", "Общее, без автора")}</span>
          </>
        ) : null}
      </div>
      <h3 className={cn("font-semibold leading-snug text-ink", large ? "text-[24px]" : "text-[16px]")}>{entry.what}</h3>
      {entry.details ? <p className={cn("whitespace-pre-line leading-relaxed text-ink", large ? "text-[19px]" : "text-[15px]")}>{entry.details}</p> : null}
      {entry.impact ? (
        <p className={cn("leading-relaxed", large ? "text-[19px]" : "text-[15px]")}>
          <span className="text-muted">Влияние на бизнес: </span>
          {entry.impact}
        </p>
      ) : null}
      {entry.fact ? (
        <p className={cn("leading-relaxed", large ? "text-[19px]" : "text-[15px]")}>
          <span className="text-muted">Цифра или факт: </span>
          {entry.fact}
        </p>
      ) : null}
      {entry.next ? (
        <p className={cn("leading-relaxed", large ? "text-[19px]" : "text-[15px]")}>
          <span className="text-muted">Дальше: </span>
          {entry.next}
        </p>
      ) : null}
      {entry.help ? (
        <p className={cn("inline-flex items-start gap-2 font-medium text-warning-ink", large ? "text-[19px]" : "text-[15px]")}>
          <HandHelping className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {entry.help}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {entry.taskNumber ? (
          <Link href={`/tasks?task=${entry.taskNumber}`} className="inline-flex min-h-8 items-center text-[14px] font-medium text-blue-700 hover:underline">
            Задача {entry.taskNumber}
          </Link>
        ) : null}
        {entry.links.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-[14px] text-blue-700 hover:underline">
            {l.title}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        ))}
        {manage ? (
          <button
            type="button"
            onClick={() => toggleCeo(entry.id)}
            aria-pressed={entry.ceo}
            className={cn(
              "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors",
              entry.ceo ? "bg-navy text-white" : "text-muted ring-1 ring-line hover:text-ink",
            )}
          >
            <Star className={cn("h-3.5 w-3.5", entry.ceo && "fill-current")} aria-hidden="true" />
            {entry.ceo ? "В отчёте CEO" : "В отчёт CEO"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
