"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";

/** Поиск по тексту и номеру задачи из шапки. «/» ставит в него курсор с любой страницы */
export function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="relative hidden w-full max-w-[320px] md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const query = q.trim();
        router.push(query ? `/tasks?q=${encodeURIComponent(query)}` : "/tasks");
      }}
    >
      <label htmlFor="global-search" className="sr-only">
        Поиск задач по тексту или номеру
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        id="global-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск задач"
        aria-keyshortcuts="/"
        className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-10 text-body text-ink placeholder:text-muted focus:border-blue focus:bg-white focus:outline-none focus:ring-3 focus:ring-blue/25"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line bg-white px-1.5 text-tiny text-muted" aria-hidden="true">
        /
      </kbd>
    </form>
  );
}
