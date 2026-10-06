"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const VIEWS = [
  { href: "/tasks", label: "Список" },
  { href: "/tasks/board", label: "Доска" },
  { href: "/tasks/mine", label: "Мои задачи" },
  { href: "/tasks/review", label: "Разбор на встрече" },
];

/** Виды раздела «Задачи»: у каждого свой адрес, чтобы им можно было делиться */
export function TasksNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Виды задач" className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {VIEWS.map((v) => {
          const active = pathname === v.href;
          return (
            <li key={v.href}>
              <Link
                href={v.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-11 items-center px-3 text-body transition-colors",
                  active ? "font-semibold text-ink" : "text-muted hover:text-ink",
                )}
              >
                {v.label}
                {active ? <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-blue" aria-hidden="true" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
