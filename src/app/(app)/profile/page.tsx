import type { Metadata } from "next";
import { colleaguesOf } from "@/lib/org/people";
import { requireContext } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { listDevices } from "@/lib/login/service";
import { LOGIN_METHOD_LABELS } from "@/lib/login/labels";
import { PageHeader } from "@/components/page-header";
import { DeviceList } from "@/components/profile/device-list";
import { Absences } from "@/components/profile/absences";
import { absenceWeeks, upcomingAbsences } from "@/lib/weekly/service";
import { prisma } from "@/lib/db";
import { mailConfigured } from "@/lib/mail";
import { mailPrefsFor } from "@/lib/letters/service";
import { MailPrefsForm } from "@/components/profile/mail-prefs";
import { PasswordForm } from "@/components/profile/password-form";

export const metadata: Metadata = { title: "Профиль" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-small text-muted">{label}</dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  );
}

/** Профиль (этап 9): кто я, как вошёл, где ещё открыт мой вход */
export default async function ProfilePage() {
  const ctx = await requireContext();
  const observer = ctx.person.role === "OBSERVER";
  const [devices, absences, weeks, colleagues, prefs] = await Promise.all([
    ctx.via === "TEAM" ? Promise.resolve([]) : listDevices(ctx.person.id),
    observer ? Promise.resolve([]) : upcomingAbsences(ctx.person.id),
    absenceWeeks(),
    prisma.person.findMany({
      where: { active: true, role: { not: "OBSERVER" }, id: { not: ctx.person.id }, ...colleaguesOf(ctx.person.id) },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, fullName: true },
    }),
    mailPrefsFor(ctx.person.id),
  ]);
  const mailOn = mailConfigured();
  return (
    <div className="max-w-3xl">
      <PageHeader title="Профиль" description="Роль, зону и почту меняет владелец ресурса в настройках" />
      <dl className="flex flex-col gap-3">
        <Row label="Имя">{ctx.person.fullName}</Row>
        <Row label="Роль">{ROLE_LABELS[ctx.person.role]}</Row>
        <Row label="Зона">{ctx.person.zone || "не указана"}</Row>
        <Row label="Логин">{ctx.person.slug}</Row>
        <Row label="Почта">{ctx.person.email ?? "не указана"}</Row>
        <Row label="Как вы вошли">{LOGIN_METHOD_LABELS[ctx.via]}</Row>
      </dl>

      {observer ? null : (
        <section className="mt-10 border-t border-line pt-8">
          <h2 className="text-title font-semibold text-ink">Нет на неделе</h2>
          <p className="mt-1 text-small text-muted">
            Отпуск, больничный, командировка. Weekly за эту неделю не ждём, в счёт «сдали N из M» вы не входите, на встрече видно, кто замещает.
          </p>
          <Absences absences={absences} weeks={weeks} people={colleagues.map((p) => ({ value: p.slug, label: p.fullName }))} />
        </section>
      )}

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="text-title font-semibold text-ink">Пароль</h2>
        {ctx.via === "TEAM" ? (
          <p className="mt-2 text-body text-muted">
            Вы вошли по общему логину. Личный пароль задают по личной ссылке от владельца ресурса: по ней вы сами придумаете пароль, логин {ctx.person.slug}.
          </p>
        ) : (
          <>
            <p className="mt-1 text-small text-muted">
              {ctx.person.passwordHash
                ? `Входите на экране входа с логином ${ctx.person.slug} и этим паролем. После смены пароля другие устройства выйдут.`
                : `Пароль ещё не задан. Задайте его, чтобы входить с логином ${ctx.person.slug} без ссылки.`}
            </p>
            <PasswordForm login={ctx.person.slug} hasPassword={!!ctx.person.passwordHash} />
          </>
        )}
      </section>

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="text-title font-semibold text-ink">Письма</h2>
        <p className="mt-1 text-small text-muted">
          {mailOn
            ? `Приходят на ${ctx.person.email ?? "почту из карточки"}: о том, что ждёт вас и что вы не увидели в ресурсе за 15 минут. Вне рабочего времени, с 20:00 до 9:00 и в выходные, письма копятся до утра. В письме только кто и что, подробности после входа.`
            : "Почта ресурса ещё не настроена: письма начнут приходить, когда владелец подключит почтовый сервер. Настройки ниже уже сохраняются."}
        </p>
        {!ctx.person.email ? <p className="mt-2 text-small text-warning-ink">В вашей карточке нет почты: попросите владельца её добавить.</p> : null}
        {ctx.via === "TEAM" ? <p className="mt-2 text-small text-muted">Письма настраиваются при личном входе по ссылке: по общему логину можно выбрать чужой профиль.</p> : null}
        <MailPrefsForm initial={prefs} locked={ctx.via === "TEAM"} />
      </section>

      <section className="mt-10 border-t border-line pt-8">
        <h2 className="text-title font-semibold text-ink">Где открыт ваш вход</h2>
        {ctx.via === "TEAM" ? (
          <p className="mt-2 text-body text-muted">
            Вы вошли по общему логину и выбрали себя из списка. Личный вход по ссылке выдаёт владелец ресурса: с ним журнал записывает именно вас, а здесь появится список
            ваших устройств.
          </p>
        ) : (
          <DeviceList devices={devices} current={ctx.deviceId} />
        )}
      </section>
    </div>
  );
}
