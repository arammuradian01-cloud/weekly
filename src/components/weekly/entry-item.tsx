"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { setCeoFlagAction } from "@/app/(app)/weekly/actions";
import { useRunWeekly } from "./use-weekly";
import { Coins, CornerDownRight, ExternalLink, HandHelping, Hash, Star } from "lucide-react";
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

/** Отметка «В отчёте CEO»: звезда на светлом фоне, заметнее тёмной плашки среди текста */
export function CeoTag({ className }: { className?: string }) {
  return (
    <span className={cn("sv-tag sv-tag--ceo", className)}>
      <Star className="h-3 w-3 fill-current" strokeWidth={1.5} aria-hidden="true" />
      В отчёте руководителю
    </span>
  );
}

/**
 * Строка записи с иконкой вместо подписи (этап 43): в ленте из десятков записей подписи «Цифра или факт» и «Что
 * делаем дальше» повторялись сотню раз. Подпись остаётся для экранного диктора, глазу хватает иконки и формы:
 * факт табличными цифрами, «дальше» с маркером в начале строки
 */
function Line({ icon: Icon, label, labels, children, className }: { icon: typeof Hash; label: string; labels: boolean; children: React.ReactNode; className?: string }) {
  if (labels) {
    return (
      <div className="sv-entry__block">
        <span className="sv-entry__label">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <div className={cn("sv-entry__line", className)}>
      <Icon className="sv-entry__line__icon" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">{label}: </span>
      {children}
    </div>
  );
}

/**
 * Одна запись weekly: одно событие. Флажок «В отчёт CEO» видят и ставят только владелец и администраторы.
 * В ленте запись компактная: тип и блок одной мелкой строкой, заголовок, текст, факт и «дальше» строками с иконкой.
 * Крупно (встреча, страница записи) подписи полей остаются
 */
export function EntryItem({
  entry,
  showAuthor,
  large,
  demo,
  discussion = true,
  card = false,
  compact = false,
}: {
  entry: WeeklyEntry;
  showAuthor?: boolean;
  large?: boolean;
  demo?: boolean;
  /** Реакции и обсуждение под записью (этап 20). "open": ветка сразу открыта, как на странице записи */
  discussion?: boolean | "open";
  /** Отдельной карточкой (страница записи, образец). В ленте запись идёт строкой внутри карточки человека */
  card?: boolean;
  /** Компактно (этап 43): лента и сдача weekly. Подписи полей иконками, реакция и обсуждение иконками */
  compact?: boolean;
}) {
  const { manage, notify } = usePrototype();
  const run = useRunWeekly();
  const [ceo, setCeo] = useState(entry.ceo);
  useEffect(() => setCeo(entry.ceo), [entry.ceo]);
  const toggleCeo = async () => {
    if (demo) return notify("Это образец: у настоящих записей отметка сохраняется");
    setCeo(!ceo);
    const saved = await run(() => setCeoFlagAction(entry.id, !ceo), !ceo ? "Запись попадёт в отчёт руководителю" : "Запись убрана из отчёта руководителю");
    if (!saved) setCeo(ceo);
  };
  const textSize = large ? "!text-title" : "";
  const labels = !compact || !!large || discussion === "open";
  return (
    <article className={cn("sv-entry", !card && "!gap-1.5 !rounded-none !border-0 !bg-transparent !p-0", card && large && "!p-6")}>
      <div className="sv-entry__head">
        <EntryTypeBadge type={entry.type} />
        <span className="sv-entry__dir">
          {blockLabel(entry.block)} <span aria-hidden="true">/</span> {directionLabel(entry.direction)}
        </span>
        {entry.help ? <span className="sv-tag sv-tag--help">Нужна помощь</span> : null}
        {ceo && !manage ? <CeoTag /> : null}
        {showAuthor ? <span className="sv-entry__author !ml-auto">{authorName(entry.author, "compact", "Общее, без автора")}</span> : null}
      </div>
      <h3 className={cn("sv-entry__title", large && "!text-section")}>{entry.what}</h3>
      {entry.details ? (
        labels ? (
          <div className="sv-entry__block">
            <span className="sv-entry__label">Подробнее</span>
            <MentionText text={entry.details} className={cn("sv-entry__text whitespace-pre-line", textSize)} />
          </div>
        ) : (
          <MentionText text={entry.details} className={cn("sv-entry__text whitespace-pre-line", textSize)} />
        )
      ) : null}
      {entry.impact ? (
        <Line icon={Coins} label="Влияние на бизнес" labels={labels}>
          <p className={cn("sv-entry__text", textSize)}>{entry.impact}</p>
        </Line>
      ) : null}
      {entry.fact ? (
        <Line icon={Hash} label="Цифра или факт" labels={labels} className="sv-entry__line--fact">
          <p className={cn("sv-entry__text", textSize)}>{entry.fact}</p>
        </Line>
      ) : null}
      {entry.next ? (
        <Line icon={CornerDownRight} label="Что делаем дальше" labels={labels} className="sv-entry__line--next">
          <p className={cn("sv-entry__text", textSize)}>{entry.next}</p>
        </Line>
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
              {ceo ? "В отчёте руководителю" : "В отчёт руководителю"}
            </button>
          ) : null}
        </div>
      ) : null}
      {discussion && !demo ? <EntryDiscussion entry={entry} large={large} open={discussion === "open"} compact={compact && !large && discussion !== "open"} /> : null}
    </article>
  );
}
