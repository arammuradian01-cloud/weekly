import { requireContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { ROLE_LABELS } from "@/lib/roles";
import { formatTime, formatWeekRange, reportingWeek, type DeadlineSetting } from "@/lib/week";
import { Wordmark } from "@/components/brand/wordmark";
import { MobileNav, SidebarNav } from "@/components/shell/nav";
import { ProfileMenu } from "@/components/shell/profile-menu";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const deadline = await getSetting<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const week = reportingWeek(new Date(), deadline);
  const managementUntil = ctx.management ? formatTime(new Date(ctx.management.until)) : null;

  const profile = {
    fullName: ctx.person.fullName,
    shortName: ctx.person.shortName,
    roleLabel: ROLE_LABELS[ctx.person.role],
    canManage: ctx.managementRole !== null,
    management: ctx.management?.role ?? null,
    managementUntil,
  };

  return (
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
          <div className="hidden items-center gap-3 lg:flex">
            <span className="text-[15px] font-semibold text-ink">Неделя {week.week}</span>
            <span className="text-[15px] text-muted">{formatWeekRange(week)}</span>
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

        <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-16 lg:pt-10">{children}</main>
      </div>

      <MobileNav />
    </div>
  );
}
