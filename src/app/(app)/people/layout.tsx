import { requireContext } from "@/lib/auth";
import { currentTeam, subjectOf } from "@/lib/org/current";
import { PageHeader } from "@/components/page-header";
import { PeopleTabs } from "@/components/people/people-tabs";

/**
 * Люди (этап 41): одна страница вместо четырёх. Команда (таблица людей выбранной команды), панель руководителя,
 * структура и аналитика вкладками. Вкладки руководителя видят руководители команд, владелец и администраторы
 */
export default async function PeopleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const subject = subjectOf(ctx);
  const team = await currentTeam(subject);
  const leader = !subject.limited && (team.scope.leads.length > 0 || ctx.person.role === "OWNER" || ctx.person.role === "ADMIN");
  return (
    <>
      <PageHeader title="Люди" description="Кто с кем работает и что у людей в работе: команда за неделю, панель руководителя, структура и аналитика" tabs={<PeopleTabs leader={leader} />} />
      {children}
    </>
  );
}
