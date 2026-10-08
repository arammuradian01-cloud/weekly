"use client";

import Link from "next/link";
import { useState } from "react";
import { ClipboardCopy, RefreshCw, Save } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { numbersText, type WeekNumbers } from "@/lib/numbers/text";
import { forecastText } from "@/lib/forecast/codes";
import type { ForecastSummary } from "@/lib/forecast/types";
import { ForecastSummaryBlock, WeekNumbersBlock } from "@/components/forecast/week-numbers";
import { directionLabel } from "@/domain/dictionaries";
import { formatLong } from "@/domain/dates";
import type { PersonSlug, WeekView } from "@/domain/types";
import { compactName } from "@/domain/people";
import { promiseShare, summaryText, type PromiseSummary } from "@/lib/weekly/promises";
import type { PromiseHistory } from "@/lib/weekly/promise-service";
import { buildCeoSections, cleanDash, type CeoSections } from "@/lib/weekly/rules";
import type { CeoReportView } from "@/lib/weekly/service";
import { saveCeoReportAction } from "@/app/(app)/weekly/actions";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/primitives";
import { WeekSwitcher } from "@/components/weekly/weekly-feed";
import { useRunWeekly } from "@/components/weekly/use-weekly";

type Promises = { people: { slug: PersonSlug; summary: PromiseSummary }[]; total: PromiseSummary; snapshotAt?: string };

/** «За 8 недель: 64%» или «статистика появится через 6 недель» */
function statsLine(h: PromiseHistory | undefined): string | null {
  if (!h) return null;
  if (!h.enabled) return `за 8 недель: появится после 6 недель с обещаниями, сейчас ${h.active}`;
  const share = promiseShare(h.total);
  return share === null ? null : `за 8 недель: ${share}%`;
}

/** «Сделано 7 из 10 (70%). Снято 1» */
function promiseLine(s: PromiseSummary): string {
  const share = promiseShare(s);
  const text = summaryText(s);
  return share === null ? text : text.replace(/^(Сделано \d+ из \d+)/, `$1 (${share}%)`);
}

type History = { key: string; number: number; flagged: number; meeting: string; savedBy?: string; savedAt?: string }[];

// В строке отчёта продукт, а не человек: CEO читает по продуктам (07.10)
const fromEntries = (view: WeekView) => buildCeoSections(view.entries, directionLabel);

function moment(iso: string): string {
  const at = new Date(iso);
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Черновик отчёта CEO (раздел 3 ТЗ): видят только владелец и администраторы, в таблицу он не выгружается */
export function CeoReport({
  view,
  saved,
  history,
  promises,
  stats,
  numbers,
  forecast,
  owner = false,
}: {
  view: WeekView;
  saved: CeoReportView;
  history: History;
  promises?: Promises;
  /** Личная статистика за 8 недель: только директору */
  stats?: PromiseHistory[];
  /** Цифры недели из недельного отчёта и прогноз лидеров (этап 24) */
  numbers?: WeekNumbers;
  forecast?: ForecastSummary;
  owner?: boolean;
}) {
  const thanks = view.reports.filter((r) => r.thanks);
  const { notify } = usePrototype();
  const run = useRunWeekly();
  const week = view.week;
  const flaggedCount = view.entries.filter((e) => e.ceo).length;
  const [sections, setSections] = useState<CeoSections>(() => saved.sections ?? fromEntries(view));
  const [dirty, setDirty] = useState(!saved.sections);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof CeoSections, value: string) => {
    setSections((s) => ({ ...s, [key]: cleanDash(value) }));
    setDirty(true);
  };

  const fullText = [
    `Отчёт за неделю ${week.number}`,
    "",
    "Цифры недели",
    ...(numbers ? numbersText(numbers) : ["Появятся после подключения недельного отчёта."]),
    "",
    ...(forecast ? ["Прогноз до конца месяца", ...forecastText(forecast), ""] : []),
    ...(promises?.total.total ? ["Обещания недели", promiseLine(promises.total), ""] : []),
    ...(thanks.length ? ["Благодарности", ...thanks.map((r) => `- ${compactName(r.author)}: ${r.thanks}`), ""] : []),
    "Главное за неделю",
    sections.main || "-",
    "",
    "Риски",
    sections.risks || "-",
    "",
    "Что дальше",
    sections.next || "-",
  ].join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      notify("Текст отчёта скопирован");
    } catch {
      notify("Не получилось скопировать: выделите текст вручную", "error");
    }
  };

  const save = async () => {
    setBusy(true);
    const result = await run(() => saveCeoReportAction(week.key, sections), `Отчёт за неделю ${week.number} сохранён`);
    setBusy(false);
    if (result) setDirty(false);
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <WeekSwitcher view={view} basePath="/ceo-report" />
          <p className="text-small text-muted" aria-live="polite">
            {dirty ? "Есть несохранённые правки" : saved.updatedAt ? `Сохранён ${moment(saved.updatedAt)}${saved.updatedBy ? `, ${saved.updatedBy}` : ""}` : ""}
          </p>
        </div>

        <div className="flex flex-col gap-3 sv-card sv-card--soft px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body text-ink">
            {flaggedCount ? `Записей с отметкой «В отчёт CEO»: ${flaggedCount}.` : "Отметок «В отчёт CEO» за эту неделю нет."} Отметки ставятся в{" "}
            <Link href={`/weekly?week=${week.key}`} className="font-medium text-blue-700 hover:underline">
              ленте weekly
            </Link>
            .
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSections(fromEntries(view));
                setDirty(true);
              }}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Собрать заново
            </Button>
            <Button size="sm" variant="secondary" onClick={copy}>
              <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
              Скопировать текст
            </Button>
            <Button size="sm" onClick={save} disabled={busy || !dirty}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {busy ? "Сохраняю…" : "Сохранить"}
            </Button>
          </div>
        </div>

        {numbers ? (
          <WeekNumbersBlock numbers={numbers} manage={owner} />
        ) : (
          <section aria-labelledby="ceo-numbers" className="sv-card sv-card--soft border border-dashed border-line px-5 py-4">
            <h2 id="ceo-numbers" className="text-title-sm font-semibold text-ink">Цифры недели</h2>
            <p className="mt-1 text-body text-muted">Появятся после подключения недельного отчёта. Руками факт никто не вводит.</p>
          </section>
        )}
        {forecast ? <ForecastSummaryBlock summary={forecast} /> : null}

        <section aria-labelledby="ceo-promises" className="sv-card sv-card--soft px-5 py-4">
          <h2 id="ceo-promises" className="text-title-sm font-semibold text-ink">Обещания недели</h2>
          {promises?.total.total ? (
            <>
              <p className="mt-1 text-body text-ink">{promiseLine(promises.total)}</p>
              <ul className="mt-3 flex flex-col gap-1">
                {promises.people.map((p) => {
                  const longer = statsLine(stats?.find((h) => h.slug === p.slug));
                  return (
                    <li key={p.slug} className="flex flex-col text-small sm:flex-row sm:gap-2">
                      <span className="font-medium text-ink sm:w-40 sm:shrink-0">{compactName(p.slug)}</span>
                      <span className="text-muted">
                        {promiseLine(p.summary)}
                        {longer ? `. ${longer.charAt(0).toUpperCase()}${longer.slice(1)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {promises.snapshotAt ? <p className="mt-3 text-caption text-muted">Снимок на момент закрытия недели, {moment(promises.snapshotAt)}: правки задач после закрытия его не меняют.</p> : null}
              <p className="mt-3 text-caption text-muted">
                Планы из прошлого weekly и задачи со сроком на этой неделе. Итог плана ставит лидер при сдаче weekly, итог задачи это её статус. Доля считается от обещаний с итогом, снятые не считаются.
              </p>
            </>
          ) : (
            <p className="mt-1 text-body text-muted">Обещаний на эту неделю не было: в прошлом weekly нет планов, задач со сроком на неделе нет.</p>
          )}
        </section>

        {thanks.length ? (
          <section aria-labelledby="ceo-thanks" className="sv-card sv-card--soft px-5 py-4">
            <h2 id="ceo-thanks" className="text-title-sm font-semibold text-ink">Благодарности</h2>
            <ul className="mt-2 flex flex-col gap-1">
              {thanks.map((r) => (
                <li key={r.author} className="flex flex-col text-small sm:flex-row sm:gap-2">
                  <span className="font-medium text-ink sm:w-40 sm:shrink-0">{compactName(r.author)}</span>
                  <span className="text-ink">{r.thanks}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <TextArea label="Главное за неделю" id="ceo-main" value={sections.main} onChange={(e) => set("main", e.target.value)} rows={6} hint="Пишите от первого лица. Длинное тире и стрелки заменяются на дефис сами" />
        <TextArea label="Риски" id="ceo-risks" value={sections.risks} onChange={(e) => set("risks", e.target.value)} rows={4} />
        <TextArea label="Что дальше" id="ceo-next" value={sections.next} onChange={(e) => set("next", e.target.value)} rows={4} />
      </div>

      <aside aria-labelledby="ceo-history">
        <h2 id="ceo-history" className="mb-3 text-title-sm font-semibold text-ink">История отчётов</h2>
        {history.length === 0 ? (
          <p className="text-small text-muted">Пока ни одного отчёта.</p>
        ) : (
          <ul className="divide-y divide-line sv-card sv-card--soft">
            {history.map((h) => (
              <li key={h.key}>
                <Link href={`/ceo-report?week=${h.key}`} aria-current={h.key === week.key ? "page" : undefined} className="block px-4 py-3 hover:bg-field aria-[current=page]:bg-field">
                  <p className="text-body font-medium text-ink">Неделя {h.number}</p>
                  <p className="text-caption text-muted">
                    {h.savedAt ? `Сохранён ${moment(h.savedAt)}${h.savedBy ? `, ${h.savedBy}` : ""}` : "Не сохранялся"}. Отметок: {h.flagged}, встреча {h.meeting}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-caption text-muted">Отчёт видят только владелец и администраторы. В Google-таблицу он не выгружается. Встреча недели {week.number}: {formatLong(week.meetingDate)}.</p>
      </aside>
    </div>
  );
}
