"use client";

import { PEOPLE } from "@/prototype/people";
import type { PersonWeekly } from "@/prototype/types";
import type { WeeklyStateCode } from "@/prototype/dictionaries";
import { cn } from "@/lib/cn";

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

/** Полоса сдачи: кто сдал, кто в черновике, кто не начинал */
export function SubmissionStrip({ reports, className }: { reports: PersonWeekly[]; className?: string }) {
  // Люди в порядке команды, но только те, кого сервер считает участниками weekly (без выключенных и наблюдателей)
  const states = PEOPLE.filter((p) => reports.some((r) => r.author === p.slug)).map((p) => ({
    person: p,
    state: (reports.find((w) => w.author === p.slug)?.state ?? "not-started") as WeeklyStateCode,
  }));
  const done = states.filter((s) => s.state === "submitted" || s.state === "late").length;
  return (
    <section aria-label="Кто сдал weekly" className={cn("rounded-xl bg-surface px-4 py-3", className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <p className="shrink-0 text-[15px] text-ink">
          <span className="font-semibold">Сдали {done} из {states.length}</span>
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {states.map(({ person, state }) => (
            <li key={person.slug} className="inline-flex items-center gap-2 text-[14px]">
              <span className={cn("h-2.5 w-2.5 rounded-full", DOT[state])} aria-hidden="true" />
              <span className="text-ink">{person.shortName}</span>
              <span className="text-muted">{WORD[state]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
