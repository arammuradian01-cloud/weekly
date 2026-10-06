"use client";

// Переключатель команды в шапке (этап 14). Виден, только если команд больше одной.
// Список и weekly показывают выбранную команду, «Мои задачи» и «Моя неделя» собирают свои задачи из всех команд.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { ALL_TEAMS } from "@/domain/teams";
import { setTeamAction } from "@/app/actions/team";
import { cn } from "@/lib/cn";

export function TeamSwitcher({ compact = false }: { compact?: boolean }) {
  const { team, notify } = usePrototype();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (team.options.length <= 1) return null;
  const id = compact ? "team-switcher-m" : "team-switcher";
  return (
    <div className={cn("relative flex min-w-0 items-center", compact ? "max-w-[180px]" : "max-w-[280px] shrink-0")}>
      <label htmlFor={id} className="sr-only">
        Команда
      </label>
      <Users className="pointer-events-none absolute left-3 h-4 w-4 text-muted" aria-hidden="true" />
      <select
        id={id}
        value={team.id ?? ""}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => {
          const next = e.target.value;
          start(async () => {
            const r = await setTeamAction(next);
            if (!r.ok) notify(r.error, "error");
            router.refresh();
          });
        }}
        className="h-10 w-full min-w-0 truncate rounded-lg border border-line bg-white pl-9 pr-8 text-body font-medium text-ink hover:border-navy-600/40 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25 disabled:opacity-60"
      >
        {team.options.map((o) => (
          <option key={o.id} value={o.id}>
            {`${"  ".repeat(o.depth)}${o.name}${o.relation === "leader" ? " (руководитель)" : ""}`}
          </option>
        ))}
        <option value={ALL_TEAMS}>Все мои команды</option>
      </select>
    </div>
  );
}
