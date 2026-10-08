import { requireContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { ROLE_LABELS } from "@/lib/roles";
import { formatTime, reportingWeek, type DeadlineSetting } from "@/lib/week";
import { SidebarBrand, Wordmark } from "@/components/brand/wordmark";
import { MobileNav, SidebarNav } from "@/components/shell/nav";
import { ProfileMenu } from "@/components/shell/profile-menu";
import { PrototypeProvider } from "@/domain/store";
import { DeviceSync } from "@/components/pwa/device-sync";
import { fromCalendar } from "@/domain/dates";
import { moscowDate } from "@/lib/week";
import { PrototypeBanner } from "@/components/prototype/banner";
import { Toaster } from "@/components/prototype/toaster";
import { GlobalHotkeys } from "@/components/prototype/new-task";
import { RequestDialogHost } from "@/components/requests/request-dialog";
import { SearchButton, TopBar } from "@/components/shell/top-bar";
import { ThemeToggle } from "@/components/shell/theme-switch";
import { CommandPalette } from "@/components/shell/command-palette";
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
  const reportingKey = fromCalendar(week.start);
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
    inboxCount(ctx.person.id, new Date(), subjectOf(ctx)),
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
      limited={subject.limited}
      initialTasks={tasks}
      registry={registry}
      team={teamView}
      leads={team.scope.leads}
    >
    <TaskActionsProvider>
    <InboxCountProvider initial={inbox}>
    {/* Оболочка по дизайн-системе (layout/AppShell.jsx): тёмно-синее меню 248 (на 1024-1259 иконками),
        верхняя панель с командой, неделей, поиском и «Новой задачей»; на телефоне компактная шапка и нижнее меню */}
    <div className="sv-shell min-h-dvh">
      <aside className="sv-shell__side sticky top-0 h-dvh self-start">
        <div className="sv-sidebar overflow-y-auto">
          <a className="sv-sidebar__skip" href="#content">
            Перейти к содержимому
          </a>
          <SidebarBrand />
          <SidebarNav management={profile.management} leader={leader} />
          <div className="sv-sidebar__spacer" />
          <div className="sv-sidebar__profile">
            <ProfileMenu {...profile} tone="dark" />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="sv-shell__top sticky top-0 z-20">
        <TopBar reportingKey={reportingKey} managementUntil={managementUntil} canCreate={ctx.person.role !== "OBSERVER"} />
      </div>

      <div className="sv-shell__header sticky top-0 z-20">
        <header className="sv-site-header">
          <div className="sv-site-header__row h-14 gap-2 px-4 sm:px-5">
            <Wordmark tone="light" compact />
            <TeamSwitcher compact />
            <div className="sv-site-header__actions ml-auto">
              <SearchButton compact />
              <ProfileMenu {...profile} tone="light" />
            </div>
          </div>
        </header>
      </div>

      <div className="flex min-w-0 flex-col lg:col-start-2">
        {lagging ? (
          <div role="status" className="sv-alert sv-alert--warning rounded-none border-b border-warning-line px-4 sm:px-6 lg:px-[var(--content-pad)]">
            <span>
              Правки не уходят в Google-таблицу больше 30 минут: Google не отвечает или нет доступа к таблице для просмотра. Изменения ждут в очереди и не теряются.{" "}
              {ctx.management?.role === "OWNER" ? (
                <Link href="/sync" className="font-semibold underline underline-offset-2">
                  Открыть синхронизацию
                </Link>
              ) : (
                "Подробности у владельца на странице «Синхронизация»."
              )}
            </span>
          </div>
        ) : null}
        <PrototypeBanner mode={banner} ownerName={owner?.fullName ?? null} />
        <main className="sv-shell__main flex-1 max-lg:pb-28" id="content" tabIndex={-1}>
          <div className="sv-shell__content">{children}</div>
        </main>
      </div>
    </div>

    <MobileNav leader={leader} />
    <Toaster />
    <GlobalHotkeys />
    <CommandPalette management={profile.management} />
    <RequestDialogHost />
    <DeviceSync />
    </InboxCountProvider>
    </TaskActionsProvider>
    </PrototypeProvider>
  );
}
