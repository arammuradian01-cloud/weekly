"use client";

// Выбор команды в разделе «Отчёт руководителю» (этап 73): у кого несколько команд, выбирает вверху. Короткий список
// кнопками, длинный полем с поиском (SearchPicker). Смена команды меняет адрес через router.push.

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReportTeamOption } from "@/lib/leader-report/service";
import { SearchPicker } from "@/components/ui/search-picker";
import { cn } from "@/lib/cn";

const SHORT = 6;

export function ReportTeamPicker({ teams, current, tab, week }: { teams: ReportTeamOption[]; current: string | null; tab: string; week: string | null }) {
  const router = useRouter();
  const href = (id: string) => `/leader-report?tab=${tab}&team=${encodeURIComponent(id)}${week ? `&week=${week}` : ""}`;
  if (teams.length > SHORT) {
    return (
      <div className="mb-5 max-w-md" data-testid="lr-team-picker">
        <SearchPicker
          id="lr-team"
          label="Команда"
          value={current ?? ""}
          options={teams.map((t) => ({ value: t.id, label: t.name, note: t.note }))}
          onChange={(v) => {
            if (v) router.push(href(v), { scroll: false });
          }}
          placeholder="Найдите команду"
          emptyText="Такой команды нет среди ваших"
        />
      </div>
    );
  }
  return (
    <nav aria-label="Команда" className="mb-5" data-testid="lr-team-picker">
      <ul className="sv-pills sv-pills--phone-scroll m-0 list-none p-0">
        {teams.map((t) => (
          <li key={t.id}>
            <Link href={href(t.id)} scroll={false} aria-current={t.id === current ? "page" : undefined} className={cn("sv-pill max-w-[80vw]", t.id === current && "is-active")}>
              <span className="truncate">{t.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
