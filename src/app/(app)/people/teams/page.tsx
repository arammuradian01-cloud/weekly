import type { Metadata } from "next";
import { currentActor } from "@/lib/action-runner";
import { teamsView } from "@/lib/org/teams";
import { WeeklyTeams } from "@/components/teams/weekly-teams";

export const metadata: Metadata = { title: "Люди: weekly-команды" };

/**
 * Weekly-команды (этап 64): один экран для списка команд и их состава. Команда из адреса (?team=) открывается
 * карточкой: панелью справа на ноутбуке, отдельным экраном на телефоне
 */
export default async function WeeklyTeamsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  const view = await teamsView(await currentActor(), { focus: team ?? null });
  return <WeeklyTeams view={view} />;
}
