import { currentActor } from "@/lib/action-runner";
import { teamsView } from "@/lib/org/teams";
import { TeamsViewProvider } from "@/components/teams/weekly-teams";

/**
 * Данные экрана «Weekly-команды», не зависящие от выбранной команды: список, люди и подразделения для поиска, запросы
 * на согласие (этап 70). Layout не перерисовывается, когда меняется только ?team= в адресе: выбор команды не
 * пересчитывает на сервере весь экран. Обновление после действия (router.refresh) пересчитывает и его
 */
export default async function WeeklyTeamsLayout({ children }: { children: React.ReactNode }) {
  const view = await teamsView(await currentActor());
  return <TeamsViewProvider view={view}>{children}</TeamsViewProvider>;
}
