"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Inbox,
  ScrollText,
  SquareCheck,
  Newspaper,
  Network,
  RefreshCw,
  Settings,
  Contact,
  Users,
  Target,
  Gavel,
  TrendingUp,
  Mail,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useInboxCount } from "@/components/inbox/inbox-count";

// Разделы ресурса. Вид по дизайн-системе (navigation/Sidebar.jsx, BottomNav.jsx): боковое меню 248 на тёмно-синем,
// на 1024-1259 только иконки, на телефоне нижнее меню из пяти пунктов. Иконки Lucide с обводкой 1,5

export type NavItem = { href: string; label: string; icon: LucideIcon; ownerOnly?: boolean; desktopOnly?: boolean; leaderOnly?: boolean; /** Подпись в нижнем меню телефона, если полная не влезает */ shortLabel?: string };

export const MAIN_NAV: NavItem[] = [
  { href: "/", label: "Моя неделя", icon: CalendarDays },
  { href: "/me", label: "Мне", icon: Inbox },
  // Панель руководителя (этап 16): на телефоне встаёт на место «Команды»
  { href: "/my-teams", label: "Мои команды", shortLabel: "Команды", icon: Users, leaderOnly: true },
  { href: "/weekly", label: "Weekly", icon: Newspaper },
  { href: "/tasks", label: "Задачи", icon: SquareCheck },
  // Сквозные цели (этап 17): на телефоне открываются из «Моих команд»
  { href: "/goals", label: "Цели", icon: Target, desktopOnly: true },
  { href: "/decisions", label: "Решения", icon: Gavel, desktopOnly: true },
  // Цифры недели и прогноз (этап 24): на телефоне открывается из Weekly
  { href: "/forecast", label: "Прогноз", icon: TrendingUp, desktopOnly: true },
  { href: "/team", label: "Команда", icon: Contact },
  // В нижнем меню телефона пять пунктов: «Структура» открывается со страницы «Команда»
  { href: "/structure", label: "Структура", icon: Network, desktopOnly: true },
];

export const MANAGEMENT_NAV: NavItem[] = [
  { href: "/ceo-report", label: "Отчёт CEO", icon: Mail },
  { href: "/journal", label: "Журнал", icon: ScrollText },
  { href: "/sync", label: "Синхронизация", icon: RefreshCw, ownerOnly: true },
  { href: "/settings", label: "Настройки", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Счётчик рядом с «Мне»: число словами для экранного диктора */
function countLabel(n: number) {
  return n ? `, ждут ${n}` : "";
}

/** Пункты бокового меню: группы «основное» и «Управление» (в режиме управления) */
export function SidebarNav({ management, leader = false }: { management: "OWNER" | "ADMIN" | null; leader?: boolean }) {
  const pathname = usePathname();
  const inbox = useInboxCount();
  const managementItems = MANAGEMENT_NAV.filter((i) => !i.ownerOnly || management === "OWNER");
  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    const Icon = item.icon;
    const count = item.href === "/me" ? inbox : 0;
    return (
      <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("sv-sidebar__item", active && "is-active")} title={item.label}>
        <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
        <span className="sv-sidebar__item__label">{item.label}</span>
        {count ? (
          <>
            <span className="sv-counter sv-counter--inverse" aria-hidden="true">
              {count > 99 ? "99+" : count}
            </span>
            <span className="sr-only">{countLabel(count)}</span>
          </>
        ) : null}
      </Link>
    );
  };

  return (
    <nav aria-label="Разделы" className="flex flex-col">
      <div className="sv-sidebar__nav">{MAIN_NAV.filter((i) => !i.leaderOnly || leader).map(link)}</div>
      {management ? (
        <div>
          <div className="sv-sidebar__group">Управление</div>
          <div className="sv-sidebar__nav">{managementItems.map(link)}</div>
        </div>
      ) : null}
    </nav>
  );
}

/** Пункты нижнего меню телефона: их пять. У руководителя «Мои команды» вместо «Команды», «Команда» открывается из панели */
export function mobileItems(leader: boolean): NavItem[] {
  return MAIN_NAV.filter((i) => !i.desktopOnly && (leader ? i.href !== "/team" : !i.leaderOnly));
}

export function MobileNav({ leader = false }: { leader?: boolean }) {
  const pathname = usePathname();
  const inbox = useInboxCount();
  return (
    <nav aria-label="Разделы" className="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="sv-bottom-nav m-0 list-none">
        {mobileItems(leader).map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          const count = item.href === "/me" ? inbox : 0;
          return (
            <li key={item.href} className="contents">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.shortLabel ? item.label : undefined}
                className={cn("sv-bottom-nav__item", active && "is-active")}
              >
                <span className="sv-bottom-nav__icon">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={1.5} aria-hidden="true" />
                  {count ? (
                    <span className="sv-counter" aria-hidden="true">
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null}
                </span>
                {item.shortLabel ?? item.label}
                {count ? <span className="sr-only">{countLabel(count)}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
