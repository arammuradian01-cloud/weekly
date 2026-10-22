"use client";

import { PEOPLE } from "@/domain/people";
import type { PersonWeekly } from "@/domain/types";
import type { WeeklyStateCode } from "@/domain/dictionaries";
import { cn } from "@/lib/cn";
import { substituteText } from "./absence";
import { AvatarImage, avatarTone } from "@/components/ui/primitives";
import { avatarPhoto } from "@/domain/people";
import { initialsOf } from "@/components/people/person-card";

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

/** Полоса сдачи: кто сдал, кто в черновике, у кого weekly не начат. Кого нет на неделе, виден серым с замещающим и в счёт не входит */
export function SubmissionStrip({ reports, className }: { reports: PersonWeekly[]; className?: string }) {
  // Люди в порядке команды, но только те, кого сервер считает участниками weekly (без выключенных и наблюдателей)
  // Кто сдаёт по желанию (специалисты, от кого weekly не ждут, этап 15), виден, только если уже сдал, и в счёт не входит
  const sent = (r: PersonWeekly) => r.state === "submitted" || r.state === "late";
  const states = PEOPLE.filter((p) => reports.some((r) => r.author === p.slug && (!r.optional || sent(r)))).map((p) => {
    const report = reports.find((w) => w.author === p.slug);
    return { person: p, state: (report?.state ?? "not-started") as WeeklyStateCode, absent: report?.absent, optional: !!report?.optional };
  });
  const expected = states.filter((s) => !s.optional && (!s.absent || s.state === "submitted" || s.state === "late"));
  const done = expected.filter((s) => s.state === "submitted" || s.state === "late").length;
  const percent = expected.length ? Math.round((done / expected.length) * 100) : 0;
  return (
    <section aria-label="Кто сдал weekly" className={cn("sv-card sv-card--soft px-4 py-3", className)}>
      <div className="sv-submit-bar">
        <p className="sv-submit-bar__text">Сдали {done} из {expected.length}</p>
        <div className="sv-submit-bar__track max-w-60" aria-hidden="true">
          <div className="sv-submit-bar__fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
      {/* Этап 43: у сдавших вовремя только аватар с зелёной точкой и имя, слово подсказкой и для экранного диктора;
          слово видно у опоздавших, у тех, кто не сдал, и у кого нет на неделе: это и есть, на кого смотреть */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {states.map(({ person, state, absent, optional }) => {
          const away = absent && state !== "submitted" && state !== "late";
          // Слово спрятано только у сдавших вовремя: опоздание, черновик и «не начат» видны словом, не одной точкой
          const sentNow = state === "submitted";
          const word = away ? `нет на неделе, ${substituteText(absent.substitute)}` : `${WORD[state]}${optional ? " по желанию" : ""}`;
          // Фото профиля (этап 80) поверх инициалов, точка состояния поверх фото
          const photo = avatarPhoto(person.slug);
          return (
            // Этап 50: не начавшие и отсутствующие приглушены серой точкой и цветом имени, а не прозрачностью строки:
            // слово «не начат» при 70% прозрачности падало ниже 3:1 на белом, инициалы ниже 4,5:1
            <li key={person.slug} className="inline-flex items-center gap-2 text-small" title={`${person.shortName}: ${word}`}>
              <span className={cn("sv-avatar sv-avatar--sm", `sv-avatar--${avatarTone(person.fullName)}`)} aria-hidden="true">
                {initialsOf(person.fullName)}
                {photo ? <AvatarImage photo={photo} size="small" /> : null}
                <span className={cn("sv-avatar__status", away ? "sv-avatar__status--neutral" : DOT[state])} />
              </span>
              <span className={cn("font-semibold", away || state === "not-started" ? "text-text-secondary" : "text-ink")}>{person.shortName}</span>
              <span className={cn("text-text-secondary", sentNow && "sr-only")}>{word}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
