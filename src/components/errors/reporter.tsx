"use client";

// Сбои в браузере в общий сбор (этап 86). Раньше ошибка в браузере оставалась в консоли у человека, и о ней
// никто не узнавал. Теперь она уходит в /api/errors и видна владельцу на странице «Состояние».
//
// Что уходит: текст ошибки, файл и строка, путь страницы. Ни содержимого задач и weekly, ни того, что человек
// набрал, здесь нет. За одну загрузку страницы уходит не больше MAX_REPORTS сообщений, повторы одного и того же
// текста не отправляются: иначе ошибка в цикле отрисовки завалила бы и браузер, и базу.

import { useEffect } from "react";

const MAX_REPORTS = 5;
/**
 * Шум, а не сбой: запрос оборвал переход на другую страницу, человек ушёл со страницы или пропала сеть. Такие
 * сообщения приходят при обычной работе и ни о чём не говорят. В сквозном прогоне они набежали сами на одном
 * прогоне из двух (41335268396): это тот самый случай, когда запрос обрывает переход. Фильтр стоит только на
 * общих слушателях страницы; экраны сбоя (error.tsx, global-error.tsx) сообщают о себе всегда, даже если внутри
 * тот же текст: упавшая страница — это находка, а не шум. Настоящая пропажа сети видна по странице «Нет сети»
 * (этап 26)
 */
const NOISE = /failed to fetch|load failed|networkerror|aborterror|operation was aborted|signal is aborted|the user aborted|resizeobserver loop/i;
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

/** То же, но шум не отправляется: так сообщают о себе общие слушатели страницы */
function reportUnlessNoise(message: unknown, stack?: unknown): void {
  if (NOISE.test(String(message ?? ""))) return;
  reportBrowserError(message, stack);
}

/** Слушатели ошибок страницы. Ничего не рисует */
export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const place = event.filename ? `${event.filename}:${event.lineno ?? 0}` : "";
      reportUnlessNoise(event.message || event.error, event.error instanceof Error ? (event.error.stack ?? place) : place);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      reportUnlessNoise(
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
