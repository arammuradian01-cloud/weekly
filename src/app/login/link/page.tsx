import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { peekLink } from "@/lib/login/service";
import { LinkLoginForm } from "./link-form";

export const metadata: Metadata = { title: "Вход по ссылке" };
export const dynamic = "force-dynamic";

const PROBLEMS = {
  used: "Ссылка уже использована: войти по ней можно только один раз.",
  expired: "Срок ссылки истёк.",
  unknown: "Ссылка не найдена: проверьте, что она скопирована целиком.",
  inactive: "Этот человек выключен в списке команды.",
} as const;

/**
 * Экран личной ссылки. Открытие ссылки ничего не тратит: почтовые сканеры и мессенджеры открывают ссылки сами.
 * Вход случается только по кнопке «Войти»
 */
export default async function LinkPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const link = await peekLink(t);
  const ok = link.status === "ok" && link.kind !== "STEP_UP";

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex h-16 items-center bg-navy px-6 sm:px-10">
        <Wordmark />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md rounded-xl bg-white px-6 py-7 ring-1 ring-line sm:px-8">
          {ok ? (
            <>
              <h1 className="text-[24px] font-semibold text-ink">Вход в Weekly</h1>
              <p className="mt-2 text-[15px] text-muted">
                Вы входите как <span className="font-semibold text-ink">{link.fullName}</span>. Вход запомнится на этом устройстве на 30 дней, завершить его можно в
                профиле.
              </p>
              <LinkLoginForm token={t} fullName={link.fullName ?? ""} />
              <p className="mt-4 text-[13px] text-muted">Это не вы? Закройте страницу и сообщите владельцу ресурса.</p>
            </>
          ) : (
            <>
              <h1 className="text-[24px] font-semibold text-ink">Ссылка не подходит</h1>
              <p className="mt-2 text-[15px] text-ink">{link.kind === "STEP_UP" ? "Это ссылка подтверждения режима управления, а не входа." : PROBLEMS[link.status as keyof typeof PROBLEMS]}</p>
              <p className="mt-2 text-[15px] text-muted">Попросите новую ссылку у владельца ресурса или запросите её на почту на экране входа.</p>
              <Link href="/login" className="mt-5 inline-block text-[15px] font-medium text-blue-700 underline-offset-2 hover:underline">
                На экран входа
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
