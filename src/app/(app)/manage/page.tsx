import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { mailConfigured } from "@/lib/mail";
import { ManageForm, StepUpForm } from "./manage-form";

export const metadata: Metadata = { title: "Режим управления" };

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const ctx = await requireContext();
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (!ctx.managementRole) redirect("/");
  if (ctx.management) redirect(target);

  const owner = ctx.managementRole === "OWNER";
  // Этап 68: подписи шапки нет: профиль, что открывает режим, и срок отдельными строками. Метки sv-tag на фоне
  // страницы не видны (field почти равен page), поэтому разделы простым текстом
  return (
    <div className="max-w-md">
      <PageHeader title="Режим управления">
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
          <dt className="text-muted">Профиль</dt>
          <dd className="m-0 text-ink">{ctx.person.fullName}</dd>
          <dt className="text-muted">Открывает</dt>
          <dd className="m-0 text-ink">Отчёт CEO, журнал, настройки</dd>
          <dt className="text-muted">Действует</dt>
          <dd className="m-0 text-ink">12 часов</dd>
        </dl>
      </PageHeader>
      <ManageForm passwordLabel={owner ? "Пароль владельца" : "Пароль администраторов"} next={target} />
      {ctx.via !== "TEAM" && mailConfigured() && ctx.person.email ? (
        <div className="mt-8 border-t border-line pt-6">
          <h2 className="text-title-sm font-semibold text-ink">Без пароля</h2>
          <p className="mb-4 mt-1 text-small text-muted">Ссылка придёт на {ctx.person.email}. Откройте её на этом же устройстве.</p>
          <StepUpForm />
        </div>
      ) : null}
    </div>
  );
}
