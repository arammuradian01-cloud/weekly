"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { relevant } from "@/lib/live-message";

const InboxCountContext = createContext(0);

const REFRESH_GAP_MS = 5_000;



/**
 * Сколько предметов ждут в «Мне». Сервер даёт число при каждом переходе, браузер обновляет его раз в 30 секунд.
 * Этап 20: живые обновления. Поток /api/events сообщает, что изменилось в «Мне» или в задачах и weekly,
 * и открытый экран обновляется сам, без перезагрузки. Если поток недоступен (прокси, сеть), работает опрос как раньше
 */
export function InboxCountProvider({ initial, children }: { initial: number; children: React.ReactNode }) {
  const [count, setCount] = useState(initial);
  const router = useRouter();
  useEffect(() => setCount(initial), [initial]);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    let timer: ReturnType<typeof setTimeout> | null = null;
    let last = 0;
    let broken = false;
    // Не чаще раза в 5 секунд: в день сдачи автосохранения идут потоком, экран не должен перерисовываться без конца
    const refresh = () => {
      if (document.visibilityState !== "visible" || timer) return;
      const wait = Math.max(800, last + REFRESH_GAP_MS - Date.now());
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        router.refresh();
      }, wait);
    };
    const onInbox = async () => {
      try {
        const res = await fetch("/api/inbox/count", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { count?: number };
          if (typeof data.count === "number") setCount(data.count);
        }
      } catch {
        // Нет связи: число обновит следующий опрос
      }
      if (relevant("inbox", window.location.pathname)) refresh();
    };
    source.addEventListener("inbox", () => void onInbox());
    source.addEventListener("tasks", () => relevant("tasks", window.location.pathname) && refresh());
    source.addEventListener("weekly", () => relevant("weekly", window.location.pathname) && refresh());
    source.addEventListener("meeting", () => relevant("meeting", window.location.pathname) && refresh());
    // Поток оборвался и вернулся (перезапуск сервера, сеть): за это время могли быть изменения
    source.addEventListener("error", () => {
      broken = true;
    });
    source.addEventListener("open", () => {
      if (!broken) return;
      broken = false;
      void onInbox();
      refresh();
    });
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [router]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const res = await fetch("/api/inbox/count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { count?: number };
        if (!stopped && typeof data.count === "number") setCount(data.count);
      } catch {
        // Нет связи: оставляем прежнее число, следующая попытка через 30 секунд
      }
    };
    const timer = window.setInterval(refresh, 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return <InboxCountContext.Provider value={count}>{children}</InboxCountContext.Provider>;
}

export function useInboxCount(): number {
  return useContext(InboxCountContext);
}
