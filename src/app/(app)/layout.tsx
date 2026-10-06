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
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const deadline = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const week = reportingWeek(new Date(), deadline);
  const managementUntil = ctx.management ? formatTime(new Date(ctx.management.until)) : null;
  // Сроки считаются от сегодняшней даты по Москве: одинаково на сервере и в браузере
  const today = fromCalendar(moscowDate(new Date()));
  // Задачи из базы (этап 3). Архив виден только владельцу в режиме управления
  const [tasks, registry, lagging, banner, owner] = await Promise.all([
    listTasks({ archived: ctx.management?.role === "OWNER" }),
    loadRegistry(),
    // Отставание таблицы видят только в режиме управления: остальным оно ничего не говорит
    ctx.management ? syncLagging() : Promise.resolve(false),
    getStandBanner(),
    prisma.person.findFirst({ where: { role: "OWNER", active: true }, orderBy: { sortOrder: "asc" }, select: { fullName: true } }),
  ]);

  const profile = {
    fullName: ctx.person.fullName,
    shortName: ctx.person.shortName,
    roleLabel: ROLE_LABELS[ctx.person.role],
    canManage: ctx.managementRole !== null,
    management: ctx.management?.role ?? null,
    managementUntil,
  };

  return (
    <PrototypeProvider
      today={today}
      me={ctx.person.slug}
      manageRole={ctx.management?.role ?? null}
      observer={ctx.person.role === "OBSERVER"}
      initialTasks={tasks}
      registry={registry}
    >
    <TaskActionsProvider>
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col justify-between bg-navy px-3 py-5 lg:flex">
        <div className="flex flex-col gap-8">
          <div className="px-2">
            <Wordmark />
          </div>
          <SidebarNav management={profile.management} />
        </div>
        <ProfileMenu {...profile} tone="dark" />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6 lg:h-16 lg:px-10">
          <div className="lg:hidden">
            <Wordmark tone="light" compact />
          </div>
          <div className="hidden min-w-0 flex-1 items-center gap-6 lg:flex">
            <div className="flex shrink-0 items-baseline gap-2">
              <span className="text-[15px] font-semibold text-ink">Неделя {week.week}</span>
              <span className="text-[14px] text-muted">{formatWeekRange(week)}</span>
            </div>
            <HeaderSearch />
          </div>
          <div className="flex items-center gap-3">
            {managementUntil ? (
              <span className="hidden rounded-md bg-blue-soft px-2.5 py-1 text-[13px] font-medium text-blue-700 sm:inline">
                Режим управления до {managementUntil}
              </span>
            ) : null}
            <div className="lg:hidden">
              <ProfileMenu {...profile} tone="light" />
            </div>
          </div>
        </header>

        {lagging ? (
          <div role="status" className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-[14px] text-warning-ink sm:px-6 lg:px-10">
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
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-8">{children}</main>
      </div>

      <MobileNav />
      <Toaster />
      <GlobalHotkeys />
    </div>
    </TaskActionsProvider>
    </PrototypeProvider>
  );
}
