"use client";

import { createContext, useContext, useEffect, useState } from "react";

const InboxCountContext = createContext(0);

/** Сколько предметов ждут в «Мне». Сервер даёт число при каждом переходе, браузер обновляет его раз в 30 секунд */
export function InboxCountProvider({ initial, children }: { initial: number; children: React.ReactNode }) {
  const [count, setCount] = useState(initial);
  useEffect(() => setCount(initial), [initial]);
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
