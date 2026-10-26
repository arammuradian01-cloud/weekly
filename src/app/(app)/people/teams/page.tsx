import type { Metadata } from "next";
import { currentActor } from "@/lib/action-runner";
import { focusTeam } from "@/lib/org/teams";
import { WeeklyTeams } from "@/components/teams/weekly-teams";

export const metadata: Metadata = { title: "Люди: weekly-команды" };

/**
 * Weekly-команды (этап 64): один экран для списка команд и их состава. Команда из адреса (?team=) открывается
 * карточкой: панелью справа на ноутбуке, отдельным экраном на телефоне. Список и остальное считает layout экрана,
 * страница только выбранную команду (этап 70): смена команды стоит одну команду, а не весь экран
 */
export default async function WeeklyTeamsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  const focus = team ? await focusTeam(await currentActor(), team) : null;
  return <WeeklyTeams focus={focus} />;
}
