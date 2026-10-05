"use client";

import { useState } from "react";
import { usePrototype } from "@/prototype/store";
import { PEOPLE, compactName } from "@/prototype/people";
import { diffDays, formatShort } from "@/prototype/dates";
import type { JournalEvent, PersonSlug } from "@/prototype/types";
import { SelectField } from "@/components/ui/primitives";
import { EmptyState } from "@/components/empty-state";

const KINDS: { value: JournalEvent["kind"] | ""; label: string }[] = [
  { value: "", label: "Все события" },
  { value: "task", label: "Задачи" },
  { value: "comment", label: "Комментарии" },
  { value: "weekly", label: "Weekly" },
  { value: "login", label: "Входы" },
  { value: "settings", label: "Настройки" },
  { value: "sync", label: "Синхронизация" },
  { value: "system", label: "Служебные" },
];

const SOURCES: { value: JournalEvent["source"] | ""; label: string }[] = [
  { value: "", label: "Все источники" },
  { value: "app", label: "Ресурс" },
  { value: "sheet", label: "Таблица" },
  { value: "system", label: "Система" },
];

const SOURCE_WORD = { app: "ресурс", sheet: "таблица", system: "система" } as const;

/**
 * Общий журнал с фильтрами: человек, период, тип события, источник (раздел 6 ТЗ).
 * live: события из базы: задачи, weekly, входы, настройки
 */
export function JournalView({ live }: { live: JournalEvent[] }) {
  const { data } = usePrototype();
  const all = live;
  const [who, setWho] = useState<PersonSlug | "system" | "">("");
  const [period, setPeriod] = useState<"7" | "30" | "all">("30");
  const [kind, setKind] = useState<JournalEvent["kind"] | "">("");
  const [source, setSource] = useState<JournalEvent["source"] | "">("");

  const events = all.filter(
    (e) =>
      (!who || e.by === who) &&
      (period === "all" || diffDays(e.at, data.today) <= Number(period)) &&
      (!kind || e.kind === kind) &&
      (!source || e.source === source),
  );

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <SelectField
          label="Кто"
          id="j-who"
          value={who}
          onChange={(e) => setWho(e.target.value as PersonSlug | "system" | "")}
          className="sm:w-52"
          options={[{ value: "", label: "Все" }, ...PEOPLE.map((p) => ({ value: p.slug, label: p.fullName })), { value: "system", label: "Система" }]}
        />
        <SelectField
          label="Период"
          id="j-period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as "7" | "30" | "all")}
          className="sm:w-44"
          options={[
            { value: "7", label: "Неделя" },
            { value: "30", label: "Месяц" },
            { value: "all", label: "Всё время" },
          ]}
        />
        <SelectField label="Тип события" id="j-kind" value={kind} onChange={(e) => setKind(e.target.value as JournalEvent["kind"] | "")} className="sm:w-48" options={KINDS} />
        <SelectField label="Источник" id="j-source" value={source} onChange={(e) => setSource(e.target.value as JournalEvent["source"] | "")} className="sm:w-44" options={SOURCES} />
      </div>
      <p className="mt-3 text-[14px] text-muted" aria-live="polite">
        Событий: {events.length}. Журнал только дописывается: править и удалять записи нельзя. События до запуска ресурса помечены источником «таблица»: это перенос задач и weekly из Insurance&Invest Bord.
      </p>

      {events.length === 0 ? (
        <EmptyState title="Событий под эти фильтры нет" className="mt-4" />
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl ring-1 ring-line">
          <table className="hidden w-full text-left text-[14px] md:table">
            <caption className="sr-only">Журнал изменений</caption>
            <thead className="bg-surface text-[13px] text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Когда</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Кто</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Объект</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Что изменилось</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Откуда</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.slice(0, 120).map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">
                    {formatShort(e.at)}
                    {e.time ? `, ${e.time}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink">{e.by === "system" ? "Система" : compactName(e.by)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink">{e.object}</td>
                  <td className="px-3 py-3">
                    <Change e={e} />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {SOURCE_WORD[e.source]}
                    {e.ip ? <span className="block text-[12px]">{e.ip}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line md:hidden">
            {events.slice(0, 60).map((e) => (
              <li key={e.id} className="px-4 py-3 text-[14px]">
                <p className="text-[13px] text-muted">
                  {formatShort(e.at)}
                  {e.time ? `, ${e.time}` : ""}, {e.by === "system" ? "система" : compactName(e.by)}, {SOURCE_WORD[e.source]}
                </p>
                <p className="mt-0.5 font-medium text-ink">{e.object}</p>
                <Change e={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Change({ e }: { e: JournalEvent }) {
  return (
    <p className="text-ink">
      {e.field ? <span className="font-medium">{e.field}</span> : null}
      {e.before ? <span className="text-muted">{e.field ? ": " : ""}было «{e.before}»</span> : null}
      {e.after ? (
        <span>
          {e.before ? ", стало" : e.field ? ":" : ""} «{e.after}»
        </span>
      ) : null}
    </p>
  );
}
