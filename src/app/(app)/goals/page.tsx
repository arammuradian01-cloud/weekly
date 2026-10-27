import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { goalsView } from "@/lib/goals/service";
import { goalLinkBoard } from "@/lib/goals/link-board";
import { BORD_GOAL_TABS } from "@/lib/goals/bord";
import { parseGroup, parsePeople } from "@/lib/goals/by-person";
import { ALL_TEAMS, currentTeam, subjectOf } from "@/lib/org/current";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import { GoalsScreen } from "@/components/goals/goals-screen";
import { GoalsLink } from "@/components/goals/goals-link";
import { GoalsTabs } from "@/components/goals/goals-tabs";

export const metadata: Metadata = { title: "Цели" };

/**
 * Сквозные цели (этап 17): дерево целей квартала от департамента до команд и людей, прогресс и риски.
 * Вкладка «Связать задачи с целями» (этап 65, адрес ?mode=link): задачи к целям перетаскиванием.
 * Чьи цели показать и как сгруппировать лежит в адресе: ?people=slug,slug (метка _none: цели без владельца) и ?group=team
 */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; find?: string | string[]; mode?: string | string[]; people?: string | string[]; group?: string | string[] }>;
}) {
  const ctx = await requireContext();
  const params = await searchParams;
  // Повтор параметра в адресе даёт массив: берём первое значение
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = first(params.q);
  const find = first(params.find);
  const link = first(params.mode) === "link";
  const subject = subjectOf(ctx);
  const who = { personId: ctx.person.id, role: ctx.person.role, management: ctx.management?.role ?? null, limited: subject.limited };

  if (link) {
    const board = await goalLinkBoard(who, { quarter: q ?? null });
    return (
      <>
        <PageHeader
          title="Цели"
          description="Перетащите задачу на цель квартала: так видно, какая работа её двигает. На телефоне и с клавиатуры нажмите «К цели» у задачи"
          tabs={<GoalsTabs link quarter={q ?? null} />}
        />
        <GoalsLink board={board} />
      </>
    );
  }

  const team = await currentTeam(subject);
  const view = await goalsView(who, { quarter: q ?? null, team: team.id && team.id !== ALL_TEAMS ? team.id : null });
  const bordOn = ctx.management?.role === "OWNER" && !!(await getSetting<string | null>("bord.sourceId", null));
  return (
    <>
      <PageHeader
        title="Цели"
        description={team.id && team.id !== ALL_TEAMS ? `Цели команды «${team.name}» и команд ниже, и цели выше, на которые они работают` : "Цели департамента, команд и людей"}
        tabs={<GoalsTabs link={false} quarter={q ?? null} />}
      />
      <GoalsScreen view={view} defaultTeam={team.id && team.id !== ALL_TEAMS ? team.id : (view.creatable[0]?.id ?? null)} bordTabs={bordOn ? BORD_GOAL_TABS : null}
        leaderBoard={!!ctx.management && ctx.person.role !== "OBSERVER"}
        initialQuery={find?.slice(0, 80) ?? ""}
        initialPeople={parsePeople(first(params.people))}
        initialGroup={parseGroup(first(params.group))}
      />
    </>
  );
}
