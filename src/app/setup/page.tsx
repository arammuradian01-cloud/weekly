import type { Metadata } from "next";
import Link from "next/link";
import { missingPasswords, setupEnabled } from "@/lib/setup-status";
import { Wordmark } from "@/components/brand/wordmark";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Первичная настройка" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const missing = await missingPasswords();
  const enabled = await setupEnabled();

  return (
    <div className="min-h-dvh bg-surface">
      <header className="flex h-16 items-center bg-navy px-6 sm:px-10">
        <Wordmark />
      </header>
      <main className="mx-auto w-full max-w-md px-5 py-8 sm:py-12">
        <h1 className="text-[26px] font-semibold text-ink">Первичная настройка</h1>
        {missing.length === 0 ? (
          <p className="mt-3 text-[15px] text-muted">
            Пароли уже заданы. <Link href="/login" className="font-medium text-blue-700 underline-offset-2 hover:underline">Перейти ко входу</Link>
          </p>
        ) : !enabled ? (
          <p className="mt-3 text-[15px] text-muted">
            Кода настройки сейчас нет. Перезапустите приложение в панели хостинга: в журнале запуска появится строка «Код первичной настройки». На своём компьютере пароли задаются командой npm run password.
          </p>
        ) : (
          <>
            <p className="mb-6 mt-2 text-[15px] text-muted">
              Задайте пароли один раз. Страница работает, только пока они не заданы, а код после этого гаснет.
            </p>
            <SetupForm missing={missing} />
          </>
        )}
      </main>
    </div>
  );
}
