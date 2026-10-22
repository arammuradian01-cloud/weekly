"use client";

// Вкладки страницы «Люди» (этап 41): команда, панель руководителя, структура, weekly-команды (этап 64), аналитика.
// Активная по адресу.
// Выбранная команда (?team=) переходит между «Руководителю» и «Аналитикой», чтобы не терять, куда спустились

import { usePathname, useSearchParams } from "next/navigation";
import { PageTabs } from "@/components/ui/data";

export function PeopleTabs({ panel, analytics }: { panel: boolean; analytics: boolean }) {
  const pathname = usePathname();
  const team = useSearchParams().get("team");
  const withTeam = (href: string) => (team ? `${href}?team=${encodeURIComponent(team)}` : href);
  const tabs = [
    { href: "/people", label: "Команда", active: pathname === "/people", testId: "people-tab-team" },
    ...(panel ? [{ href: withTeam("/people/leader"), label: "Руководителю", active: pathname.startsWith("/people/leader"), testId: "people-tab-leader" }] : []),
    { href: "/people/structure", label: "Структура", active: pathname.startsWith("/people/structure"), testId: "people-tab-structure" },
    // Этап 64: один экран для команд и их состава вместо «Weekly-проектов» этапа 57. Видят все: свои команды хотя бы для просмотра
    { href: "/people/teams", label: "Weekly-команды", active: pathname.startsWith("/people/teams") || pathname.startsWith("/people/projects"), testId: "people-tab-teams" },
    ...(analytics ? [{ href: withTeam("/people/analytics"), label: "Аналитика", active: pathname.startsWith("/people/analytics"), testId: "people-tab-analytics" }] : []),
  ];
  return <PageTabs tabs={tabs} label="Разделы страницы «Люди»" />;
}
