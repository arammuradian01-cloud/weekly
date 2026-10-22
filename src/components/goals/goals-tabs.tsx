import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Вкладки страницы «Цели» (этап 65): цели квартала таблицей или деревом и «Связать задачи с целями». Квартал из адреса
 * переходит на другую вкладку. На телефоне вкладка высотой 44 px: в неё легко попасть пальцем
 */
export function GoalsTabs({ link, quarter }: { link: boolean; quarter: string | null }) {
  const q = quarter && /^\d{4}-Q[1-4]$/.test(quarter) ? quarter : null;
  const tabs = [
    { href: q ? `/goals?q=${q}` : "/goals", label: "Цели квартала", active: !link, testId: "goals-tab-goals" },
    { href: q ? `/goals?mode=link&q=${q}` : "/goals?mode=link", label: "Связать задачи с целями", active: link, testId: "goals-tab-link" },
  ];
  return (
    <nav className="sv-tabs mt-4" aria-label="Разделы страницы «Цели»">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={cn("sv-tabs__item max-sm:h-11", t.active && "is-active")} aria-current={t.active ? "page" : undefined} data-testid={t.testId}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
