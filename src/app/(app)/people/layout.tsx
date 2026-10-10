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
  // Панель руководителя: руководителям команд, владельцу и администраторам, в том числе под общим логином (как «Мои
  // команды» раньше). Аналитика только при личном входе: под общим логином она пустая
  const panel = team.scope.leads.length > 0 || ctx.person.role === "OWNER" || ctx.person.role === "ADMIN";
  const analytics = panel && !subject.limited;
  return (
    <>
      <PageHeader
        title="Люди"
        description={panel ? "Кто с кем работает и что у людей в работе: команда за неделю, панель руководителя, структура и аналитика" : "Кто с кем работает: команда за неделю и структура департамента"}
        tabs={<PeopleTabs panel={panel} analytics={analytics} />}
      />
      {children}
    </>
  );
}
