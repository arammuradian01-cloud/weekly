"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { isWeekKey } from "@/lib/weekly/weeks";

export function WeeklyNav({ received }: { received: boolean }) {
  const path = usePathname();
  const week = useSearchParams().get("week");
  const query = isWeekKey(week) ? `?week=${week}` : "";
  const items = [{ href: "/weekly", label: "Лента weekly" }, { href: "/weekly/submit", label: "Мой weekly" }, ...(received ? [{ href: "/weekly/received", label: "Отчёт по моей команде" }] : [])];
  return (
    <nav aria-label="Разделы weekly" className="mb-5 border-b border-line">
      <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
        {items.map((item) => <li key={item.href}><Link href={`${item.href}${item.href === "/weekly/submit" ? "" : query}`} aria-current={path === item.href ? "page" : undefined} className={cn("inline-flex min-h-11 items-center rounded-t-lg px-3 py-2 text-body", path === item.href ? "bg-accent-soft font-semibold text-ink" : "text-muted hover:text-ink")}>{item.label}</Link></li>)}
      </ul>
    </nav>
  );
}
