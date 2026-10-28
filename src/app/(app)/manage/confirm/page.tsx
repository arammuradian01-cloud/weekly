import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext, teamManagementRefused } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ConfirmStepUpForm } from "../manage-form";
import { TeamRefusal } from "../team-refusal";

export const metadata: Metadata = { title: "Подтверждение режима управления" };

/** Ссылка из письма открывает экран с кнопкой: режим включается только по нажатию */
export default async function ConfirmStepUpPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const ctx = await requireContext();
  const { t = "" } = await searchParams;
  if (teamManagementRefused(ctx)) return <TeamRefusal />;
  if (!ctx.managementRole) redirect("/");
  if (ctx.management) redirect("/");
  return (
    <div className="max-w-md">
      <PageHeader title="Режим управления" description={`Профиль: ${ctx.person.fullName}. Подтверждение по ссылке из письма, режим действует 12 часов.`} />
      <ConfirmStepUpForm token={t} next="/" />
    </div>
  );
}
