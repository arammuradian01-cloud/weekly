import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { listDevices } from "@/lib/login/service";
import { LOGIN_METHOD_LABELS } from "@/lib/login/labels";
import { PageHeader } from "@/components/page-header";
import { DeviceList } from "@/components/profile/device-list";
import { Absences } from "@/components/profile/absences";
import { absenceWeeks, upcomingAbsences } from "@/lib/weekly/service";
import { prisma } from "@/lib/db";

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
  const [devices, absences, weeks, colleagues] = await Promise.all([
    ctx.via === "TEAM" ? Promise.resolve([]) : listDevices(ctx.person.id),
    observer ? Promise.resolve([]) : upcomingAbsences(ctx.person.id),
    absenceWeeks(),
    prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" }, id: { not: ctx.person.id } }, orderBy: { sortOrder: "asc" }, select: { slug: true, fullName: true } }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Профиль" description="Роль, зону и почту меняет владелец ресурса в настройках" />
      <dl className="flex flex-col gap-3">
        <Row label="Имя">{ctx.person.fullName}</Row>
        <Row label="Роль">{ROLE_LABELS[ctx.person.role]}</Row>
        <Row label="Зона">{ctx.person.zone || "не указана"}</Row>
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
