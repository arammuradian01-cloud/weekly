"use client";

// Сбои в браузере в общий сбор (этап 86). Раньше ошибка в браузере оставалась в консоли у человека, и о ней
// никто не узнавал. Теперь она уходит в /api/errors и видна владельцу на странице «Состояние».
//
// Что уходит: текст ошибки, файл и строка, путь страницы. Ни содержимого задач и weekly, ни того, что человек
// набрал, здесь нет. За одну загрузку страницы уходит не больше MAX_REPORTS сообщений, повторы одного и того же
// текста не отправляются: иначе ошибка в цикле отрисовки завалила бы и браузер, и базу.

import { useEffect } from "react";

const MAX_REPORTS = 5;
/** Счётчик и память повторов живут в модуле, а не в состоянии: отправка не перерисовывает страницу */
let sent = 0;
const seen = new Set<string>();

/** Отправка одного сбоя. Ничего не ждёт и ничего не ломает: не вышло — значит не вышло */
export function reportBrowserError(message: unknown, stack?: unknown): void {
  if (typeof window === "undefined") return;
  const text = String(message ?? "").trim().slice(0, 300);
  if (!text || sent >= MAX_REPORTS || seen.has(text)) return;
  seen.add(text);
  sent += 1;
  try {
    void fetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // keepalive: сообщение уходит даже если человек тут же ушёл со страницы
      keepalive: true,
      body: JSON.stringify({ message: text, place: window.location.pathname, stack: String(stack ?? "").slice(0, 1200) }),
    }).catch(() => {});
  } catch {
    // Браузер отказался отправлять: сбой всё равно виден в консоли
  }
}

/** Слушатели ошибок страницы. Ничего не рисует */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const place = event.filename ? `${event.filename}:${event.lineno ?? 0}` : "";
      reportBrowserError(event.message || event.error, event.error instanceof Error ? (event.error.stack ?? place) : place);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportBrowserError(
        reason instanceof Error ? `Обещание отклонено: ${reason.message}` : `Обещание отклонено: ${String(reason ?? "")}`,
        reason instanceof Error ? reason.stack : undefined,
      );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
