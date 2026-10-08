"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { setCeoFlagAction } from "@/app/(app)/weekly/actions";
import { useRunWeekly } from "./use-weekly";
import { ExternalLink, HandHelping, Star } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { blockLabel, directionLabel, entryTypeLabel, type EntryTypeCode } from "@/domain/dictionaries";
import { authorName } from "@/domain/people";
import type { WeeklyEntry } from "@/domain/types";
import { cn } from "@/lib/cn";
import { MentionText } from "@/components/discuss/mention-text";
import { EntryDiscussion } from "@/components/discuss/entry-discussion";

// Тип записи тегом дизайн-системы (core/Tag.jsx): результат зелёный, событие голубое, риск жёлтый, план сиреневый
const TYPE_TAG: Record<EntryTypeCode, string> = {
  result: "sv-tag--result",
  event: "sv-tag--event",
  risk: "sv-tag--risk",
  plan: "sv-tag--plan",
};

export function EntryTypeBadge({ type }: { type: EntryTypeCode }) {
  return <span className={cn("sv-tag", TYPE_TAG[type])}>{entryTypeLabel(type)}</span>;
}

/**
 * Одна запись weekly: одно событие. Флажок «В отчёт CEO» видят и ставят только владелец и администраторы.
 */
export function EntryItem({
  entry,
  showAuthor,
  large,
  demo,
  discussion = true,
  card = false,
}: {
  entry: WeeklyEntry;
  showAuthor?: boolean;
  large?: boolean;
  demo?: boolean;
  /** Реакции и обсуждение под записью (этап 20). "open": ветка сразу открыта, как на странице записи */
  discussion?: boolean | "open";
  /** Отдельной карточкой (страница записи, образец). В ленте запись идёт строкой внутри карточки человека */
  card?: boolean;
}) {
  const { manage, notify } = usePrototype();
  const run = useRunWeekly();
  const [ceo, setCeo] = useState(entry.ceo);
  useEffect(() => setCeo(entry.ceo), [entry.ceo]);
  const toggleCeo = async () => {
    if (demo) return notify("Это образец: у настоящих записей отметка сохраняется");
    setCeo(!ceo);
    const saved = await run(() => setCeoFlagAction(entry.id, !ceo), !ceo ? "Запись попадёт в отчёт CEO" : "Запись убрана из отчёта CEO");
    if (!saved) setCeo(ceo);
  };
  const textSize = large ? "!text-title" : "";
  // Карточка записи по дизайн-системе (weekly/EntryCard.jsx, sv-entry): тип, блок и направление, заголовок,
  // подписанные блоки «Влияние на бизнес», «Цифра или факт», «Что делаем дальше», «Нужна помощь», ссылки
  return (
    <article className={cn("sv-entry", !card && "!gap-1.5 !rounded-none !border-0 !bg-transparent !p-0", card && large && "!p-6")}>
      <div className="sv-entry__head">
        <EntryTypeBadge type={entry.type} />
        <span className="sv-entry__dir">
          {blockLabel(entry.block)} <span aria-hidden="true">/</span> {directionLabel(entry.direction)}
        </span>
        {entry.help ? <span className="sv-tag sv-tag--help">Нужна помощь</span> : null}
        {ceo && !manage ? <span className="sv-tag sv-tag--ceo">В отчёте CEO</span> : null}
        {showAuthor ? <span className="sv-entry__author !ml-auto">{authorName(entry.author, "compact", "Общее, без автора")}</span> : null}
      </div>
      <h3 className={cn("sv-entry__title", large && "!text-section")}>{entry.what}</h3>
      {entry.details ? (
        <div className="sv-entry__block">
          <span className="sv-entry__label">Подробнее</span>
          <MentionText text={entry.details} className={cn("sv-entry__text whitespace-pre-line", textSize)} />
        </div>
      ) : null}
      {entry.impact ? (
        <div className="sv-entry__block">
          <span className="sv-entry__label">Влияние на бизнес</span>
          <p className={cn("sv-entry__text", textSize)}>{entry.impact}</p>
        </div>
      ) : null}
      {entry.fact ? (
        <div className="sv-entry__block">
          <span className="sv-entry__label">Цифра или факт</span>
          <p className={cn("sv-entry__text", textSize)}>{entry.fact}</p>
        </div>
      ) : null}
      {entry.next ? (
        <div className="sv-entry__block">
          <span className="sv-entry__label">Что делаем дальше</span>
          <p className={cn("sv-entry__text", textSize)}>{entry.next}</p>
        </div>
      ) : null}
      {entry.help ? (
        <div className="sv-entry__block">
          <span className="sv-entry__label inline-flex items-center gap-1">
            <HandHelping className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            Нужна помощь
          </span>
          <MentionText text={entry.help} className={cn("sv-entry__text whitespace-pre-line font-semibold", textSize)} />
        </div>
      ) : null}
      {entry.taskNumber || entry.links.length || manage ? (
        <div className="sv-entry__links items-center">
          {entry.taskNumber ? (
            <Link href={`/tasks?task=${entry.taskNumber}`} className="inline-flex min-h-8 items-center font-semibold text-link hover:underline">
              Задача {entry.taskNumber}
            </Link>
          ) : null}
          {entry.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-1 text-link hover:underline">
              <ExternalLink className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
              {l.title}
            </a>
          ))}
          {manage ? (
            <button type="button" onClick={toggleCeo} aria-pressed={ceo} className={cn("sv-tag min-h-7 cursor-pointer", ceo ? "sv-tag--ceo" : "border border-line bg-surface hover:text-ink")}>
              <Star className={cn("h-3.5 w-3.5", ceo && "fill-current")} strokeWidth={1.5} aria-hidden="true" />
              {ceo ? "В отчёте CEO" : "В отчёт CEO"}
            </button>
          ) : null}
        </div>
      ) : null}
      {discussion && !demo ? <EntryDiscussion entry={entry} large={large} open={discussion === "open"} /> : null}
    </article>
  );
}
