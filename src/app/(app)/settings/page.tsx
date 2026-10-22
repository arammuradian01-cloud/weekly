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
import { approvalDepartments, loadApprovalSetting } from "@/lib/tasks/approval";
import { numbersAccessView } from "@/lib/plan/access";
import { marketSettingsView } from "@/lib/market/access";
import { PageHeader } from "@/components/page-header";
import { SettingsView } from "@/components/admin/settings-view";
import { Figures } from "@/components/ui/data";
import { plural } from "@/domain/dates";
import { claudeStatus, lastFetchAt, listSources, loadKeywords, manualFetchState, newsDirections } from "@/lib/news/service";

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
  const approval = owner ? { setting: await loadApprovalSetting(), departments: await approvalDepartments() } : undefined;
  // Этап 57: кто видит цифры прогноза
  const numbersAccess = owner ? await numbersAccessView() : undefined;
  // Этап 62: кто видит рынок КАСКО и ОСАГО и у каких команд разбор на встрече
  const market = owner ? await marketSettingsView() : undefined;
  // Этап 67: импорт наполнения, только владельцу при личном входе в режиме управления
  const contentImport = owner && ctx.person.role === "OWNER" && !!ctx.via && ctx.via !== "TEAM";
  // Новости (этап 60): источники, ключевые слова и состояние забора, только владельцу
  const news = owner
    ? { sources: await listSources(), keywords: await loadKeywords(), directions: await newsDirections(), lastFetchAt: (await lastFetchAt())?.toISOString() ?? null, claude: await claudeStatus(), manual: await manualFetchState() }
    : undefined;
  const active = people.filter((p) => p.active).length;
  const away = Object.entries(absences as Record<string, unknown[]>).filter(([slug, list]) => list.length && people.some((p) => p.slug === slug && p.active)).length;
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
            // Этап 37: люди и входы в цифрах, только владельцу (люди и пароли видит только он). Этап 48: строкой, не
            // больше трёх, нули спрятаны, цифра ведёт к разделу. Этап 68: цифр ровно три, по одной на действие.
            // «Выключено» и «с личным паролем» убраны: первое видно в разделе людей, второе дополняет «без личного
            // пароля» до «включено». При пяти цифрах и max 3 «с отсутствием впереди» без оттенка не попадала в строку
            <Figures
              label="Люди и входы в цифрах"
              inline
              max={3}
              items={[
                { label: plural(active, "человек включён", "человека включено", "человек включено"), value: active, href: "#people", testId: "set-fig-active", keepZero: true },
                ...(personal ? [{ label: "без личного пароля", value: personal.total - personal.withPassword, tone: "warning" as const, href: "#login", testId: "set-fig-invitable" }] : []),
                { label: "с отсутствием впереди", value: away, href: "#people", testId: "set-fig-absences" },
              ]}
            />
          ) : null
        }
      />
      <SettingsView owner={owner} me={ctx.person.slug} rhythm={rhythm} dicts={dicts} people={people} passwords={passwords} sessionKey={owner ? sessionSecretSource() : "env"} banner={banner} login={{ team: teamLogin, mail: mailConfigured(), personal: ctx.via !== "TEAM", passwords: personal }} absences={absences} weeks={weeks} approval={approval} numbersAccess={numbersAccess} market={market} news={news} contentImport={contentImport} />
    </>
  );
}
