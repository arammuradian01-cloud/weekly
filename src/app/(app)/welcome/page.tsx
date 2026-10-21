import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { mailConfigured } from "@/lib/mail";
import { loginOf } from "@/lib/login/password";
import { allowedEmailDomains } from "@/lib/login/email";
import { PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { WelcomeEmail } from "./welcome-email";

export const metadata: Metadata = { title: "Добро пожаловать" };
export const dynamic = "force-dynamic";

/**
 * Первый вход (этап 52): логин крупно и предложение указать рабочую почту. Можно пропустить, почта есть в профиле.
 * Приветствие только сразу после пароля по ссылке (?new=1): при повторном заходе страница просто про логин и почту
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireContext();
  const fresh = (await searchParams).new === "1" && ctx.via !== "TEAM";
  const login = loginOf(ctx.person);
  const mailOn = mailConfigured();
  const domains = await allowedEmailDomains();
  return (
    <div className="max-w-xl">
      <PageHeader
        title={fresh ? `Добро пожаловать, ${ctx.person.shortName}` : "Логин и почта для входа"}
        description={fresh ? "Пароль сохранён, вход запомнится на этом устройстве на 30 дней" : undefined}
      />
      <div className="sv-card sv-card--soft flex flex-col gap-2 p-5">
        <p className="text-body text-muted">Ваш логин</p>
        <p className="text-number font-semibold text-ink break-all" data-testid="welcome-login">
          {login}
        </p>
        <p className="text-small text-muted">С ним и паролем входите на экране входа. Логин виден и в профиле.</p>
      </div>
      <section className="mt-8" aria-labelledby="welcome-email">
        <h2 id="welcome-email" className="text-title font-semibold text-ink">Почта для входа</h2>
        <p className="mt-1 text-body text-muted">
          Укажите корпоративную почту: по ней можно входить вместо логина и восстанавливать пароль, если забудете его.
        </p>
        <WelcomeEmail
          email={ctx.person.email}
          pending={ctx.person.pendingEmail}
          mailOn={mailOn}
          personal={ctx.via !== "TEAM"}
          domains={domains}
          hasPassword={!!ctx.person.passwordHash}
          needsManagement={!!ctx.managementRole && !ctx.management}
        />
      </section>
      <div className="mt-8 border-t border-line pt-6">
        <Link href="/" className={buttonClass("primary")} data-testid="welcome-start">
          Начать работу
        </Link>
        <p className="mt-2 text-small text-muted">Почту можно указать и позже: профиль, вкладка «Вход и пароль».</p>
      </div>
    </div>
  );
}
