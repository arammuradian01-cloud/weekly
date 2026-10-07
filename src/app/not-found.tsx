import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { buttonClass } from "@/components/ui/button";

export const metadata: Metadata = { title: "Страница не найдена" };

/** Чужой или устаревший адрес: говорим, что случилось, и ведём на стартовую страницу */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-field px-4 py-10">
      <div className="w-full max-w-[440px] rounded-xl bg-surface p-6 ring-1 ring-line sm:p-8">
        <Wordmark tone="light" />
        <h1 className="mt-6 text-headline font-semibold leading-tight text-ink">Такой страницы нет</h1>
        <p className="mt-2 text-body text-muted">
          Адрес мог устареть или в нём опечатка. Задачи открываются по номеру из списка задач, weekly из раздела «Weekly».
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/" className={buttonClass("primary")}>
            На мою неделю
          </Link>
          <Link href="/tasks" className={buttonClass("secondary")}>
            К задачам
          </Link>
        </div>
      </div>
    </main>
  );
}
