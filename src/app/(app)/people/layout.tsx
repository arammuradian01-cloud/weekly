import { requireContext } from "@/lib/auth";
import { currentTeam, subjectOf } from "@/lib/org/current";
import { peopleTree } from "@/lib/org/people-tree";
import { PageHeader } from "@/components/page-header";
import { PeopleTabs } from "@/components/people/people-tabs";
import { PersonCardProvider } from "@/components/people/person-card";

/**
 * Люди (этап 41): одна страница вместо четырёх. Команда (таблица людей выбранной команды), панель руководителя,
 * структура и аналитика вкладками. Вкладки руководителя видят руководители команд, владелец и администраторы
 */
export default async function PeopleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const subject = subjectOf(ctx);
  // Дерево подчинённых один раз на все вкладки: из него карточка человека (этап 45)
  const [team, tree] = await Promise.all([currentTeam(subject), peopleTree(subject)]);
  // Панель руководителя: руководителям команд, владельцу и администраторам, в том числе под общим логином (как «Мои
  // команды» раньше). Аналитика только при личном входе: под общим логином она пустая
  const panel = team.scope.leads.length > 0 || ctx.person.role === "OWNER" || ctx.person.role === "ADMIN";
  const analytics = panel && !subject.limited;
  return (
    <PersonCardProvider tree={tree} me={ctx.person.slug}>
      <PageHeader
        title="Люди"
        description={panel ? "Команда за неделю, структура, weekly-команды и аналитика" : "Команда за неделю, структура компании и weekly-команды"}
        tabs={<PeopleTabs panel={panel} analytics={analytics} />}
      />
      {children}
    </PersonCardProvider>
  );
}
