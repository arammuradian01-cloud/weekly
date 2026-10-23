import type { Metadata } from "next";
import { teamChoosable, teamChoosableWhere } from "@/lib/org/people";
import { prisma } from "@/lib/db";
import { requireSignedIn } from "@/lib/auth";
import { chooseProfile, logout } from "@/app/actions/auth";
import { roleLabelOf } from "@/lib/roles";
import { ownerLabels } from "@/lib/login/primary";
import { Wordmark } from "@/components/brand/wordmark";
import { buttonClass } from "@/components/ui/button";
import { ChooseList } from "./choose-list";

export const metadata: Metadata = { title: "Выберите себя" };
export const dynamic = "force-dynamic";

export default async function ChoosePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const session = await requireSignedIn();
  const { denied } = await searchParams;
  // Этап 71: по общему логину все включённые люди структуры, кроме тех, у кого уже есть личный пароль: они входят только
  // своим логином и паролем. Владелец без личного пароля в списке есть (поправка 23.10). То же условие проверяет сервер
  const rows = await prisma.person.findMany({
    where: teamChoosableWhere,
    select: { id: true, slug: true, fullName: true, position: true, zone: true, role: true, unit: { select: { name: true } } },
    orderBy: [{ fullName: "asc" }],
  });
  // Подписи ролей владельцев (этап 69): «Владелец», «Совладелец» или подпись, которую задал главный владелец
  const owners = await ownerLabels();
  const people = rows.map((p) => ({
    id: p.id,
    fullName: p.fullName,
    position: p.position ?? (p.unit ? null : p.zone || null),
    unit: p.unit?.name ?? null,
    // Подпись роли только у тех, кого в списке мало: владельцы, администраторы и наблюдатели
    badge: p.role === "OWNER" || p.role === "ADMIN" || p.role === "OBSERVER" ? roleLabelOf(p, owners) : null,
  }));
  // Профиль, выбранный раньше на этом устройстве, больше не открывается по общему логину: человек задал личный пароль
  const previous = session.personId ? await prisma.person.findUnique({ where: { id: session.personId }, select: { fullName: true, active: true, role: true, passwordHash: true } }) : null;
  const lost = previous && previous.active && !teamChoosable(previous) ? previous.fullName : null;

  return (
    <div className="min-h-dvh bg-field">
      <header className="flex h-16 items-center bg-navy px-4 sm:px-10">
        <Wordmark />
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-page font-semibold text-ink sm:text-page-lg">Выберите себя</h1>
        <p className="mt-1.5 max-w-2xl text-body text-muted">
          Выбор запомнится на этом устройстве на 30 дней, сменить его можно в меню профиля. От этого выбора зависит, чьи weekly и задачи вы ведёте. Тех, у кого уже есть
          личный пароль, здесь нет: они входят своим логином и паролем.
        </p>
        {lost ? (
          <p role="status" className="sv-alert sv-alert--info mt-5">
            {lost} теперь входит своим логином и паролем, по общему логину этот профиль больше не открывается. Выберите себя из списка или войдите со своим логином.
          </p>
        ) : null}
        {denied ? (
          <p role="alert" className="sv-alert sv-alert--warning mt-5">
            Этот профиль по общему логину не выбрать: у человека личный пароль или он выключен. Выберите себя из списка.
          </p>
        ) : null}

        <form action={chooseProfile} className="mt-6">
          <ChooseList people={people} current={session.personId ?? null} />
        </form>
        {/* Общий логин без выхода не пустит на экран входа: кнопка выходит и открывает его */}
        <form action={logout} className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-small text-muted">
          <span>Есть свой логин и пароль?</span>
          <button type="submit" className={buttonClass("secondary", "sm")}>
            Войти своим логином
          </button>
        </form>
      </main>
    </div>
  );
}
