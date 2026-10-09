import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireManagement } from "@/lib/auth";
import { PASSWORD_SETTING_KEYS, type PasswordKind } from "@/lib/passwords";
import { sessionSecretSource } from "@/lib/database-url";
import { getRhythm, getStandBanner, listDictionaries, listPeople } from "@/lib/admin/service";
import { getTeamLogin } from "@/lib/login/service";
import { passwordStats } from "@/lib/login/password";
import { absenceWeeks, upcomingAbsencesAll } from "@/lib/weekly/service";
import { mailConfigured } from "@/lib/mail";
import { PageHeader } from "@/components/page-header";
import { SettingsView } from "@/components/admin/settings-view";
import { Figures } from "@/components/ui/data";

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
  const [rhythm, dicts, people, settings, banner, teamLogin, absences, weeks, personal] = await Promise.all([
    getRhythm(),
    listDictionaries(),
    owner ? listPeople() : Promise.resolve([]),
    owner ? prisma.setting.findMany({ where: { key: { in: Object.values(PASSWORD_SETTING_KEYS) } } }) : Promise.resolve([]),
    getStandBanner(),
    getTeamLogin(),
    owner ? upcomingAbsencesAll() : Promise.resolve({}),
    owner ? absenceWeeks(new Date(), { own: false }) : Promise.resolve([]),
    owner ? passwordStats(ctx.person.id) : Promise.resolve(undefined),
  ]);
  const passwords = (Object.keys(PASSWORD_SETTING_KEYS) as PasswordKind[]).map((kind) => ({
    title: PASSWORD_TITLES[kind],
    set: Boolean(settings.find((s) => s.key === PASSWORD_SETTING_KEYS[kind])?.value),
  }));

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Ритм недели, справочники, люди и роли. Время везде московское"
        figures={
          owner && people.length ? (
            // Этап 37: люди и входы в цифрах, только владельцу (люди и пароли видит только он)
            <Figures
              label="Люди и входы в цифрах"
              items={[
                { label: "Людей включено", value: people.filter((p) => p.active).length, testId: "set-fig-active" },
                { label: "Выключено", value: people.filter((p) => !p.active).length, testId: "set-fig-off" },
                ...(personal ? [{ label: "С личным паролем", value: `${personal.withPassword} из ${personal.total}`, testId: "set-fig-passwords" }] : []),
                ...(personal ? [{ label: "Без личного пароля", value: personal.invitable, tone: "warning" as const, testId: "set-fig-invitable" }] : []),
                { label: "Отсутствия впереди", value: Object.values(absences as Record<string, unknown[]>).filter((list) => list.length).length, testId: "set-fig-absences" },
              ]}
            />
          ) : null
        }
      />
      <SettingsView owner={owner} me={ctx.person.slug} rhythm={rhythm} dicts={dicts} people={people} passwords={passwords} sessionKey={owner ? sessionSecretSource() : "env"} banner={banner} login={{ team: teamLogin, mail: mailConfigured(), personal: ctx.via !== "TEAM", passwords: personal }} absences={absences} weeks={weeks} />
    </>
  );
}
