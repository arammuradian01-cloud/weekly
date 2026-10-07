"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Строка поиска на странице /search: запрос уходит в адрес, им можно делиться */
export function SearchForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      className="flex max-w-[640px] gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search");
      }}
    >
      <div className="relative flex-1">
        <label htmlFor="search-q" className="sr-only">
          Что ищем
        </label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          id="search-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Слова или номер задачи"
          autoFocus={!initial}
          className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-body text-ink placeholder:text-muted/80 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
        />
      </div>
      <Button type="submit">Найти</Button>
    </form>
  );
}
