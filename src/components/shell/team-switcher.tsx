"use client";

// Переключатель команды в шапке (этап 14). Список виден, если команд больше одной; при одной команде или без команд
// на его месте ссылка на экран «Weekly-команды» (этап 64), чтобы управлять командами можно было отовсюду.
// Список и weekly показывают выбранную команду, «Мои задачи» и «Моя неделя» собирают свои задачи из всех команд.
// Вид по дизайн-системе (navigation/TeamSwitcher.jsx): кнопка с иконкой людей, названием, ролью и стрелкой.
// Сам выбор остаётся системным списком поверх кнопки: так работают экранный диктор, клавиатура и телефон.
// Этап 64: последний пункт «Управлять командами» ведёт на экран «Weekly-команды», команду он не меняет.

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Users } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { ALL_TEAMS } from "@/domain/teams";
import { setTeamAction } from "@/app/actions/team";
import { cn } from "@/lib/cn";

/** Пункт списка, который ведёт на экран команд, а не выбирает команду */
const MANAGE = "__manage";

export function TeamSwitcher({ compact = false }: { compact?: boolean }) {
  const { team, notify } = usePrototype();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (team.options.length <= 1) {
    const only = team.options[0]?.name ?? null;
    return (
      <div className={cn("sv-team-switch min-w-0", compact && "sv-team-switch--compact flex-1")}>
        <Link href="/people/teams" className="sv-team-switch__trigger max-w-full" aria-label={only ? `${only}: управлять командами` : "Управлять командами"} title="Управлять командами" data-testid={compact ? "team-manage-link-m" : "team-manage-link"}>
          {!compact ? <Users className="h-[18px] w-[18px] shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden="true" /> : null}
          <span className="sv-team-switch__name">{only ?? "Weekly-команды"}</span>
        </Link>
      </div>
    );
  }
  const id = compact ? "team-switcher-m" : "team-switcher";
  const current = team.options.find((o) => o.id === team.id);
  const name = team.id === ALL_TEAMS ? "Все мои команды" : (current?.name ?? team.name);
  const lead = current?.relation === "leader";
  return (
    <div className={cn("sv-team-switch min-w-0", compact && "sv-team-switch--compact flex-1")}>
      <span className={cn("sv-team-switch__trigger pointer-events-none max-w-full", pending && "opacity-60")} aria-hidden="true">
        {!compact ? <Users className="h-[18px] w-[18px] shrink-0 text-text-secondary" strokeWidth={1.5} /> : null}
        <span className="sv-team-switch__name">{name}</span>
        {lead && !compact ? <span className="sv-team-switch__role">руководитель</span> : null}
        <ChevronDown className="h-[18px] w-[18px] shrink-0 text-text-secondary" strokeWidth={1.5} />
      </span>
      <label htmlFor={id} className="sr-only">
        Команда
      </label>
      <select
        id={id}
        value={team.id ?? ""}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => {
          const next = e.target.value;
          // Выбор остаётся прежним: список управляемый, React вернёт значение текущей команды
          if (next === MANAGE) {
            router.push("/people/teams");
            return;
          }
          start(async () => {
            const r = await setTeamAction(next);
            if (!r.ok) notify(r.error, "error");
            router.refresh();
          });
        }}
        className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-control opacity-0"
      >
        {team.options.map((o) => (
          <option key={o.id} value={o.id}>
            {`${"  ".repeat(o.depth)}${o.name}`}
          </option>
        ))}
        <option value={ALL_TEAMS}>Все мои команды</option>
        <option value={MANAGE}>Управлять командами</option>
      </select>
    </div>
  );
}
