"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Inbox,
  ScrollText,
  SquareCheck,
  Newspaper,
  RefreshCw,
  Settings,
  Users,
  Target,
  Gavel,
  TrendingUp,
  Mail,
  MessagesSquare,
  Rocket,
  Menu,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useInboxCount } from "@/components/inbox/inbox-count";
import { Drawer } from "@/components/ui/overlays";

// Разделы ресурса (этап 41: группы). Вид по дизайн-системе (navigation/Sidebar.jsx, BottomNav.jsx): боковое меню 248
// на тёмно-синем с подписями групп, на 1024-1259 только иконки, на телефоне нижнее меню из четырёх пунктов и «Ещё»
// со всеми остальными. Иконки Lucide с обводкой 1,5

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
  /** Только руководителям команд, владельцу и администраторам */
  leaderOnly?: boolean;
  /** Подпись в нижнем меню телефона, если полная не влезает */
  shortLabel?: string;
};

export type NavGroup = { label: string; items: NavItem[] };

/** Группы бокового меню: своё, команда, бизнес. «Управление» ниже, по ролям */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Моё",
    items: [
      { href: "/", label: "Моя неделя", icon: CalendarDays },
      { href: "/me", label: "Мне", icon: Inbox },
      // Встречи один на один (этап 28): у руководителей и у людей их команд, только при личном входе
      { href: "/one-on-one", label: "Один на один", icon: MessagesSquare },
    ],
  },
  {
    label: "Команда",
    items: [
      { href: "/weekly", label: "Weekly", icon: Newspaper },
      { href: "/tasks", label: "Задачи", icon: SquareCheck },
      // Люди (этап 41): команда, панель руководителя, структура и аналитика вкладками одной страницы
      { href: "/people", label: "Люди", icon: Users },
      { href: "/goals", label: "Цели", icon: Target },
      { href: "/initiatives", label: "Инициативы", icon: Rocket },
      { href: "/decisions", label: "Решения", icon: Gavel },
    ],
  },
  {
    label: "Бизнес",
    items: [{ href: "/forecast", label: "Прогноз", icon: TrendingUp }],
  },
];

export const MAIN_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export const MANAGEMENT_NAV: NavItem[] = [
  { href: "/ceo-report", label: "Отчёт CEO", icon: Mail },
  { href: "/journal", label: "Журнал", icon: ScrollText },
  { href: "/sync", label: "Синхронизация", icon: RefreshCw, ownerOnly: true },
  { href: "/settings", label: "Настройки", icon: Settings },
];

/** Четыре пункта нижнего меню телефона, пятый «Ещё» */
const MOBILE_MAIN = ["/", "/me", "/weekly", "/tasks"];

/** Прежние адреса страниц про людей (до этапа 41): остаются ради ссылок и закладок, перенаправляются */
export const PEOPLE_REDIRECTS: Record<string, string> = { "/team": "/people", "/my-teams": "/people/leader", "/structure": "/people/structure", "/analytics": "/people/analytics" };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Счётчик рядом с «Мне»: число словами для экранного диктора */
function countLabel(n: number) {
  return n ? `, ждут ${n}` : "";
}

/** Пункты бокового меню группами и «Управление» (в режиме управления) */
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
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          <div className="sv-sidebar__group">{g.label}</div>
          <div className="sv-sidebar__nav">{g.items.filter((i) => !i.leaderOnly || leader).map(link)}</div>
        </div>
      ))}
      {management ? (
        <div>
          <div className="sv-sidebar__group">Управление</div>
          <div className="sv-sidebar__nav">{managementItems.map(link)}</div>
        </div>
      ) : null}
    </nav>
  );
}

/** Пункты нижнего меню телефона: четыре главных, остальные за «Ещё» */
export function mobileItems(): NavItem[] {
  return MOBILE_MAIN.map((href) => MAIN_NAV.find((i) => i.href === href)!);
}

export function MobileNav({ leader = false, management = null }: { leader?: boolean; management?: "OWNER" | "ADMIN" | null }) {
  const pathname = usePathname();
  const inbox = useInboxCount();
  const [more, setMore] = useState(false);
  const rest: NavGroup[] = [
    ...NAV_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => !MOBILE_MAIN.includes(i.href) && (!i.leaderOnly || leader)) })).filter((g) => g.items.length),
    ...(management ? [{ label: "Управление", items: MANAGEMENT_NAV.filter((i) => !i.ownerOnly || management === "OWNER") }] : []),
  ];
  const moreActive = rest.some((g) => g.items.some((i) => isActive(pathname, i.href)));
  return (
    <>
      <nav aria-label="Разделы" className="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="sv-bottom-nav m-0 list-none">
          {mobileItems().map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            const count = item.href === "/me" ? inbox : 0;
            return (
              <li key={item.href} className="contents">
                <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("sv-bottom-nav__item", active && "is-active")}>
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
          <li className="contents">
            <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more} className={cn("sv-bottom-nav__item", moreActive && "is-active")}>
              <span className="sv-bottom-nav__icon">
                <Menu className="h-[22px] w-[22px]" strokeWidth={1.5} aria-hidden="true" />
              </span>
              Ещё
            </button>
          </li>
        </ul>
      </nav>
      <Drawer open={more} onOpenChange={setMore} title="Разделы" description="Всё, что есть на ноутбуке, есть и здесь">
        <nav aria-label="Остальные разделы" className="flex flex-col gap-4">
          {rest.map((g) => (
            <div key={g.label}>
              <p className="mb-1 text-caption font-semibold text-text-secondary">{g.label}</p>
              <ul className="m-0 flex list-none flex-col">
                {g.items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(pathname, item.href);
                  return (
                    <li key={item.href}>
                      <Link href={item.href} onClick={() => setMore(false)} aria-current={active ? "page" : undefined} className={cn("flex h-12 items-center gap-3 rounded-lg px-2 text-lead text-ink hover:bg-field", active && "bg-accent-soft font-semibold")}>
                        <Icon className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </Drawer>
    </>
  );
}
