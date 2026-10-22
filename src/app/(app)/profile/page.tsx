import type { Metadata } from "next";
import { colleaguesOf } from "@/lib/org/people";
import { requireContext } from "@/lib/auth";
import { roleLabelOf } from "@/lib/roles";
import { loginOf } from "@/lib/login/password";
import { allowedEmailDomains } from "@/lib/login/email";
import { EmailBinding } from "@/components/profile/email-binding";
import { ownerLabels } from "@/lib/login/primary";
import { listDevices } from "@/lib/login/service";
import { LOGIN_METHOD_LABELS } from "@/lib/login/labels";
import { PageHeader } from "@/components/page-header";
import { PageTabs } from "@/components/ui/data";
import { DeviceList } from "@/components/profile/device-list";
import { Absences } from "@/components/profile/absences";
import { absenceWeeks, upcomingAbsences } from "@/lib/weekly/service";
import { prisma } from "@/lib/db";
import { mailConfigured } from "@/lib/mail";
import { mailPrefsFor } from "@/lib/letters/service";
import { MailPrefsForm } from "@/components/profile/mail-prefs";
import { PasswordForm } from "@/components/profile/password-form";
import { InstallApp, PushSettings } from "@/components/profile/push-settings";
import { pushDevices, pushPrefsFor, pushPublicKey } from "@/lib/push/service";
import { feedFor } from "@/lib/calendar/service";
import { CalendarFeedSettings } from "@/components/profile/calendar-feed";
import { NewsPrefsForm } from "@/components/news/news-prefs";
import { newsDirections, newsPrefsFor, personDirections } from "@/lib/news/service";
import { personProfile } from "@/lib/profile/service";
import { profileEditRefusal } from "@/lib/profile/rules";
import { VIEW_AS_DENIED, VIEW_AS_ENDED } from "@/lib/view-as";
import { PhotoEditor } from "@/components/profile/photo-editor";
import { AboutForm } from "@/components/profile/about-form";

export const metadata: Metadata = { title: "Профиль" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-small text-muted">{label}</dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  );
}

const TABS = ["profile", "login", "mail", "absences"] as const;
type ProfileTab = (typeof TABS)[number];

/** Профиль (этап 9): кто я, как вошёл, где ещё открыт мой вход. Этап 48: четыре вкладки вместо одной длинной страницы */
export default async function ProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const observer = ctx.person.role === "OBSERVER";
  const personal = ctx.via !== "TEAM";
  const sp = await searchParams;
  const requested = TABS.find((t) => t === sp.tab) ?? "profile";
  const tab: ProfileTab = requested === "absences" && observer ? "profile" : requested;
  // Этап 50: грузится только то, что нужно открытой вкладке
  const [devices, absences, weeks, colleagues, prefs, pushKey, pushPrefs, pushList, feed, card] = await Promise.all([
    tab === "login" && ctx.via !== "TEAM" ? listDevices(ctx.person.id) : Promise.resolve([]),
    tab === "absences" && !observer ? upcomingAbsences(ctx.person.id) : Promise.resolve([]),
    tab === "absences" ? absenceWeeks() : Promise.resolve([]),
    tab === "absences"
      ? prisma.person.findMany({
          where: { active: true, role: { not: "OBSERVER" }, id: { not: ctx.person.id }, ...colleaguesOf(ctx.person.id) },
          orderBy: { sortOrder: "asc" },
          select: { slug: true, fullName: true },
        })
      : Promise.resolve([]),
    tab === "mail" ? mailPrefsFor(ctx.person.id) : Promise.resolve(null),
    tab === "mail" && personal ? pushPublicKey() : Promise.resolve(""),
    tab === "mail" ? pushPrefsFor(ctx.person.id) : Promise.resolve(null),
    tab === "mail" && personal ? pushDevices(ctx.person.id, ctx.deviceId) : Promise.resolve([]),
    // По общему логину и наблюдателю состояние ссылки не отдаём: по нему видно, когда чужой календарь забирал данные
    tab === "profile" && personal && !observer ? feedFor(ctx.person.id) : Promise.resolve(null),
    // Фото и «О себе» (этап 80)
    tab === "profile" ? personProfile(ctx.person.slug) : Promise.resolve(null),
  ]);
  // Фото и «О себе» меняются при личном входе; в просмотре «Смотреть как» и после него, пока владелец не вернулся, нет.
  // Правило то же, что на сервере: любой вход, кроме личного, закрывает правку
  const aboutLocked = ctx.viewAs
    ? VIEW_AS_DENIED
    : ctx.viewAsEnded
      ? VIEW_AS_ENDED
      : profileEditRefusal({ personId: ctx.person.id, role: ctx.person.role, management: ctx.management?.role ?? null, via: ctx.via }, ctx.person.id);
  // Календарь сроков (этап 29): ссылка личная, по общему логину её не выдаём
  const calendarLocked = !personal
    ? "Календарь сроков подключается при личном входе: по общему логину можно выбрать чужой профиль."
    : observer
      ? "У наблюдателя нет своих сроков и встреч."
      : null;
  const mailOn = mailConfigured();
  const login = loginOf(ctx.person);
  const domains = tab === "login" ? await allowedEmailDomains() : [];
  const tabs = [
    { href: "/profile", label: "Профиль", active: tab === "profile", testId: "profile-tab-profile" },
    { href: "/profile?tab=login", label: "Вход и пароль", active: tab === "login", testId: "profile-tab-login" },
    { href: "/profile?tab=mail", label: "Письма и уведомления", active: tab === "mail", testId: "profile-tab-mail" },
    ...(observer ? [] : [{ href: "/profile?tab=absences", label: "Отсутствия", active: tab === "absences", testId: "profile-tab-absences" }]),
  ];
  return (
    <div className="max-w-3xl">
      <PageHeader title="Профиль" description="Фото и «О себе» вы меняете сами, роль и зону меняет владелец ресурса, рабочую почту вы указываете на вкладке «Вход и пароль»" tabs={<PageTabs label="Разделы профиля" tabs={tabs} />} />

      {tab === "profile" ? (
        <>
          <dl className="flex flex-col gap-3">
            <Row label="Имя">{ctx.person.fullName}</Row>
            <Row label="Роль">{roleLabelOf(ctx.person, await ownerLabels())}</Row>
            <Row label="Зона">{ctx.person.zone || "не указана"}</Row>
            <Row label="Логин">{login}</Row>
            <Row label="Почта">{ctx.person.email ?? (ctx.person.pendingEmail ? `${ctx.person.pendingEmail}, ждёт подтверждения` : "не указана")}</Row>
            <Row label="Как вы вошли">{LOGIN_METHOD_LABELS[ctx.via]}</Row>
          </dl>

          <section className="mt-10 border-t border-line pt-8" aria-labelledby="photo-head">
            <h2 id="photo-head" className="text-title font-semibold text-ink">
              Фото
            </h2>
            <p className="mt-1 text-small text-muted">Видно рядом с вашим именем в задачах, weekly, комментариях и в разделе «Люди». Без фото остаются инициалы.</p>
            <div className="mt-4">
              <PhotoEditor fullName={ctx.person.fullName} photo={card?.avatar ? { slug: ctx.person.slug, version: card.avatar } : null} locked={aboutLocked} />
            </div>
          </section>

          <section className="mt-10 border-t border-line pt-8" aria-labelledby="about-head">
            <h2 id="about-head" className="text-title font-semibold text-ink">
              О себе
            </h2>
            <p className="mt-1 text-small text-muted">Коллеги видят это в вашей карточке: в разделе «Люди», в структуре и в командах.</p>
            <div className="mt-4 max-w-2xl">
              <AboutForm initial={{ about: card?.about ?? null, helpWith: card?.helpWith ?? null, telegram: card?.telegram ?? null }} locked={aboutLocked} />
            </div>
          </section>

          <section className="mt-10 border-t border-line pt-8" aria-labelledby="calendar-feed">
            <h2 id="calendar-feed" className="text-title font-semibold text-ink">
              Календарь сроков
            </h2>
            <p className="mt-1 text-small text-muted">
              Сроки ваших задач, срок weekly, встречи команды и один на один в вашем календаре: Google, Яндекс, Outlook или на телефоне. Календарь только показывает,
              менять сроки по-прежнему в ресурсе.
            </p>
            <CalendarFeedSettings feed={feed} locked={calendarLocked} />
          </section>
        </>
      ) : null}

      {tab === "absences" && !observer ? (
        <section aria-labelledby="absences-head">
          <h2 id="absences-head" className="text-title font-semibold text-ink">Нет на неделе</h2>
          <p className="mt-1 text-small text-muted">
            Отпуск, больничный, командировка. Weekly за эту неделю не ждём, в счёт «сдали N из M» вы не входите, на встрече видно, кто замещает.
          </p>
          <Absences absences={absences} weeks={weeks} people={colleagues.map((p) => ({ value: p.slug, label: p.fullName }))} />
        </section>
      ) : null}

      {tab === "login" ? (
        <>
          <section aria-labelledby="password-head">
            <h2 id="password-head" className="text-title font-semibold text-ink">Пароль</h2>
            {ctx.via === "TEAM" ? (
              <p className="mt-2 text-body text-muted">
                Вы вошли по общему логину. Личный пароль задают по личной ссылке от владельца ресурса: по ней вы сами придумаете пароль, логин {login}.
              </p>
            ) : (
              <>
                <p className="mt-1 text-small text-muted">
                  {ctx.person.passwordHash
                    ? `Входите на экране входа с логином ${login} и этим паролем. После смены пароля другие устройства выйдут, ссылка на календарь сроков отключится.`
                    : `Пароль ещё не задан. Задайте его, чтобы входить с логином ${login} без ссылки.`}
                </p>
                <PasswordForm login={login} hasPassword={!!ctx.person.passwordHash} />
              </>
            )}
          </section>

          <section className="mt-10 border-t border-line pt-8" aria-labelledby="work-email-head">
            <h2 id="work-email-head" className="text-title font-semibold text-ink">Почта для входа</h2>
            <p className="mt-1 text-small text-muted">Для входа по почте вместо логина и для «Забыли пароль» на экране входа.</p>
            <EmailBinding
              email={ctx.person.email}
              pending={ctx.person.pendingEmail}
              mailOn={mailOn}
              personal={personal}
              domains={domains}
              hasPassword={!!ctx.person.passwordHash}
              needsManagement={!!ctx.managementRole && !ctx.management}
            />
          </section>

          <section className="mt-10 border-t border-line pt-8" aria-labelledby="devices-head">
            <h2 id="devices-head" className="text-title font-semibold text-ink">Где открыт ваш вход</h2>
            {ctx.via === "TEAM" ? (
              <p className="mt-2 text-body text-muted">
                Вы вошли по общему логину и выбрали себя из списка. Личный вход по ссылке выдаёт владелец ресурса: с ним журнал записывает именно вас, а здесь появится список
                ваших устройств.
              </p>
            ) : (
              <DeviceList devices={devices} current={ctx.deviceId} />
            )}
          </section>
        </>
      ) : null}

      {/* prefs и pushPrefs всегда есть на вкладке писем (функции отдают значения по умолчанию): условие только сужает тип */}
      {tab === "mail" && prefs && pushPrefs ? (
        <>
          <section aria-labelledby="mail-head">
            <h2 id="mail-head" className="text-title font-semibold text-ink">Письма</h2>
            <p className="mt-1 text-small text-muted">
              {mailOn
                ? `Приходят на ${ctx.person.email ?? "почту из карточки"}: о том, что ждёт вас и что вы не увидели в ресурсе за 15 минут. Вне рабочего времени, с 20:00 до 9:00 и в выходные, письма копятся до утра. В письме только кто и что, подробности после входа.`
                : "Почта ресурса ещё не настроена: письма начнут приходить, когда владелец подключит почтовый сервер. Настройки ниже уже сохраняются."}
            </p>
            {!ctx.person.email ? <p className="mt-2 text-small text-warning-ink">В вашей карточке нет почты: попросите владельца её добавить.</p> : null}
            {ctx.via === "TEAM" ? <p className="mt-2 text-small text-muted">Письма настраиваются при личном входе по ссылке: по общему логину можно выбрать чужой профиль.</p> : null}
            <MailPrefsForm initial={prefs} locked={ctx.via === "TEAM"} />
          </section>

          <section className="mt-10 border-t border-line pt-8" aria-labelledby="news-head">
            <h2 id="news-head" className="text-title font-semibold text-ink">
              Дайджест новостей
            </h2>
            <p className="mt-1 text-small text-muted">Публичные новости рынка по вашим продуктам: регулятор, союзы страховщиков, СМИ. У каждой новости ссылка на источник.</p>
            {ctx.via === "TEAM" ? <p className="mt-2 text-small text-muted">Дайджест настраивается при личном входе: по общему логину можно выбрать чужой профиль.</p> : null}
            <NewsPrefsForm
              initial={await newsPrefsFor(ctx.person.id)}
              directions={(await newsDirections()).filter((d) => d.active).map((d) => ({ code: d.code, label: d.label }))}
              defaults={await personDirections(ctx.person.id)}
              locked={ctx.via === "TEAM"}
            />
          </section>

          <section className="mt-10 border-t border-line pt-8" aria-labelledby="phone-push">
            <h2 id="phone-push" className="text-title font-semibold text-ink">
              Телефон и уведомления
            </h2>
            <p className="mt-1 text-small text-muted">Ответить на просьбу, обновить задачу, прочитать ленту и повестку можно с телефона в два нажатия.</p>
            <InstallApp />
            <PushSettings publicKey={pushKey} locked={!personal} prefs={pushPrefs} devices={pushList} />
          </section>
        </>
      ) : null}
    </div>
  );
}
