"use client";

// Оглавление длинной страницы (этап 48): слева липкий список разделов с якорями, текущий раздел подсвечен по
// прокрутке. На планшете и телефоне та же лента строкой сверху. Состояние меняется только в обработчике прокрутки

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type TocItem = { id: string; label: string };

export function Toc({ items, label = "Разделы страницы", className }: { items: TocItem[]; label?: string; className?: string }) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const ids = items.map((i) => i.id).join("|");
  const ticking = useRef(false);
  useEffect(() => {
    const list = ids.split("|").filter(Boolean);
    const pick = () => {
      ticking.current = false;
      // Текущий раздел: последний, чья верхняя граница выше трети экрана; у самого низа страницы это последний раздел
      const line = Math.min(window.innerHeight / 3, 240);
      let current = list[0] ?? "";
      for (const id of list) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = list[list.length - 1] ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      window.requestAnimationFrame(pick);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ids]);
  return (
    <nav className={cn("sv-toc", className)} aria-label={label}>
      {items.map((i) => (
        <a key={i.id} href={`#${i.id}`} className={cn("sv-toc__item", active === i.id && "is-active")} aria-current={active === i.id ? "location" : undefined} data-testid={`toc-${i.id}`}>
          {i.label}
        </a>
      ))}
    </nav>
  );
}
