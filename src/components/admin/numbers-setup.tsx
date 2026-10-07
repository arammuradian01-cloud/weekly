"use client";

// Цифры недели (этап 24): владелец подключает недельный отчёт Weekly Sravni только на чтение, выбирает строки отчёта,
// которые ресурс показывает как «Цифры недели», и даёт им подписи

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, ExternalLink, Search, TriangleAlert, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { SelectField, TextInput } from "@/components/ui/primitives";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";
import type { Metric, ReportRowView } from "@/lib/numbers/service";
import { formatValue } from "@/lib/numbers/parse";
import { pullNumbersNowAction, searchReportRowsAction, setMetricsAction, setNumbersSourceAction } from "@/app/(app)/sync/actions";

export type NumbersView = {
  sourceId: string | null;
  tab: string;
  connected: boolean;
  hasKey: boolean;
  serviceEmail: string | null;
  lastOk: { ago: string; at: string } | null;
  next: string | null;
  error: { at: string; message: string } | null;
  rows: number;
  weeks: number;
  latestWeek: string | null;
  metrics: Metric[];
  metricsMax: number;
};

const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
const UNIT_OPTIONS = [
  { value: "count", label: "Штуки" },
  { value: "mln", label: "Млн руб" },
  { value: "pct", label: "Проценты" },
];

export function NumbersSetup({ view }: { view: NumbersView }) {
  const run = useRunAction();
  const { notify } = usePrototype();
  const [link, setLink] = useState(view.sourceId ? sheetUrl(view.sourceId) : "");
  const [tab, setTab] = useState(view.tab);
  const [busy, setBusy] = useState<"save" | "pull" | "metrics" | null>(null);
  const [metrics, setMetrics] = useState<Metric[]>(view.metrics);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ReportRowView[] | null>(null);
  const seq = useRef(0);
  const changed = link.trim() !== (view.sourceId ? sheetUrl(view.sourceId) : "") || tab.trim() !== view.tab;
  const metricsChanged = JSON.stringify(metrics) !== JSON.stringify(view.metrics);

  useEffect(() => setMetrics(view.metrics), [view.metrics]);

  // Поиск строк отчёта по мере набора
  useEffect(() => {
    if (!view.connected || !view.rows) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchReportRowsAction(query);
      if (my === seq.current && r.ok) setFound(r.value);
    }, 250);
    return () => clearTimeout(t);
  }, [query, view.connected, view.rows]);

  async function save() {
    setBusy("save");
    try {
      const res = await run(() => setNumbersSourceAction(link, tab));
      if (!res) return;
      if (!res.id) notify("Чтение недельного отчёта выключено");
      else if (res.access === "ok") notify("Отчёт подключён и прочитан. Дальше он перечитывается раз в час");
      else if (res.access === "no-key") notify("Ссылка сохранена. Чтение начнётся, когда на сервере появится ключ служебного аккаунта");
      else notify(`Ссылка сохранена, но ${res.access.charAt(0).toLowerCase()}${res.access.slice(1)}`, "error");
      setLink(res.id ? sheetUrl(res.id) : "");
      setTab(res.tab);
    } finally {
      setBusy(null);
    }
  }

  async function pull() {
    setBusy("pull");
    try {
      const res = await run(pullNumbersNowAction);
      if (res) notify(`Отчёт прочитан: строк ${res.rows}, недель ${res.weeks}`);
    } finally {
      setBusy(null);
    }
  }

  async function saveMetrics() {
    setBusy("metrics");
    try {
      const res = await run(() => setMetricsAction(metrics));
      if (res) notify(`Цифры недели: ${res.length}`);
    } finally {
      setBusy(null);
    }
  }

  const toggle = (row: ReportRowView) => {
    setMetrics((prev) => (prev.some((m) => m.key === row.key) ? prev.filter((m) => m.key !== row.key) : prev.length >= view.metricsMax ? prev : [...prev, { key: row.key, label: row.label, unit: row.unit }]));
  };
  const update = (key: string, patch: Partial<Metric>) => setMetrics((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  const move = (key: string, dir: -1 | 1) =>
    setMetrics((prev) => {
      const i = prev.findIndex((m) => m.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  return (
    <section aria-labelledby="numbers-setup" className="flex flex-col gap-5">
      <div>
        <h2 id="numbers-setup" className="text-title font-semibold text-ink">
          Цифры недели из недельного отчёта
        </h2>
        <p className="mt-1 max-w-[760px] text-body text-ink">
          Ресурс раз в час читает вкладку «{view.tab}» недельного отчёта и показывает выбранные строки в отчёте CEO, на встрече и на странице прогноза. Руками факт никто не вводит: нет цифры в отчёте, нет её и здесь.
        </p>
      </div>

      {view.connected ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className={cn("rounded-xl px-5 py-4", view.error ? "bg-warning-soft" : "bg-green-soft")}>
            <p className={cn("inline-flex items-center gap-2 text-small font-medium", view.error ? "text-warning-ink" : "text-green-ink")}>
              {view.error ? <TriangleAlert className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              Последнее чтение
            </p>
            <p className="mt-1 text-headline-lg font-semibold tabular-nums text-ink">{view.lastOk ? view.lastOk.ago : "ещё не было"}</p>
            <p className="text-caption text-muted">{view.lastOk ? view.lastOk.at : ""}</p>
          </div>
          <div className="rounded-xl bg-surface px-5 py-4">
            <p className="text-small font-medium text-muted">В отчёте</p>
            <p className="mt-1 text-headline-lg font-semibold tabular-nums text-ink">{view.rows}</p>
            <p className="text-caption text-muted">строк с цифрами, недель {view.weeks}</p>
          </div>
          <div className="rounded-xl bg-surface px-5 py-4">
            <p className="text-small font-medium text-muted">Последняя неделя в отчёте</p>
            <p className="mt-1 text-headline-sm font-semibold leading-tight text-ink">{view.latestWeek ? `с ${view.latestWeek}` : "нет"}</p>
            <p className="mt-1 text-caption text-muted">Следующее чтение: {view.next ?? "выключено"}</p>
          </div>
        </div>
      ) : null}

      {view.error ? (
        <div role="alert" className="flex gap-3 rounded-xl bg-danger-soft px-5 py-4 text-body text-ink">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger-ink" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-danger-ink">Чтение не прошло {view.error.at}</p>
            <p className="mt-0.5 break-words">{view.error.message}</p>
            <p className="mt-1 text-small text-muted">Прошлый снимок остался. Повтор через 15 минут.</p>
          </div>
        </div>
      ) : null}

      {view.connected ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy !== null} onClick={() => void pull()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {busy === "pull" ? "Читаем…" : "Прочитать сейчас"}
          </Button>
        </div>
      ) : null}

      {view.connected && view.rows ? (
        <div className="rounded-xl px-5 py-5 ring-1 ring-line">
          <h3 className="text-title-sm font-semibold text-ink">Какие цифры показывать</h3>
          <p className="mt-1 text-body text-muted">Отметьте строки отчёта, до {view.metricsMax}. Подпись и единицу можно поправить. Порядок как здесь.</p>
          {metrics.length ? (
            <ol className="mt-4 flex flex-col gap-2" aria-label="Выбранные цифры">
              {metrics.map((m, i) => (
                <li key={m.key} className="flex flex-col gap-2 rounded-lg bg-surface p-3 sm:flex-row sm:items-end">
                  <TextInput label={`Подпись ${i + 1}`} hideLabel id={`metric-label-${i}`} value={m.label} onChange={(e) => update(m.key, { label: e.target.value })} maxLength={80} className="min-w-0 flex-1" />
                  <SelectField label="Единица" id={`metric-unit-${i}`} value={m.unit} onChange={(e) => update(m.key, { unit: e.target.value as Metric["unit"] })} options={UNIT_OPTIONS} className="sm:w-40" />
                  <div className="flex items-center gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={() => move(m.key, -1)} disabled={i === 0} aria-label={`Выше: ${m.label}`}>↑</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => move(m.key, 1)} disabled={i === metrics.length - 1} aria-label={`Ниже: ${m.label}`}>↓</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setMetrics((prev) => prev.filter((x) => x.key !== m.key))} aria-label={`Убрать: ${m.label}`}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-body text-muted">Пока ничего не выбрано.</p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => void saveMetrics()} disabled={busy !== null || !metricsChanged}>
              {busy === "metrics" ? "Сохраняю…" : "Сохранить цифры"}
            </Button>
            {metricsChanged ? <span className="text-small text-muted">Есть несохранённые изменения</span> : null}
          </div>

          <div className="mt-6">
            <div className="relative max-w-[480px]">
              <label htmlFor="numbers-search" className="sr-only">
                Найти строку отчёта
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input id="numbers-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти строку отчёта: OSAGO, REVENUE, Deposits" className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-body text-ink placeholder:text-muted/80 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25" />
            </div>
            {found ? (
              <ul className="mt-3 max-h-[360px] divide-y divide-line overflow-y-auto rounded-lg ring-1 ring-line" aria-label="Строки отчёта">
                {found.map((row) => {
                  const on = metrics.some((m) => m.key === row.key);
                  return (
                    <li key={row.key} className="flex items-center gap-3 bg-white px-3 py-2">
                      <input type="checkbox" id={`row-${row.key}`} checked={on} onChange={() => toggle(row)} className="h-4 w-4 accent-blue-700" />
                      <label htmlFor={`row-${row.key}`} className="min-w-0 flex-1 cursor-pointer text-small text-ink">
                        <span className="block truncate">{row.label}</span>
                        <span className="text-caption text-muted">{row.latest !== null ? `${formatValue(row.latest, row.unit)}, неделя с ${row.latestWeek}` : "без цифр"}</span>
                      </label>
                    </li>
                  );
                })}
                {!found.length ? <li className="px-3 py-3 text-small text-muted">Ничего не нашлось</li> : null}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl px-5 py-5 ring-1 ring-line">
        <h3 className="text-title-sm font-semibold text-ink">Подключение недельного отчёта</h3>
        {!view.connected ? (
          <ol className="mt-3 flex list-decimal flex-col gap-1.5 pl-5 text-body text-ink marker:text-muted">
            <li>В файле отчёта: «Настройки доступа», добавить адрес служебного аккаунта, право «Читатель»</li>
            <li>Вставить ссылку на отчёт и название вкладки с недельными цифрами, сохранить. Отчёт прочитается сразу</li>
          </ol>
        ) : null}
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-body sm:grid-cols-[200px_1fr]">
          <dt className="text-muted">Адрес служебного аккаунта</dt>
          <dd className="min-w-0">{view.serviceEmail ? <code className="min-w-0 break-all rounded bg-surface px-1.5 py-0.5 text-small text-ink">{view.serviceEmail}</code> : <span className="text-warning-ink">появится, когда на сервере задан ключ</span>}</dd>
          <dt className="text-muted">Отчёт</dt>
          <dd className="min-w-0">
            {view.sourceId ? (
              <a href={sheetUrl(view.sourceId)} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 break-all text-blue-700 underline-offset-2 hover:underline">
                <span className="min-w-0 break-all">{view.sourceId}</span>
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
              </a>
            ) : (
              <span className="text-muted">чтение выключено</span>
            )}
          </dd>
        </dl>
        <form
          aria-label="Ссылка на недельный отчёт"
          className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextInput label="Ссылка на недельный отчёт" id="numbers-link" className="min-w-0 flex-1" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" hint="Только чтение. Пустая ссылка выключает цифры недели" autoComplete="off" spellCheck={false} />
          <TextInput label="Вкладка" id="numbers-tab" className="lg:w-44" value={tab} onChange={(e) => setTab(e.target.value)} maxLength={100} />
          <Button type="submit" disabled={busy !== null || !changed}>
            {busy === "save" ? "Сохраняю…" : "Сохранить"}
          </Button>
        </form>
      </div>
    </section>
  );
}
