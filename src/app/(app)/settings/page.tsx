import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireManagement } from "@/lib/auth";
import { PASSWORD_SETTING_KEYS, type PasswordKind } from "@/lib/passwords";
import { PageHeader } from "@/components/page-header";
import { SettingsView } from "@/components/admin/settings-view";

export const metadata: Metadata = { title: "Настройки" };

const PASSWORD_TITLES: Record<PasswordKind, string> = {
  team: "Общий вход",
  owner: "Режим управления владельца",
  admin: "Режим управления администраторов",
};

export default async function SettingsPage() {
  const ctx = await requireManagement(["OWNER", "ADMIN"], "/settings");
  const owner = ctx.management?.role === "OWNER";
  // Состояние паролей настоящее: задан или нет. Сами хэши в браузер не уходят
  const settings = owner ? await prisma.setting.findMany({ where: { key: { in: Object.values(PASSWORD_SETTING_KEYS) } } }) : [];
  const passwords = (Object.keys(PASSWORD_SETTING_KEYS) as PasswordKind[]).map((kind) => ({
    title: PASSWORD_TITLES[kind],
    set: Boolean(settings.find((s) => s.key === PASSWORD_SETTING_KEYS[kind])?.value),
  }));

  return (
    <>
      <PageHeader title="Настройки" description="Ритм недели, справочники, люди и роли. Время везде московское" />
      <SettingsView owner={owner} passwords={passwords} />
    </>
  );
}
