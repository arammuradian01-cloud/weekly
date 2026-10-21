import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/wordmark";
import { ConfirmEmailForm } from "./confirm-form";

export const metadata: Metadata = { title: "Подтверждение почты" };
export const dynamic = "force-dynamic";

/**
 * Ссылка из письма подтверждения почты (этап 52). Открытие ничего не меняет: почтовые сканеры открывают ссылки сами.
 * Адрес подтверждается только кнопкой. Входить для этого не нужно: письмо часто открывают с телефона
 */
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  return (
    <div className="flex min-h-dvh flex-col bg-field">
      <header className="flex h-16 items-center bg-navy px-6 sm:px-10">
        <Wordmark />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md sv-card sv-card--soft px-6 py-7 sm:px-8">
          <h1 className="text-headline font-semibold text-ink">Подтверждение почты</h1>
          <ConfirmEmailForm token={t} />
        </div>
      </main>
    </div>
  );
}
