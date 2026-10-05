"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck2,
  FileText,
  History,
  ListChecks,
  Newspaper,
  RefreshCw,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

export type NavItem = { href: string; label: string; icon: LucideIcon; ownerOnly?: boolean };

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Моя неделя", icon: CalendarCheck2 },
  { href: "/weekly", label: "Weekly", icon: Newspaper },
  { href: "/tasks", label: "Задачи", icon: ListChecks },
  { href: "/team", label: "Команда", icon: Users },
];

export const MANAGEMENT_NAV: NavItem[] = [
  { href: "/ceo-report", label: "Отчёт CEO", icon: FileText },
  { href: "/journal", label: "Журнал", icon: History },
  { href: "/sync", label: "Синхронизация", icon: RefreshCw, ownerOnly: true },
  { href: "/settings", label: "Настройки", icon: Settings2 },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ management }: { management: "OWNER" | "ADMIN" | null }) {
  const pathname = usePathname();
  const managementItems = MANAGEMENT_NAV.filter((i) => !i.ownerOnly || management === "OWNER");
  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "relative flex h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors",
            active ? "bg-white/10 font-semibold text-white" : "text-white/75 hover:bg-white/6 hover:text-white",
          )}
        >
          {active ? <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue" aria-hidden="true" /> : null}
          <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
          {item.label}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label="Разделы" className="flex flex-col gap-6">
      <ul className="flex flex-col gap-1">{MAIN_NAV.map(link)}</ul>
      {management ? (
        <div>
          <p className="mb-2 px-3 text-[13px] text-white/50">Управление</p>
          <ul className="flex flex-col gap-1">{managementItems.map(link)}</ul>
        </div>
      ) : null}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {MAIN_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[12px]",
                  active ? "font-semibold text-blue-700" : "text-muted",
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
