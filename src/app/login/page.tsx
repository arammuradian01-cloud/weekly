import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getEpochs } from "@/lib/settings";
import { Wordmark } from "@/components/brand/wordmark";
import Link from "next/link";
import { missingPasswords, setupEnabled } from "@/lib/setup-status";
import { getTeamLogin, loadDevice } from "@/lib/login/service";
import { mailConfigured } from "@/lib/mail";
import { EmailLinkForm, LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Вход" };
export const dynamic = "force-dynamic";

/**
 * Этап 68б: слева заголовок и картинка того, что внутри (итоги недели, задачи на карте сроков, встреча), без расписания
 * недели словами. Картинка декоративная: скрыта от экранного диктора и на телефоне. Внизу подпись пространства
 */
function Showcase() {
  const tile = "flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4";
  const label = "text-caption font-semibold text-white/70";
  return (
    <div className="hidden max-w-xl grid-cols-3 gap-3 sm:grid" aria-hidden="true" data-testid="login-showcase">
      <div className={tile}>
        <span className={label}>Итоги недели</span>
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={`aspect-square rounded-md ${i < 9 ? "bg-green" : "bg-white/15"}`} />
          ))}
        </div>
        <span className="h-1.5 rounded-full bg-white/10">
          <span className="block h-full w-3/4 rounded-full bg-green" />
        </span>
      </div>
      <div className={tile}>
        <span className={label}>Задачи</span>
        <div className="flex flex-col gap-1.5">
          <span className="h-3 w-4/5 rounded-full bg-link" />
          <span className="ml-[20%] h-3 w-3/5 rounded-full bg-white/80" />
          <span className="ml-[10%] h-3 w-2/5 rounded-full bg-green" />
          <span className="ml-[45%] h-3 w-1/2 rounded-full bg-white/30" />
        </div>
        <span className="relative h-1.5 rounded-full bg-white/10">
          <span className="absolute -top-1 left-[38%] h-3.5 w-0.5 rounded bg-danger" />
        </span>
      </div>
      <div className={tile}>
        <span className={label}>Встреча</span>
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex items-center gap-2">
              <span className={`h-5 w-5 shrink-0 rounded-md ${i === 0 ? "bg-green" : i === 1 ? "bg-white" : "bg-white/15"}`} />
              <span className={`h-2 flex-1 rounded-full ${i === 1 ? "bg-white/60" : "bg-white/20"}`} />
            </span>
          ))}
        </div>
        <span className="flex gap-1">
          <span className="h-1.5 flex-1 rounded-full bg-green" />
          <span className="h-1.5 flex-1 rounded-full bg-white" />
          <span className="h-1.5 flex-1 rounded-full bg-white/15" />
          <span className="h-1.5 flex-1 rounded-full bg-white/15" />
        </span>
      </div>
    </div>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ setup?: string; ended?: string }> }) {
  const { setup, ended } = await searchParams;
  const session = await readSession();
  const teamLogin = await getTeamLogin();
  if (session?.sid) {
    if (await loadDevice(session.sid)) redirect("/");
  } else if (session && teamLogin === "on") {
    const { epoch } = await getEpochs();
    if (session.epoch === epoch) redirect(session.personId ? "/" : "/choose");
  }
  const mail = mailConfigured();

  const needsSetup = (await missingPasswords()).length > 0 && (await setupEnabled());

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative flex flex-col justify-between gap-6 overflow-hidden bg-sidebar px-5 py-6 text-white sm:gap-10 sm:px-10 sm:py-8 lg:px-14 lg:py-12">
        <Wordmark />
        <div className="flex flex-col gap-5 sm:gap-8">
          <h1 className="max-w-md text-page sm:text-number">
            Итоги недели и задачи команды в одном месте
          </h1>
          <Showcase />
        </div>
        <p className="hidden text-body text-white/70 sm:block">Рабочее пространство для членов команды</p>
      </section>

      <section className="flex items-start justify-center px-5 py-8 sm:items-center sm:px-10 sm:py-10">
        <div className="w-full max-w-sm">
          <h2 className="text-page">Вход</h2>
          <p className="mb-6 mt-1.5 text-body text-muted">Введите ваш логин и пароль</p>
          {ended ? (
            <p role="status" className="sv-alert sv-alert--info mb-5">
              Вход на этом устройстве завершён. Войдите снова со своим логином и паролем.
            </p>
          ) : null}
          {setup === "done" ? (
            <p role="status" className="sv-alert sv-alert--success mb-5">
              Пароли заданы. Войдите с логином team и паролем общего входа.
            </p>
          ) : null}
          {needsSetup ? (
            <p className="sv-alert sv-alert--info mb-5">
              Пароли ещё не заданы.{" "}
              <Link href="/setup" className="font-semibold underline underline-offset-2">
                Перейти к первичной настройке
              </Link>
            </p>
          ) : null}
          <LoginForm />
          <div className="mt-8 border-t border-line pt-6">
            <h3 className="text-title-sm font-semibold text-ink">Забыли пароль или его ещё нет</h3>
            {mail ? (
              <>
                <p className="mb-4 mt-1 text-small text-muted">
                  Ссылка придёт на рабочую почту, если вы её подтвердили в профиле. По ссылке можно войти и задать новый пароль. Почты в ресурсе нет: ссылку выдаёт
                  владелец ресурса.
                </p>
                <EmailLinkForm />
              </>
            ) : (
              <p className="mt-1 text-small text-muted">Личную ссылку выдаёт владелец ресурса. По ней вы сами придумаете пароль, логин увидите там же.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
