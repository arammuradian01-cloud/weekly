import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireManagement } from "@/lib/auth";
import { PASSWORD_SETTING_KEYS, type PasswordKind } from "@/lib/passwords";
import { ROLE_LABELS } from "@/lib/roles";
import { WEEKDAYS_SHORT, type DeadlineSetting } from "@/lib/week";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import type { DictKind } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Настройки" };

const WEEKDAY_NAMES = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

const DICT_TITLES: Record<DictKind, string> = {
  DIRECTION: "Направления",
  WEEKLY_BLOCK: "Блоки weekly",
  ENTRY_TYPE: "Типы записей",
  TASK_STATUS: "Статусы задач",
  PRIORITY: "Приоритеты",
  TASK_STATE: "Состояния задач",
  WEEKLY_STATE: "Состояния weekly",
  TASK_SOURCE: "Источники задач",
};

const PASSWORD_TITLES: Record<PasswordKind, string> = {
  team: "Общий вход",
  owner: "Режим управления владельца",
  admin: "Режим управления администраторов",
};

const TONES = new Set(["green", "blue", "yellow", "red", "gray", "outline"]);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line py-6 first:border-t-0 first:pt-0">
      <h2 className="mb-3 text-[19px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default async function SettingsPage() {
  const ctx = await requireManagement(["OWNER", "ADMIN"], "/settings");
  const owner = ctx.management?.role === "OWNER";
  const [settings, items, people] = await Promise.all([
    prisma.setting.findMany(),
    prisma.dictionaryItem.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    owner ? prisma.person.findMany({ orderBy: { sortOrder: "asc" } }) : Promise.resolve([]),
  ]);
  const value = <T,>(key: string, fallback: T): T => (settings.find((s) => s.key === key)?.value as T) ?? fallback;
  const deadline = value<DeadlineSetting>("week.deadline", { weekday: 1, time: "18:00" });
  const meeting = value<{ weekday: number }>("week.meeting", { weekday: 2 });

  return (
    <>
      <PageHeader title="Настройки" description="Пока только просмотр. Правка справочников и людей появится на этапе 5." />

      <Section title="Ритм недели">
        <dl className="grid gap-x-8 gap-y-2 text-[15px] sm:grid-cols-[220px_1fr]">
          <dt className="text-muted">Срок сдачи weekly</dt>
          <dd className="text-ink">
            {WEEKDAY_NAMES[deadline.weekday - 1]} после окончания недели, {deadline.time} по Москве
          </dd>
          <dt className="text-muted">Встреча команды</dt>
          <dd className="text-ink">{WEEKDAY_NAMES[meeting.weekday - 1]}</dd>
          <dt className="text-muted">Задача давно не обновлялась</dt>
          <dd className="text-ink">через {value<number>("tasks.staleDays", 14)} дней без обновлений</dd>
          <dt className="text-muted">Номер следующей задачи</dt>
          <dd className="text-ink">{value<number>("tasks.nextNumber", 52)}</dd>
        </dl>
      </Section>

      <Section title="Справочники">
        <div className="grid gap-5 sm:grid-cols-2">
          {(Object.keys(DICT_TITLES) as DictKind[]).map((kind) => (
            <div key={kind}>
              <h3 className="mb-2 text-[15px] font-medium text-muted">{DICT_TITLES[kind]}</h3>
              <div className="flex flex-wrap gap-1.5">
                {items
                  .filter((i) => i.kind === kind)
                  .map((i) => (
                    <Badge key={i.id} tone={i.color && TONES.has(i.color) ? (i.color as "green") : "outline"} className={i.active ? "" : "opacity-50"}>
                      {i.label}
                      {i.active ? "" : " (скрыт)"}
                    </Badge>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {owner ? (
        <>
          <Section title="Пароли">
            <ul className="flex flex-col gap-2 text-[15px]">
              {(Object.keys(PASSWORD_SETTING_KEYS) as PasswordKind[]).map((kind) => {
                const set = Boolean(value<string | null>(PASSWORD_SETTING_KEYS[kind], null));
                return (
                  <li key={kind} className="flex flex-wrap items-center gap-3">
                    <span className="w-72 text-ink">{PASSWORD_TITLES[kind]}</span>
                    <Badge tone={set ? "green" : "red"}>{set ? "Задан" : "Не задан"}</Badge>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[14px] text-muted">
              Пароли меняются только на сервере командой npm run password, в интерфейсе их не видно. После смены общего пароля все выходят из ресурса.
            </p>
          </Section>
          <Section title="Люди и роли">
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[15px]">
                  <span className={p.active ? "text-ink" : "text-muted"}>
                    {p.fullName}
                    {p.active ? "" : " (выключен)"}
                  </span>
                  <span className="text-muted">{ROLE_LABELS[p.role]}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : null}

      <p className="mt-4 text-[13px] text-muted">Время везде московское. Неделя с понедельника ({WEEKDAYS_SHORT[0]}) по воскресенье ({WEEKDAYS_SHORT[6]}).</p>
    </>
  );
}
