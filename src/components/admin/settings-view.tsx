"use client";

import { useState } from "react";
import { Download, Plus } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { PEOPLE } from "@/prototype/people";
import { BLOCKS, DIRECTIONS, ENTRY_TYPES, PRIORITIES, SOURCES, STATES, STATUSES } from "@/prototype/dictionaries";
import type { Role } from "@/prototype/types";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SelectField, TextInput } from "@/components/ui/primitives";

const WEEKDAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const ROLES: { value: Role; label: string }[] = [
  { value: "OWNER", label: "Владелец" },
  { value: "ADMIN", label: "Администратор" },
  { value: "LEADER", label: "Лидер" },
  { value: "OBSERVER", label: "Наблюдатель" },
];

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

/** Настройки в прототипе: правки видны сразу, но никуда не записываются */
export function SettingsView({ owner, passwords }: { owner: boolean; passwords: { title: string; set: boolean }[] }) {
  const { notify } = usePrototype();
  const [people, setPeople] = useState(PEOPLE.map((p) => ({ ...p, active: true })));
  const [newName, setNewName] = useState("");
  const [dicts, setDicts] = useState({
    Направления: DIRECTIONS.map((d) => ({ label: d.label, active: true })),
    "Блоки weekly": [...BLOCKS.map((b) => ({ label: b.label, active: true })), { label: "Цифры и прогноз", active: false }],
    "Типы записей": ENTRY_TYPES.map((t) => ({ label: t.label, active: true })),
    "Источники задач": SOURCES.map((s) => ({ label: s.label, active: true })),
  });
  const [adding, setAdding] = useState<Record<string, string>>({});

  return (
    <div>
      <Section title="Ритм недели" description="Срок сдачи, встреча и пороги">
        <form
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            notify("Настройки недели сохранены");
          }}
        >
          <SelectField label="День сдачи weekly" id="s-day" defaultValue="0" options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
          <SelectField
            label="Время сдачи"
            id="s-time"
            defaultValue="18:00"
            hint="По Москве"
            options={Array.from({ length: 27 }, (_, i) => {
              const h = 8 + Math.floor(i / 2);
              const t = `${String(h).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
              return { value: t, label: t };
            })}
          />
          <SelectField label="День встречи" id="s-meet" defaultValue="1" options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />
          <TextInput label="Без обновлений, дней" id="s-stale" type="number" min={1} defaultValue={14} hint="Потом метка «давно не обновлялась»" />
          <div className="sm:col-span-2 xl:col-span-4">
            <Button type="submit" variant="secondary">
              Сохранить
            </Button>
          </div>
        </form>
      </Section>

      <Section title="Справочники" description="Значения списков в weekly и задачах. Скрытое значение пропадает из выбора, но остаётся в старых записях">
        <div className="grid gap-6 xl:grid-cols-2">
          {Object.entries(dicts).map(([name, items]) => (
            <div key={name}>
              <h3 className="mb-2 text-[15px] font-semibold text-ink">{name}</h3>
              <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
                {items.map((item, i) => (
                  <li key={item.label} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className={cn("text-[15px]", item.active ? "text-ink" : "text-muted line-through")}>{item.label}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setDicts((d) => ({ ...d, [name]: d[name as keyof typeof d].map((x, j) => (j === i ? { ...x, active: !x.active } : x)) }));
                        notify(item.active ? `«${item.label}» скрыто` : `«${item.label}» снова в списке`);
                      }}
                      className="h-9 rounded-md px-2 text-[14px] font-medium text-blue-700 hover:bg-surface"
                    >
                      {item.active ? "Скрыть" : "Вернуть"}
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="mt-2 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const label = (adding[name] ?? "").trim();
                  if (!label) return;
                  setDicts((d) => ({ ...d, [name]: [...d[name as keyof typeof d], { label, active: true }] }));
                  setAdding((a) => ({ ...a, [name]: "" }));
                  notify(`«${label}» добавлено`);
                }}
              >
                <label htmlFor={`add-${name}`} className="sr-only">
                  Новое значение: {name}
                </label>
                <input
                  id={`add-${name}`}
                  value={adding[name] ?? ""}
                  onChange={(e) => setAdding((a) => ({ ...a, [name]: e.target.value }))}
                  placeholder="Новое значение"
                  className="h-10 min-w-0 flex-1 rounded-lg border border-line px-3 text-[14px] focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
                />
                <Button size="sm" variant="secondary" type="submit" className="h-10">
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Добавить
                </Button>
              </form>
            </div>
          ))}
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-ink">Статусы, приоритеты и состояния</h3>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <Badge key={s.code} tone={s.tone}>{s.label}</Badge>
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
          <Section title="Люди и роли" description="Владелец добавляет и выключает людей сам, без разработчика. Выключенный человек пропадает из списков, его история остаётся">
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {people.map((p, i) => (
                <li key={p.slug} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className={cn("text-[15px] font-medium", p.active ? "text-ink" : "text-muted")}>
                      {p.fullName}
                      {p.active ? "" : " (выключен)"}
                    </p>
                    <p className="text-[13px] text-muted">{p.zone}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label htmlFor={`role-${p.slug}`} className="sr-only">
                      Роль: {p.fullName}
                    </label>
                    <select
                      id={`role-${p.slug}`}
                      value={p.role}
                      onChange={(e) => {
                        setPeople((list) => list.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)));
                        notify("Роль изменена");
                      }}
                      className="h-10 rounded-lg border border-line bg-white px-3 text-[14px] text-ink focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPeople((list) => list.map((x, j) => (j === i ? { ...x, active: !x.active } : x)));
                        notify(p.active ? `${p.fullName} выключен` : `${p.fullName} снова в команде`);
                      }}
                    >
                      {p.active ? "Выключить" : "Включить"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                setPeople((list) => [...list, { slug: `new-${list.length}` as never, fullName: newName.trim(), shortName: newName.trim(), role: "LEADER", zone: "Зона не указана", direction: "department", active: true }]);
                notify(`${newName.trim()} добавлен`);
                setNewName("");
              }}
            >
              <TextInput label="Новый человек" id="new-person" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Фамилия Имя" className="sm:w-80" />
              <Button type="submit" variant="secondary">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить
              </Button>
            </form>
          </Section>

          <Section title="Пароли" description="Задаются на странице первичной настройки или командой на сервере. В интерфейсе их не видно">
            <ul className="flex flex-col gap-2 text-[15px]">
              {passwords.map((p) => (
                <li key={p.title} className="flex flex-wrap items-center gap-3">
                  <span className="w-72 text-ink">{p.title}</span>
                  <Badge tone={p.set ? "green" : "red"}>{p.set ? "Задан" : "Не задан"}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] text-muted">Это настоящее состояние паролей ресурса, не прототип. После смены общего пароля все выходят.</p>
          </Section>

          <Section title="Google-таблица" description="Куда ресурс зеркалит задачи и weekly">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="ID таблицы" id="sheet-id" defaultValue="копия Insurance&Invest Bord" hint="Прод подключается на этапе 7 с согласия Арама" />
              <TextInput label="Служебный аккаунт" id="sheet-sa" defaultValue="weekly-sync@…" readOnly hint="Редактор только этого файла" />
            </div>
          </Section>

          <Section title="Выгрузка данных" description="Второй уровень защиты вместе с историей версий таблицы">
            <Button variant="secondary" onClick={() => notify("Файл Excel готовится")}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Выгрузить всё в Excel
            </Button>
          </Section>
        </>
      ) : (
        <p className="border-t border-line pt-6 text-[14px] text-muted">Люди, роли, пароли и синхронизация открываются паролем владельца.</p>
      )}
    </div>
  );
}
