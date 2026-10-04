import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ManageForm } from "./manage-form";

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
    </div>
  );
}
