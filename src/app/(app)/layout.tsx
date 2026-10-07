import { requireContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { ROLE_LABELS } from "@/lib/roles";
import { formatTime, formatWeekRange, reportingWeek, type DeadlineSetting } from "@/lib/week";
import { Wordmark } from "@/components/brand/wordmark";
import { MobileNav, SidebarNav } from "@/components/shell/nav";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { PrototypeProvider } from "@/domain/store";
import { fromCalendar } from "@/domain/dates";
import { moscowDate } from "@/lib/week";
import { PrototypeBanner } from "@/components/prototype/banner";
import { Toaster } from "@/components/prototype/toaster";
import { GlobalHotkeys } from "@/components/prototype/new-task";
import { HeaderSearch } from "@/components/prototype/header-search";
import { TaskActionsProvider } from "@/components/tasks/task-actions";
import { listTasks } from "@/lib/tasks/service";
import { loadRegistry } from "@/lib/registry";
import { syncLagging } from "@/lib/sheet/runner";
import { getStandBanner } from "@/lib/admin/service";
import { prisma } from "@/lib/db";
import { inboxCount } from "@/lib/inbox/service";
import { InboxCountProvider } from "@/components/inbox/inbox-count";
import { TeamSwitcher } from "@/components/shell/team-switcher";
import { currentTeam, subjectOf } from "@/lib/org/current";
import { ALL_TEAMS } from "@/domain/teams";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const deadline = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const week = reportingWeek(new Date(), deadline);
  const managementUntil = ctx.management ? formatTime(new Date(ctx.management.until)) : null;
  // Сроки считаются от сегодняшней даты по Москве: одинаково на сервере и в браузере
  const today = fromCalendar(moscowDate(new Date()));
  // Выбранная команда (этап 14): задачи этой команды и свои задачи в любой команде
  const subject = subjectOf(ctx);
  const team = await currentTeam(subject);
  const reader = { personId: ctx.person.id, role: ctx.person.role, limited: subject.limited };
  // Задачи из базы (этап 3). Архив виден только владельцу в режиме управления
  const [tasks, registry, lagging, banner, owner, inbox, slugs] = await Promise.all([
    listTasks({ archived: ctx.management?.role === "OWNER", reader, team: team.id && team.id !== ALL_TEAMS ? team.id : undefined }),
    loadRegistry(),
    // Отставание таблицы видят только в режиме управления: остальным оно ничего не говорит
    ctx.management ? syncLagging() : Promise.resolve(false),
    getStandBanner(),
    prisma.person.findFirst({ where: { role: "OWNER", active: true }, orderBy: { sortOrder: "asc" }, select: { fullName: true } }),
    inboxCount(ctx.person.id),
    prisma.person.findMany({ where: { id: { in: team.people } }, select: { slug: true } }),
  ]);
  const teamView = { id: team.id, name: team.name, people: slugs.map((p) => p.slug), options: team.options };
  // Панель «Мои команды» (этап 16): руководителям команд, владельцу и администраторам
  const leader = !subject.limited && (team.scope.leads.length > 0 || ctx.person.role === "OWNER" || ctx.person.role === "ADMIN");

  const profile = {
    fullName: ctx.person.fullName,
    shortName: ctx.person.shortName,
    // Сотрудник, который руководит командой, подписан как руководитель (этап 14)
    roleLabel: ctx.person.role === "EMPLOYEE" && team.scope.leads.length ? "Руководитель команды" : ROLE_LABELS[ctx.person.role],
    canManage: ctx.managementRole !== null,
    management: ctx.management?.role ?? null,
    managementUntil,
    personal: ctx.via !== "TEAM",
  };

  return (
    <PrototypeProvider
      today={today}
      me={ctx.person.slug}
      manageRole={ctx.management?.role ?? null}
      observer={ctx.person.role === "OBSERVER"}
      initialTasks={tasks}
      registry={registry}
      team={teamView}
      leads={team.scope.leads}
    >
    <TaskActionsProvider>
    <InboxCountProvider initial={inbox}>
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between bg-navy px-3 py-5 lg:flex">
        <div className="flex flex-col gap-8">
          <div className="px-2">
            <Wordmark />
          </div>
          <SidebarNav management={profile.management} leader={leader} />
        </div>
        <ProfileMenu {...profile} tone="dark" />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6 lg:h-16 lg:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
            <Wordmark tone="light" compact />
            <TeamSwitcher compact />
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-6 lg:flex">
            <TeamSwitcher />
            <div className="flex shrink-0 items-baseline gap-2">
              <span className="text-body font-semibold text-ink">Неделя {week.week}</span>
              <span className="text-small text-muted">{formatWeekRange(week)}</span>
            </div>
            <HeaderSearch />
          </div>
          <div className="flex items-center gap-3">
            {managementUntil ? (
              <span className="hidden rounded-md bg-blue-soft px-2.5 py-1 text-caption font-medium text-blue-700 sm:inline">
                Режим управления до {managementUntil}
              </span>
            ) : null}
            <div className="lg:hidden">
              <ProfileMenu {...profile} tone="light" />
            </div>
          </div>
        </header>

        {lagging ? (
          <div role="status" className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-small text-warning-ink sm:px-6 lg:px-10">
            Правки не уходят в Google-таблицу больше 30 минут: Google не отвечает или нет доступа к таблице для просмотра. Изменения ждут в очереди и не теряются.{" "}
            {ctx.management?.role === "OWNER" ? (
              <Link href="/sync" className="font-medium underline underline-offset-2">
                Открыть синхронизацию
              </Link>
            ) : (
              "Подробности у владельца на странице «Синхронизация»."
            )}
          </div>
        ) : null}
        <PrototypeBanner mode={banner} ownerName={owner?.fullName ?? null} />
        <main className="mx-auto w-full max-w-page flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">{children}</main>
      </div>

      <MobileNav leader={leader} />
      <Toaster />
      <GlobalHotkeys />
    </div>
    </InboxCountProvider>
    </TaskActionsProvider>
    </PrototypeProvider>
  );
}
