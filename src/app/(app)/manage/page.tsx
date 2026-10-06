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
  return (
    <div className="max-w-md">
      <PageHeader
        title="Режим управления"
        description={`Профиль: ${ctx.person.fullName}. Режим открывает отчёт CEO, журнал и настройки и действует 12 часов.`}
      />
      <ManageForm passwordLabel={owner ? "Пароль владельца" : "Пароль администраторов"} next={target} />
      {ctx.via !== "TEAM" && mailConfigured() && ctx.person.email ? (
        <div className="mt-8 border-t border-line pt-6">
          <h2 className="text-title-sm font-semibold text-ink">Без пароля</h2>
          <p className="mb-4 mt-1 text-small text-muted">Ссылка подтверждения придёт на {ctx.person.email}. Откройте её на этом же устройстве.</p>
          <StepUpForm />
        </div>
      ) : null}
    </div>
  );
}
