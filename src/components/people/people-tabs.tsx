"use client";

// Вкладки страницы «Люди» (этап 41): команда, панель руководителя, структура, аналитика. Активная по адресу

import { usePathname } from "next/navigation";
import { PageTabs } from "@/components/ui/data";

export function PeopleTabs({ leader }: { leader: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: "/people", label: "Команда", active: pathname === "/people", testId: "people-tab-team" },
    ...(leader ? [{ href: "/people/leader", label: "Руководителю", active: pathname.startsWith("/people/leader"), testId: "people-tab-leader" }] : []),
    { href: "/people/structure", label: "Структура", active: pathname.startsWith("/people/structure"), testId: "people-tab-structure" },
    ...(leader ? [{ href: "/people/analytics", label: "Аналитика", active: pathname.startsWith("/people/analytics"), testId: "people-tab-analytics" }] : []),
  ];
  return <PageTabs tabs={tabs} label="Разделы страницы «Люди»" />;
}
