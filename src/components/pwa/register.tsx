"use client";

import { useEffect } from "react";

/**
 * Служебный обработчик (этап 26): уведомления в браузере и страница «Нет сети». Только в рабочей сборке:
 * при разработке он мешал бы горячей перезагрузке
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
