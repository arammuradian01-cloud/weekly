"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const InboxCountContext = createContext(0);

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
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      // Несколько изменений подряд: обновляем экран один раз
      timer = setTimeout(() => router.refresh(), 800);
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
      refresh();
    };
    source.addEventListener("inbox", () => void onInbox());
    source.addEventListener("change", refresh);
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
