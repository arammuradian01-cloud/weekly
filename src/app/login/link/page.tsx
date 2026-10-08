import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { peekLink } from "@/lib/login/service";
import { LinkLoginForm, SetPasswordForm } from "./link-form";

export const metadata: Metadata = { title: "Личный вход" };
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
    <div className="flex min-h-dvh flex-col bg-field">
      <header className="flex h-16 items-center bg-navy px-6 sm:px-10">
        <Wordmark />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="w-full max-w-md sv-card sv-card--soft px-6 py-7 sm:px-8">
          {ok ? (
            <>
              <h1 className="text-headline font-semibold text-ink">{link.hasPassword ? "Новый пароль" : "Ваш вход в Weekly"}</h1>
              <p className="mt-2 text-body text-muted">
                Вы входите как <span className="font-semibold text-ink">{link.fullName}</span>.{" "}
                {link.hasPassword
                  ? "Придумайте новый пароль: старый перестанет работать, входы на других устройствах завершатся."
                  : "Придумайте пароль: дальше входите на экране входа со своим логином и паролем. Вход запомнится на этом устройстве на 30 дней."}
              </p>
              <SetPasswordForm token={t} login={link.login ?? ""} reset={!!link.hasPassword} />
              {/* Ссылка из письма открывает вход и без пароля, ссылка от владельца нужна, чтобы задать пароль */}
              {link.kind === "EMAIL" ? <LinkLoginForm token={t} fullName={link.fullName ?? ""} secondary /> : null}
              <p className="mt-4 text-caption text-muted">Это не вы? Закройте страницу и сообщите владельцу ресурса.</p>
            </>
          ) : (
            <>
              <h1 className="text-headline font-semibold text-ink">Ссылка не подходит</h1>
              <p className="mt-2 text-body text-ink">{link.kind === "STEP_UP" ? "Это ссылка подтверждения режима управления, а не входа." : PROBLEMS[link.status as keyof typeof PROBLEMS]}</p>
              <p className="mt-2 text-body text-muted">Попросите новую ссылку у владельца ресурса или запросите её на почту на экране входа.</p>
              <Link href="/login" className="mt-5 inline-block text-body font-medium text-blue-700 underline-offset-2 hover:underline">
                На экран входа
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
