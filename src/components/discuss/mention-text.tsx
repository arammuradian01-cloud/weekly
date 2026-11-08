"use client";

import { useMemo } from "react";

import { findMentionSpans, type MentionPerson } from "@/lib/discuss/mentions";
import { useRegistry } from "@/domain/registry-context";

/** Люди для упоминаний на экране: все включённые, как на сервере. Вместо id слаг */
export function useMentionPeople(): (MentionPerson & { slug: string })[] {
  const { allPeople } = useRegistry();
  return useMemo(
    () =>
      allPeople()
        .filter((p) => p.active !== false)
        .map((p) => ({ id: p.slug, slug: p.slug, fullName: p.fullName, shortName: p.shortName })),
    // Имена обновляются вместе со снимком текущего пользователя
    [allPeople],
  );
}

/** Текст с выделенными упоминаниями @имя. Переводы строк сохраняются */
export function MentionText({ text, className, as = "p" }: { text: string; className?: string; as?: "p" | "span" }) {
  const people = useMentionPeople();
  const parts = useMemo(() => {
    const spans = findMentionSpans(text, people);
    if (!spans.length) return [text];
    const out: (string | { text: string; key: number })[] = [];
    let at = 0;
    for (const s of spans) {
      if (s.start > at) out.push(text.slice(at, s.start));
      out.push({ text: text.slice(s.start, s.end), key: s.start });
      at = s.end;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  }, [text, people]);
  const Tag = as;
  return (
    <Tag className={className ?? "whitespace-pre-line text-body leading-relaxed text-ink"}>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={`t${i}`}>{p}</span>
        ) : (
          <span key={`m${p.key}`} className="rounded bg-blue/10 px-0.5 font-medium text-blue-700">
            {p.text}
          </span>
        ),
      )}
    </Tag>
  );
}
