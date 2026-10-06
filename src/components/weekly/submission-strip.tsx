"use client";

import { PEOPLE } from "@/domain/people";
import type { PersonWeekly } from "@/domain/types";
import type { WeeklyStateCode } from "@/domain/dictionaries";
import { cn } from "@/lib/cn";
import { substituteText } from "./absence";

const DOT: Record<WeeklyStateCode, string> = {
  submitted: "bg-green",
  late: "bg-[#f2b600]",
  draft: "bg-blue",
  "not-started": "bg-[#b4c2c9]",
};

const WORD: Record<WeeklyStateCode, string> = {
  submitted: "сдал",
  late: "сдал с опозданием",
  draft: "черновик",
  "not-started": "не начинал",
};

/** Полоса сдачи: кто сдал, кто в черновике, кто не начинал. Кого нет на неделе, виден серым с замещающим и в счёт не входит */
export function SubmissionStrip({ reports, className }: { reports: PersonWeekly[]; className?: string }) {
  // Люди в порядке команды, но только те, кого сервер считает участниками weekly (без выключенных и наблюдателей)
  const states = PEOPLE.filter((p) => reports.some((r) => r.author === p.slug)).map((p) => {
    const report = reports.find((w) => w.author === p.slug);
    return { person: p, state: (report?.state ?? "not-started") as WeeklyStateCode, absent: report?.absent };
  });
  const expected = states.filter((s) => !s.absent || s.state === "submitted" || s.state === "late");
  const done = expected.filter((s) => s.state === "submitted" || s.state === "late").length;
  return (
    <section aria-label="Кто сдал weekly" className={cn("rounded-xl bg-surface px-4 py-3", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <p className="shrink-0 text-[15px] text-ink">
          <span className="font-semibold">Сдали {done} из {expected.length}</span>
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {states.map(({ person, state, absent }) => {
            const away = absent && state !== "submitted" && state !== "late";
            return (
              <li key={person.slug} className="inline-flex items-center gap-2 text-[14px]">
                <span className={cn("h-2.5 w-2.5 rounded-full", away ? "bg-transparent ring-2 ring-inset ring-[#b4c2c9]" : DOT[state])} aria-hidden="true" />
                <span className={away ? "text-muted" : "text-ink"}>{person.shortName}</span>
                <span className="text-muted">{away ? `нет на неделе, ${substituteText(absent.substitute)}` : WORD[state]}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
