"use client";

import { useEffect, useRef } from "react";
import { leavesPage } from "@/lib/market/draft";

/**
 * Пока есть несохранённые правки, уход со страницы переспрашивается (этап 72): закрытие вкладки, перезагрузка и
 * переход на другой сайт через beforeunload браузера, переход по ссылке внутри приложения через confirm. Ссылки Next
 * не переходят, если щелчок уже отменён: слушатель стоит на документе в фазе захвата, раньше обработчика ссылки.
 * Программные переходы внутри приложения (командная строка) не перехватываются: это осознанное упрощение
 */
export function useLeaveGuard(dirty: boolean, text: string) {
  // Человек уже согласился уйти по ссылке: полная загрузка страницы не спрашивает второй раз
  const agreed = useRef(false);
  useEffect(() => {
    if (!dirty) return;
    agreed.current = false;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (agreed.current) return;
      e.preventDefault();
      // Старые браузеры показывают вопрос только при заданном returnValue
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      // Новая вкладка и скачивание текущую страницу не закрывают
      if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      if (!leavesPage(link.href, window.location.href)) return;
      if (window.confirm(text)) agreed.current = true;
      else e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, text]);
}
