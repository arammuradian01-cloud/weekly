"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * Последний рубеж: сбой в общей оболочке, когда не отрисовалось даже меню.
 * Здесь нет ни данных, ни шрифтов страницы, поэтому только понятный текст и кнопка повтора
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Сбой оболочки", error);
  }, [error]);

  return (
    <html lang="ru">
      <body className="min-h-dvh bg-field">
        <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
          <div className="w-full max-w-[440px] rounded-xl bg-surface p-6 ring-1 ring-line sm:p-8">
            <h1 className="text-headline font-semibold leading-tight text-ink">Weekly сейчас не открывается</h1>
            <p className="mt-2 text-body text-muted">
              Сервер ответил ошибкой. Сохранённое не пропало. Попробуйте ещё раз через минуту, а если не поможет, напишите владельцу ресурса.
            </p>
            {error.digest ? <p className="mt-2 text-caption text-muted">Код ошибки для разбора: {error.digest}</p> : null}
            <button
              type="button"
              onClick={reset}
              className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-green px-5 text-body font-semibold text-ink hover:bg-green-600"
            >
              Открыть ещё раз
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
