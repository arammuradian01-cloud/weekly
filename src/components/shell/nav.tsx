"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck2,
  Inbox,
  FileText,
  History,
  ListChecks,
  Newspaper,
  Network,
  RefreshCw,
  Settings2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useInboxCount } from "@/components/inbox/inbox-count";

export type NavItem = { href: string; label: string; icon: LucideIcon; ownerOnly?: boolean; desktopOnly?: boolean };

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Моя неделя", icon: CalendarCheck2 },
  { href: "/me", label: "Мне", icon: Inbox },
  { href: "/weekly", label: "Weekly", icon: Newspaper },
  { href: "/tasks", label: "Задачи", icon: ListChecks },
  { href: "/team", label: "Команда", icon: Users },
  // В нижнем меню телефона пять пунктов: «Структура» открывается со страницы «Команда»
  { href: "/structure", label: "Структура", icon: Network, desktopOnly: true },
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

/** Счётчик рядом с «Мне»: число словами для экранного диктора */
function countLabel(n: number) {
  return n ? `, ждут ${n}` : "";
}

export function SidebarNav({ management }: { management: "OWNER" | "ADMIN" | null }) {
  const pathname = usePathname();
  const inbox = useInboxCount();
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
            "relative flex h-11 items-center gap-3 rounded-lg px-3 text-body transition-colors",
            active ? "bg-white/10 font-semibold text-white" : "text-white/75 hover:bg-white/6 hover:text-white",
          )}
        >
          {active ? <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-blue" aria-hidden="true" /> : null}
          <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
          {item.label}
          {item.href === "/me" && inbox ? (
            <>
              <span className="ml-auto min-w-6 rounded-full bg-blue px-1.5 text-center text-caption font-semibold leading-6 text-navy" aria-hidden="true">
                {inbox}
              </span>
              <span className="sr-only">{countLabel(inbox)}</span>
            </>
          ) : null}
        </Link>
      </li>
    );
  };

  return (
    <nav aria-label="Разделы" className="flex flex-col gap-6">
      <ul className="flex flex-col gap-1">{MAIN_NAV.map(link)}</ul>
      {management ? (
        <div>
          <p className="mb-2 px-3 text-caption text-white/50">Управление</p>
          <ul className="flex flex-col gap-1">{managementItems.map(link)}</ul>
        </div>
      ) : null}
    </nav>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const inbox = useInboxCount();
  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {MAIN_NAV.filter((i) => !i.desktopOnly).map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-tiny",
                  active ? "font-semibold text-blue-700" : "text-muted",
                )}
              >
                <span className="relative">
                  <Icon className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                  {item.href === "/me" && inbox ? (
                    <span className="absolute -right-2.5 -top-1.5 min-w-5 rounded-full bg-blue px-1 text-center text-micro font-semibold leading-5 text-navy" aria-hidden="true">
                      {inbox}
                    </span>
                  ) : null}
                </span>
                {item.label}
                {item.href === "/me" && inbox ? <span className="sr-only">{countLabel(inbox)}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
