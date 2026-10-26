"use client";

import Link from "next/link";
import { useState } from "react";
import { BellRing } from "lucide-react";
import { PEOPLE } from "@/domain/people";
import type { PersonWeekly } from "@/domain/types";
import type { WeeklyStateCode } from "@/domain/dictionaries";
import { cn } from "@/lib/cn";
import { substituteText } from "./absence";
import { avatarTone } from "@/components/ui/primitives";
import { initialsOf } from "@/components/people/person-card";
import { Button } from "@/components/ui/button";
import { usePrototype } from "@/domain/store";
import { remindNotSubmittedAction } from "@/app/(app)/weekly/actions";

// Точка состояния на аватаре, как в дизайн-системе (weekly/SubmissionBar.jsx)
const DOT: Record<WeeklyStateCode, string> = {
  submitted: "sv-avatar__status--success",
  late: "sv-avatar__status--warning",
  draft: "sv-avatar__status--accent",
  "not-started": "sv-avatar__status--neutral",
};

const WORD: Record<WeeklyStateCode, string> = {
  submitted: "weekly сдан",
  late: "weekly сдан с опозданием",
  draft: "черновик weekly",
  "not-started": "weekly не начат",
};

/**
 * Полоса сдачи: кто сдал, кто в черновике, у кого weekly не начат. Кого нет на неделе, виден серым с замещающим и в счёт
 * не входит. Этап 73 (аудит удобства): имя ведёт в weekly человека, у руководителя кнопка «Напомнить не сдавшим»
 */
export function SubmissionStrip({ reports, className, remind = null, week }: { reports: PersonWeekly[]; className?: string; remind?: { teamId: string | null; week: string } | null; week?: string }) {
  const { notify, viewing } = usePrototype();
  const [busy, setBusy] = useState(false);
  // Люди в порядке команды, но только те, кого сервер считает участниками weekly (без выключенных и наблюдателей)
  // Кто сдаёт по желанию (специалисты, от кого weekly не ждут, этап 15), виден, только если уже сдал, и в счёт не входит
  const sent = (r: PersonWeekly) => r.state === "submitted" || r.state === "late";
  const states = PEOPLE.filter((p) => reports.some((r) => r.author === p.slug && (!r.optional || sent(r)))).map((p) => {
    const report = reports.find((w) => w.author === p.slug);
    return { person: p, state: (report?.state ?? "not-started") as WeeklyStateCode, absent: report?.absent, optional: !!report?.optional, retro: !!report?.retro };
  });
  const expected = states.filter((s) => !s.optional && (!s.absent || s.state === "submitted" || s.state === "late"));
  const done = expected.filter((s) => s.state === "submitted" || s.state === "late").length;
  const percent = expected.length ? Math.round((done / expected.length) * 100) : 0;
  const waiting = expected.filter((s) => s.state === "draft" || s.state === "not-started").length;
  const sendRemind = async () => {
    if (!remind) return;
    setBusy(true);
    try {
      const r = await remindNotSubmittedAction(remind.teamId, remind.week);
      if (!r.ok) notify(r.error, "error");
      else if (!r.value.sent) notify("Напоминание уже отправляли за последние шесть часов");
      else notify(`Напоминание отправлено: ${r.value.sent}`);
    } catch {
      notify("Нет связи с сервером: напоминание не отправлено", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Кто сдал weekly" className={cn("sv-card sv-card--soft px-4 py-3", className)}>
      <div className="sv-submit-bar">
        <p className="sv-submit-bar__text">Сдали {done} из {expected.length}</p>
        <div className="sv-submit-bar__track max-w-60" aria-hidden="true">
          <div className="sv-submit-bar__fill" style={{ width: `${percent}%` }} />
        </div>
        {remind && waiting > 0 && !viewing ? (
          <Button size="sm" variant="secondary" className="ml-auto min-h-11 sm:min-h-0" onClick={() => void sendRemind()} loading={busy} disabled={busy} data-testid="weekly-remind">
            <BellRing className="h-4 w-4" aria-hidden="true" />
            Напомнить не сдавшим
          </Button>
        ) : null}
      </div>
      {/* Этап 43: у сдавших вовремя только аватар с зелёной точкой и имя, слово подсказкой и для экранного диктора;
          слово видно у опоздавших, у тех, кто не сдал, и у кого нет на неделе: это и есть, на кого смотреть */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {states.map(({ person, state, absent, optional, retro }) => {
          const away = absent && state !== "submitted" && state !== "late";
          // Слово спрятано только у сдавших вовремя: опоздание, черновик и «не начат» видны словом, не одной точкой
          const sentNow = state === "submitted";
          const word = away ? `нет на неделе, ${substituteText(absent.substitute)}` : retro ? "weekly сдан задним числом" : `${WORD[state]}${optional ? " по желанию" : ""}`;
          return (
            // Этап 50: не начавшие и отсутствующие приглушены серой точкой и цветом имени, а не прозрачностью строки:
            // слово «не начат» при 70% прозрачности падало ниже 3:1 на белом, инициалы ниже 4,5:1
            <li key={person.slug} className="inline-flex items-center gap-2 text-small" title={`${person.shortName}: ${word}`}>
              <span className={cn("sv-avatar sv-avatar--sm", `sv-avatar--${avatarTone(person.fullName)}`)} aria-hidden="true">
                {initialsOf(person.fullName)}
                <span className={cn("sv-avatar__status", away ? "sv-avatar__status--neutral" : DOT[state])} />
              </span>
              <Link href={`/weekly?${week ? `week=${week}&` : ""}author=${encodeURIComponent(person.slug)}`} scroll={false} className={cn("inline-flex min-h-11 items-center font-semibold hover:text-link hover:underline sm:min-h-0", away || state === "not-started" ? "text-text-secondary" : "text-ink")}>
                {person.shortName}
              </Link>
              <span className={cn("text-text-secondary", sentNow && "sr-only")}>{word}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
