"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { compactName } from "@/domain/people";
import { formatShort } from "@/domain/dates";
import type { JournalEvent } from "@/domain/types";
import type { JournalPage, JournalQuery } from "@/lib/journal";
import { SelectField } from "@/components/ui/primitives";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/cn";

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

/** Как вошёл автор: при общем логине имя выбрано из списка, а не подтверждено */
const VIA_WORD: Record<NonNullable<JournalEvent["via"]>, string> = { personal: "личный вход", team: "общий логин" };

const SOURCE_WORD = { app: "ресурс", sheet: "таблица", system: "система" } as const;

const plural = (n: number) => {
  const d = n % 10;
  const t = n % 100;
  return d === 1 && t !== 11 ? "событие" : d >= 2 && d <= 4 && (t < 12 || t > 14) ? "события" : "событий";
};

/**
 * Общий журнал с фильтрами: человек, период, тип события, источник (раздел 6 ТЗ).
 * Фильтры записываются в адрес, выборку собирает сервер; «Показать ещё» добавляет следующую сотню
 */
export function JournalView({ page, people, query }: { page: JournalPage; people: { slug: string; fullName: string; active: boolean }[]; query: JournalQuery }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const { events, total } = page;
  const nameOf = (slug: string) => (slug === "system" ? "Система" : people.some((p) => p.slug === slug) ? compactName(slug) : slug);

  const href = (patch: Partial<JournalQuery>) => {
    const next = { ...query, ...patch };
    const sp = new URLSearchParams();
    if (next.who) sp.set("who", next.who);
    if (next.period !== "30") sp.set("period", next.period);
    if (next.kind) sp.set("kind", next.kind);
    if (next.source) sp.set("source", next.source);
    if (next.n > 100) sp.set("n", String(next.n));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  // Новый фильтр начинает выборку с первой сотни
  const go = (patch: Partial<JournalQuery>) => start(() => router.replace(href({ n: 100, ...patch }), { scroll: false }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <SelectField
          label="Кто"
          id="j-who"
          value={query.who}
          onChange={(e) => go({ who: e.target.value })}
          className="sm:w-52"
          options={[
            { value: "", label: "Все" },
            ...people.map((p) => ({ value: p.slug, label: p.active ? p.fullName : `${p.fullName} (выключен)` })),
            { value: "system", label: "Система" },
          ]}
        />
        <SelectField
          label="Период"
          id="j-period"
          value={query.period}
          onChange={(e) => go({ period: e.target.value as JournalQuery["period"] })}
          className="sm:w-44"
          options={[
            { value: "7", label: "Неделя" },
            { value: "30", label: "Месяц" },
            { value: "all", label: "Всё время" },
          ]}
        />
        <SelectField label="Тип события" id="j-kind" value={query.kind} onChange={(e) => go({ kind: e.target.value as JournalQuery["kind"] })} className="sm:w-48" options={KINDS} />
        <SelectField label="Источник" id="j-source" value={query.source} onChange={(e) => go({ source: e.target.value as JournalQuery["source"] })} className="sm:w-44" options={SOURCES} />
      </div>
      <p className={cn("mt-3 text-small text-muted transition-opacity", pending && "opacity-60")} aria-live="polite">
        {total ? `${total} ${plural(total)}${total > events.length ? `, показаны последние ${events.length}` : ""}.` : ""} Журнал только дописывается: править и удалять записи нельзя. События с источником «таблица» это перенос задач и weekly из Insurance&Invest Bord.
      </p>

      {events.length === 0 ? (
        <EmptyState title="Событий под эти фильтры нет" className="mt-4" />
      ) : (
        <div className={cn("mt-4 overflow-hidden rounded-xl ring-1 ring-line transition-opacity", pending && "opacity-60")}>
          <table className="hidden w-full text-left text-small md:table">
            <caption className="sr-only">Журнал изменений</caption>
            <thead className="bg-surface text-caption text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Когда</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Кто</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Объект</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Что изменилось</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Откуда</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">
                    {formatShort(e.at)}
                    {e.time ? `, ${e.time}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink">
                    {nameOf(e.by)}
                    {e.via ? <span className="block text-tiny text-muted">{VIA_WORD[e.via]}</span> : null}
                  </td>
                  <td className="px-3 py-3 text-ink">
                    <ObjectLabel e={e} />
                  </td>
                  <td className="px-3 py-3">
                    <Change e={e} />
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {SOURCE_WORD[e.source]}
                    {e.ip ? <span className="block text-tiny">{e.ip}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-line md:hidden">
            {events.map((e) => (
              <li key={e.id} className="px-4 py-3 text-small">
                <p className="text-caption text-muted">
                  {formatShort(e.at)}
                  {e.time ? `, ${e.time}` : ""}, {e.by === "system" ? "система" : nameOf(e.by)}
                  {e.via ? ` (${VIA_WORD[e.via]})` : ""}, {SOURCE_WORD[e.source]}
                </p>
                <p className="mt-0.5 font-medium text-ink">
                  <ObjectLabel e={e} />
                </p>
                <Change e={e} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {total > events.length ? (
        <div className="mt-4">
          <Link href={href({ n: query.n + 100 })} scroll={false} replace className={buttonClass("secondary")}>
            Показать ещё {Math.min(100, total - events.length)}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Задача открывается по ссылке прямо из журнала */
function ObjectLabel({ e }: { e: JournalEvent }) {
  const m = /^Задача (\d+)$/.exec(e.object);
  if (m) {
    return (
      <Link href={`/tasks?task=${m[1]}`} className="text-blue-700 hover:underline">
        {e.object}
      </Link>
    );
  }
  return <>{e.object}</>;
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
