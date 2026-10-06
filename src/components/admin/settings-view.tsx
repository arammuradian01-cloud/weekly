"use client";

import { useState } from "react";
import { Download, EyeOff, Pencil, Plus, RotateCcw, UserMinus, UserPlus } from "lucide-react";
import { PRIORITIES, STATES, STATUSES, dictOptions, type EditableDictKind } from "@/domain/dictionaries";
import type { Role } from "@/domain/types";
import type { DictItemView, PersonView, Rhythm, StandBanner } from "@/lib/admin/service";
import { DICT_TITLES, WEEKDAYS } from "@/lib/admin/labels";
import {
  addDictItemAction,
  createPersonAction,
  renameDictItemAction,
  saveRhythmAction,
  saveStandBannerAction,
  setDictItemActiveAction,
  setPersonActiveAction,
  updatePersonAction,
} from "@/app/(app)/settings/actions";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Segmented, SelectField, TextInput } from "@/components/ui/primitives";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";

const ROLES: { value: Role; label: string }[] = [
  { value: "OWNER", label: "Владелец" },
  { value: "ADMIN", label: "Администратор" },
  { value: "LEADER", label: "Лидер" },
  { value: "OBSERVER", label: "Наблюдатель" },
];
const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r;
const dayOptions = WEEKDAYS.map((d, i) => ({ value: String(i + 1), label: d.charAt(0).toUpperCase() + d.slice(1) }));
const timeOptions = Array.from({ length: 29 }, (_, i) => {
  const h = 8 + Math.floor(i / 2);
  const t = `${String(h).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
  return { value: t, label: t };
});
const KINDS: EditableDictKind[] = ["DIRECTION", "WEEKLY_BLOCK", "ENTRY_TYPE", "TASK_SOURCE"];
const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10;
  const t = n % 100;
  return d === 1 && t !== 11 ? one : d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-line py-8 first:border-t-0 first:pt-0 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
      <div>
        <h2 className="text-[19px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-[14px] text-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/**
 * Настройки ресурса (разделы 2, 3 и 6 ТЗ). Всё сохраняется на сервере и пишется в журнал.
 * Ритм недели и справочники видят владелец и администраторы, людей, пароли и выгрузку только владелец
 */
export function SettingsView({
  owner,
  me,
  rhythm,
  dicts,
  people,
  passwords,
  sessionKey,
  banner,
}: {
  owner: boolean;
  me: string;
  rhythm: Rhythm;
  dicts: Record<EditableDictKind, DictItemView[]>;
  people: PersonView[];
  passwords: { title: string; set: boolean }[];
  /** Откуда ключ сессий: свой SESSION_SECRET или выведен из пароля базы */
  sessionKey: "env" | "derived" | "none";
  /** Плашка над страницами: тестовый стенд, пилот или без плашки */
  banner: StandBanner;
}) {
  return (
    <div>
      <RhythmSection initial={rhythm} />
      <Section title="Справочники" description="Значения списков в weekly и задачах. Скрытое значение пропадает из выбора, но остаётся в старых записях">
        <div className="grid gap-6 xl:grid-cols-2">
          {KINDS.map((kind) => (
            <DictList key={kind} kind={kind} items={dicts[kind]} />
          ))}
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-ink">Статусы, приоритеты и состояния</h3>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <Badge key={s.code} tone={s.tone}>
                    {s.label}
                  </Badge>
                ))}
              </div>
              <p className="text-[14px] text-muted">
                {PRIORITIES.map((p) => p.label).join(", ")}. {STATES.map((s) => s.label).join(", ")}.
              </p>
              <p className="text-[13px] text-muted">Эти значения завязаны на правила просрочки и цвета, поэтому меняются только через разработку.</p>
            </div>
          </div>
        </div>
      </Section>

      {owner ? (
        <>
          <PeopleSection people={people} me={me} />

          <Section title="Пароли" description="Задаются на странице первичной настройки или командой на сервере. В интерфейсе их не видно">
            <ul className="flex flex-col gap-2 text-[15px]">
              {passwords.map((p) => (
                <li key={p.title} className="flex flex-wrap items-center gap-3">
                  <span className="w-72 text-ink">{p.title}</span>
                  <Badge tone={p.set ? "green" : "red"}>{p.set ? "Задан" : "Не задан"}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] text-muted">После смены общего пароля все выходят. Сменить пароль: команда npm run password на сервере.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-[15px]">
              <span className="w-72 text-ink">Ключ сессий</span>
              <Badge tone={sessionKey === "env" ? "green" : "yellow"}>{sessionKey === "env" ? "Свой, SESSION_SECRET" : "Из пароля базы"}</Badge>
            </div>
            {sessionKey !== "env" ? (
              <p className="mt-2 text-[14px] text-muted">
                До пилота задайте в переменных приложения SESSION_SECRET: случайную строку не короче 32 символов. После этого все один раз войдут заново.
              </p>
            ) : null}
          </Section>

          <BannerSection initial={banner} />

          <Section title="Google-таблица" description="Куда ресурс зеркалит задачи и weekly">
            <p className="text-[15px] text-ink">
              Ссылка на таблицу, очередь и история выгрузок на странице{" "}
              <a href="/sync" className="font-medium text-blue-700 underline-offset-2 hover:underline">
                «Синхронизация»
              </a>
              . Рабочая таблица Insurance&Invest Bord подключается только с согласия владельца.
            </p>
          </Section>

          <Section title="Выгрузка данных" description="Второй уровень защиты вместе с историей версий таблицы">
            <a href="/settings/export" className={buttonClass("secondary")} download>
              <Download className="h-4 w-4" aria-hidden="true" />
              Выгрузить всё в Excel
            </a>
            <p className="mt-3 text-[14px] text-muted">Один файл: задачи с переносами и комментариями, weekly, недели, отчёты CEO, люди, справочники и журнал. Выгрузка попадает в журнал.</p>
          </Section>
        </>
      ) : (
        <p className="border-t border-line pt-6 text-[14px] text-muted">Люди, роли, пароли и выгрузка данных открываются паролем владельца.</p>
      )}
    </div>
  );
}

function RhythmSection({ initial }: { initial: Rhythm }) {
  const run = useRunAction();
  const { notify } = usePrototype();
  const [form, setForm] = useState({
    deadlineWeekday: String(initial.deadlineWeekday),
    deadlineTime: initial.deadlineTime,
    meetingWeekday: String(initial.meetingWeekday),
    staleDays: String(initial.staleDays),
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const times = timeOptions.some((t) => t.value === form.deadlineTime) ? timeOptions : [...timeOptions, { value: form.deadlineTime, label: form.deadlineTime }];
  return (
    <Section title="Ритм недели" description="Срок сдачи, встреча и порог «давно не обновлялась». Новый срок действует для недель, срок которых ещё не прошёл">
      <form
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await run(() =>
            saveRhythmAction({
              deadlineWeekday: Number(form.deadlineWeekday),
              deadlineTime: form.deadlineTime,
              meetingWeekday: Number(form.meetingWeekday),
              staleDays: Number(form.staleDays),
            }),
          );
          setBusy(false);
          if (r) notify(r.changed ? "Ритм недели сохранён" : "Ничего не изменилось");
        }}
      >
        <SelectField label="День сдачи weekly" id="s-day" value={form.deadlineWeekday} onChange={set("deadlineWeekday")} options={dayOptions} hint="После окончания недели" />
        <SelectField label="Время сдачи" id="s-time" value={form.deadlineTime} onChange={set("deadlineTime")} options={times} hint="По Москве" />
        <SelectField label="День встречи" id="s-meet" value={form.meetingWeekday} onChange={set("meetingWeekday")} options={dayOptions} hint="На следующей неделе" />
        <TextInput label="Без обновлений, дней" id="s-stale" type="number" min={1} max={90} value={form.staleDays} onChange={set("staleDays")} hint="Потом метка «давно не обновлялась»" />
        <div className="sm:col-span-2 xl:col-span-4">
          <Button type="submit" variant="secondary" disabled={busy}>
            {busy ? "Сохраняю…" : "Сохранить ритм недели"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function DictList({ kind, items }: { kind: EditableDictKind; items: DictItemView[] }) {
  const run = useRunAction();
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const title = DICT_TITLES[kind];
  return (
    <div className="min-w-0">
      <h3 className="mb-2 text-[15px] font-semibold text-ink">{title}</h3>
      <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
        {items.map((item) => (
          <li key={item.code} className="flex items-center justify-between gap-3 px-4 py-2">
            {editing === item.code ? (
              <form
                className="flex w-full gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await run(() => renameDictItemAction(kind, item.code, label), `Переименовано: «${label.trim()}»`);
                  if (r) setEditing(null);
                }}
              >
                <label htmlFor={`rn-${kind}-${item.code}`} className="sr-only">
                  Новое название для «{item.label}»
                </label>
                <input
                  id={`rn-${kind}-${item.code}`}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  autoFocus
                  className="h-10 min-w-0 flex-1 rounded-lg border border-line px-3 text-[14px] focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
                />
                <Button size="sm" type="submit" className="h-10">
                  Сохранить
                </Button>
                <Button size="sm" variant="ghost" type="button" className="h-10" onClick={() => setEditing(null)}>
                  Отмена
                </Button>
              </form>
            ) : (
              <>
                <span className="flex min-w-0 flex-col">
                  <span className={cn("break-words text-[15px]", item.active ? "text-ink" : "text-muted line-through")}>{item.label}</span>
                  <span className="text-[13px] text-muted">{item.used ? `${item.used} ${plural(item.used, "запись", "записи", "записей")}` : "не используется"}</span>
                </span>
                <span className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(item.code);
                      setLabel(item.label);
                    }}
                    aria-label={`Переименовать «${item.label}»`}
                    title="Переименовать"
                    className="inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-md px-2 text-[14px] font-medium text-blue-700 hover:bg-surface sm:h-9"
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Изменить</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void run(() => setDictItemActiveAction(kind, item.code, !item.active), item.active ? `«${item.label}» скрыто` : `«${item.label}» снова в списке`)}
                    aria-label={item.active ? `Скрыть «${item.label}»` : `Вернуть «${item.label}»`}
                    title={item.active ? "Скрыть" : "Вернуть"}
                    className="inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-md px-2 text-[14px] font-medium text-blue-700 hover:bg-surface sm:h-9"
                  >
                    {item.active ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                    <span className="hidden sm:inline">{item.active ? "Скрыть" : "Вернуть"}</span>
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {kind === "ENTRY_TYPE" ? (
        <p className="mt-2 text-[13px] text-muted">Новые типы не добавляются: на них держатся разделы отчёта CEO. Тип можно переименовать или скрыть.</p>
      ) : (
        <form
          className="mt-2 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!adding.trim()) return;
            const r = await run(() => addDictItemAction(kind, adding), `«${adding.trim()}» добавлено`);
            if (r) setAdding("");
          }}
        >
          <label htmlFor={`add-${kind}`} className="sr-only">
            Новое значение: {title}
          </label>
          <input
            id={`add-${kind}`}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Новое значение"
            className="h-10 min-w-0 flex-1 rounded-lg border border-line px-3 text-[14px] focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
          />
          <Button size="sm" variant="secondary" type="submit" className="h-10">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить
          </Button>
        </form>
      )}
    </div>
  );
}

type PersonForm = { fullName: string; shortName: string; zone: string; role: Role; direction: string };

function PersonFields({ id, form, set }: { id: string; form: PersonForm; set: (patch: Partial<PersonForm>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextInput label="Фамилия и имя" id={`${id}-name`} value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} placeholder="Фамилия Имя" />
      <TextInput label="Короткое имя" id={`${id}-short`} value={form.shortName} onChange={(e) => set({ shortName: e.target.value })} hint="Как подписывать в ленте. Пусто: имя" />
      <TextInput label="Зона ответственности" id={`${id}-zone`} value={form.zone} onChange={(e) => set({ zone: e.target.value })} className="sm:col-span-2" />
      <SelectField label="Роль" id={`${id}-role`} value={form.role} onChange={(e) => set({ role: e.target.value as Role })} options={ROLES} />
      <SelectField label="Направление по умолчанию" id={`${id}-dir`} value={form.direction} onChange={(e) => set({ direction: e.target.value })} options={dictOptions("DIRECTION", form.direction)} />
    </div>
  );
}

function PeopleSection({ people, me }: { people: PersonView[]; me: string }) {
  const run = useRunAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState<string | null>(null);
  const [form, setForm] = useState<PersonForm>({ fullName: "", shortName: "", zone: "", role: "LEADER", direction: "" });
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PersonForm>({ fullName: "", shortName: "", zone: "", role: "LEADER", direction: dictOptions("DIRECTION")[0]?.value ?? "" });

  const toggle = async (p: PersonView) => {
    if (p.active && p.openTasks > 0 && confirmOff !== p.slug) return setConfirmOff(p.slug);
    setConfirmOff(null);
    await run(() => setPersonActiveAction(p.slug, !p.active), p.active ? `${p.fullName} выключен` : `${p.fullName} снова в команде`);
  };

  return (
    <Section title="Люди и роли" description="Владелец добавляет и выключает людей сам, без разработчика. Выключенный человек пропадает из списков, его история остаётся">
      <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
        {people.map((p) => (
          <li key={p.slug} className="px-4 py-3">
            {editing === p.slug ? (
              <form
                className="flex flex-col gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const r = await run(() => updatePersonAction(p.slug, form), "Изменения сохранены");
                  if (r) setEditing(null);
                }}
              >
                <PersonFields id={`p-${p.slug}`} form={form} set={(patch) => setForm((f) => ({ ...f, ...patch }))} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm">
                    Сохранить
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    Отмена
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className={cn("text-[15px] font-medium", p.active ? "text-ink" : "text-muted")}>
                    {p.fullName}
                    {p.active ? "" : " (выключен)"}
                    {p.slug === me ? <span className="ml-2 text-[13px] font-normal text-muted">это вы</span> : null}
                  </p>
                  <p className="text-[13px] text-muted">
                    {roleLabel(p.role)}. {p.zone}
                    {p.openTasks ? `. Открытых задач: ${p.openTasks}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Изменить: ${p.fullName}`}
                    onClick={() => {
                      setEditing(p.slug);
                      setForm({ fullName: p.fullName, shortName: p.shortName, zone: p.zone, role: p.role, direction: p.direction });
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    Изменить
                  </Button>
                  {p.slug === me ? null : (
                    <Button size="sm" variant="ghost" onClick={() => void toggle(p)} aria-label={p.active ? `Выключить: ${p.fullName}` : `Включить: ${p.fullName}`}>
                      {p.active ? <UserMinus className="h-4 w-4" aria-hidden="true" /> : <UserPlus className="h-4 w-4" aria-hidden="true" />}
                      {p.active ? "Выключить" : "Включить"}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {confirmOff === p.slug ? (
              <div role="alert" className="mt-2 flex flex-col gap-2 rounded-lg bg-warning-soft px-3.5 py-2.5 text-[14px] text-warning-ink sm:flex-row sm:items-center sm:justify-between">
                <span>
                  У человека {p.openTasks} {plural(p.openTasks, "открытая задача", "открытые задачи", "открытых задач")}. Задачи останутся за ним, передайте их другому в карточке задачи.
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void toggle(p)}>
                    Выключить всё равно
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmOff(null)}>
                    Отмена
                  </Button>
                </span>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="mt-3 flex flex-col gap-3 rounded-xl bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => createPersonAction(draft), `${draft.fullName.trim()} добавлен`);
            if (r) {
              setAdding(false);
              setDraft((d) => ({ ...d, fullName: "", shortName: "", zone: "" }));
            }
          }}
        >
          <PersonFields id="new-person" form={draft} set={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <div className="flex gap-2">
            <Button type="submit">Добавить в команду</Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Отмена
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="secondary" className="mt-3" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Добавить человека
        </Button>
      )}
    </Section>
  );
}

const BANNER_OPTIONS: { value: StandBanner; label: string }[] = [
  { value: "test", label: "Тестовый стенд" },
  { value: "pilot", label: "Пилот" },
  { value: "off", label: "Без плашки" },
];

/** Плашка над всеми страницами: на пилоте она ведёт к инструкции и говорит, кому писать замечания */
function BannerSection({ initial }: { initial: StandBanner }) {
  const run = useRunAction();
  const { notify } = usePrototype();
  const [value, setValue] = useState<StandBanner>(initial);
  return (
    <Section title="Плашка над страницами" description="Видна всем. На пилоте ведёт к инструкции «Как работать» и подсказывает, кому писать замечания">
      <Segmented
        label="Плашка над страницами"
        options={BANNER_OPTIONS}
        value={value}
        onChange={async (next) => {
          const previous = value;
          setValue(next);
          const r = await run(() => saveStandBannerAction(next));
          if (r) notify("Плашка сохранена");
          else setValue(previous);
        }}
      />
    </Section>
  );
}

