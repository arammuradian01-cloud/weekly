import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth";
import { getEpochs } from "@/lib/settings";
import { WeekStrip } from "@/components/brand/week-strip";
import { Wordmark } from "@/components/brand/wordmark";
import { WEEKDAYS_SHORT } from "@/lib/week";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Вход" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await readSession();
  if (session) {
    const { epoch } = await getEpochs();
    if (session.epoch === epoch) redirect(session.personId ? "/" : "/choose");
  }

  const days = WEEKDAYS_SHORT.map((weekday) => ({ key: weekday, weekday }));

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="relative flex flex-col justify-between gap-6 overflow-hidden bg-navy px-5 py-6 text-white sm:gap-10 sm:px-10 sm:py-8 lg:px-14 lg:py-12">
        <Wordmark />
        <div className="flex flex-col gap-5 sm:gap-8">
          <h1 className="max-w-md text-[24px] font-semibold leading-[1.15] sm:text-[40px]">
            Итоги недели и задачи команды в одном месте
          </h1>
          <WeekStrip days={days} deadline={{ weekday: "Пн", time: "18:00" }} meeting={{ label: "Вт встреча" }} tone="dark" size="lg" className="max-w-xl" />
          <p className="hidden max-w-md text-[15px] leading-relaxed text-white/70 sm:block">
            До 18:00 понедельника каждый сдаёт weekly за прошедшую неделю. Во вторник разбираем его и задачи на встрече.
          </p>
        </div>
        <p className="hidden text-[13px] text-white/50 lg:block">Департамент «Страхование и инвестиции», Сравни</p>
      </section>

      <section className="flex items-start justify-center px-5 py-8 sm:items-center sm:px-10 sm:py-10">
        <div className="w-full max-w-sm">
          <h2 className="text-[26px] font-semibold text-ink">Вход</h2>
          <p className="mb-6 mt-1.5 text-[15px] text-muted">Общий логин и пароль команды. После входа выберите себя из списка.</p>
          <p className="-mt-3 mb-6 text-[14px] text-muted sm:hidden">Weekly сдаём до 18:00 понедельника, во вторник встреча.</p>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
