import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getEpochs } from "@/lib/settings";
import { WeekStrip } from "@/components/brand/week-strip";
import { Wordmark } from "@/components/brand/wordmark";
import { WEEKDAYS_SHORT } from "@/lib/week";
import Link from "next/link";
import { missingPasswords, setupEnabled } from "@/lib/setup-status";
import { getTeamLogin, loadDevice } from "@/lib/login/service";
import { mailConfigured } from "@/lib/mail";
import { EmailLinkForm, LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Вход" };
export const dynamic = "force-dynamic";

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

  const days = WEEKDAYS_SHORT.map((weekday) => ({ key: weekday, weekday }));
  const needsSetup = (await missingPasswords()).length > 0 && (await setupEnabled());

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative flex flex-col justify-between gap-6 overflow-hidden bg-navy px-5 py-6 text-white sm:gap-10 sm:px-10 sm:py-8 lg:px-14 lg:py-12">
        <Wordmark />
        <div className="flex flex-col gap-5 sm:gap-8">
          <h1 className="max-w-md text-headline font-semibold sm:text-hero">
            Итоги недели и задачи команды в одном месте
          </h1>
          <WeekStrip days={days} deadline={{ weekday: "Пн", time: "18:00" }} meeting={{ label: "Вт встреча" }} tone="dark" size="lg" className="max-w-xl" />
          <p className="hidden max-w-md text-body leading-relaxed text-white/70 sm:block">
            До 18:00 понедельника каждый сдаёт weekly за прошедшую неделю. Во вторник разбираем его и задачи на встрече.
          </p>
        </div>
        <p className="hidden text-caption text-white/50 lg:block">Департамент «Страхование и инвестиции», Сравни</p>
      </section>

      <section className="flex items-start justify-center px-5 py-8 sm:items-center sm:px-10 sm:py-10">
        <div className="w-full max-w-sm">
          <h2 className="text-page font-semibold text-ink">Вход</h2>
          <p className="mb-6 mt-1.5 text-body text-muted">
            {teamLogin === "on"
              ? "Ваш личный логин и пароль. Пока идёт переходный период, работает и общий логин team: после входа по нему выберите себя из списка."
              : "Ваш личный логин и пароль. Нет пароля или забыли его: попросите личную ссылку у владельца ресурса."}
          </p>
          <p className="-mt-3 mb-6 text-small text-muted sm:hidden">Weekly сдаём до 18:00 понедельника, во вторник встреча.</p>
          {ended ? (
            <p role="status" className="mb-5 rounded-lg bg-blue-soft px-3.5 py-2.5 text-sm text-blue-700">
              Вход на этом устройстве завершён. Войдите снова со своим логином и паролем.
            </p>
          ) : null}
          {setup === "done" ? (
            <p role="status" className="mb-5 rounded-lg bg-green-soft px-3.5 py-2.5 text-sm text-green-ink">
              Пароли заданы. Войдите с логином team и паролем общего входа.
            </p>
          ) : null}
          {needsSetup ? (
            <p className="mb-5 rounded-lg bg-blue-soft px-3.5 py-2.5 text-sm text-blue-700">
              Пароли ещё не заданы.{" "}
              <Link href="/setup" className="font-semibold underline underline-offset-2">
                Перейти к первичной настройке
              </Link>
            </p>
          ) : null}
          <LoginForm />
          <div className="mt-8 border-t border-line pt-6">
            <h3 className="text-title-sm font-semibold text-ink">Нет пароля</h3>
            {mail ? (
              <>
                <p className="mb-4 mt-1 text-small text-muted">Ссылка на рабочую почту: по ней можно войти и задать новый пароль.</p>
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
