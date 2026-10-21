"use client";

// Вкладки страницы «Люди» (этап 41): команда, панель руководителя, структура, аналитика. Активная по адресу.
// Выбранная команда (?team=) переходит между «Руководителю» и «Аналитикой», чтобы не терять, куда спустились

import { usePathname, useSearchParams } from "next/navigation";
import { PageTabs } from "@/components/ui/data";

export function PeopleTabs({ panel, analytics, projects = false }: { panel: boolean; analytics: boolean; projects?: boolean }) {
  const pathname = usePathname();
  const team = useSearchParams().get("team");
  const withTeam = (href: string) => (team ? `${href}?team=${encodeURIComponent(team)}` : href);
  const tabs = [
    { href: "/people", label: "Команда", active: pathname === "/people", testId: "people-tab-team" },
    ...(panel ? [{ href: withTeam("/people/leader"), label: "Руководителю", active: pathname.startsWith("/people/leader"), testId: "people-tab-leader" }] : []),
    { href: "/people/structure", label: "Структура", active: pathname.startsWith("/people/structure"), testId: "people-tab-structure" },
    // Этап 57: готовые команды по структуре и свои weekly-проекты руководителей
    ...(projects ? [{ href: "/people/projects", label: "Weekly-проекты", active: pathname.startsWith("/people/projects"), testId: "people-tab-projects" }] : []),
    ...(analytics ? [{ href: withTeam("/people/analytics"), label: "Аналитика", active: pathname.startsWith("/people/analytics"), testId: "people-tab-analytics" }] : []),
  ];
  return <PageTabs tabs={tabs} label="Разделы страницы «Люди»" />;
}
