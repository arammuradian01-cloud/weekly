"use client";

// Мой прогноз до конца месяца (этап 24): строки по линиям и метрикам за неделю, бюджет, прогноз, причина
// отклонения, комментарий. Строки прошлой недели подставляются черновиком, чтобы обновить за минуту

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { dictOptions } from "@/domain/dictionaries";
import type { MyForecast, ForecastLineInput, ForecastLineView } from "@/lib/forecast/types";
import { FORECAST_METRICS, FORECAST_REASONS, addMonths, formatForecast, formatPct, deltaPct, monthLabel, reasonNeeded, type ForecastMetricCode, type ForecastReasonCode } from "@/lib/forecast/codes";
import { saveForecastAction } from "@/app/(app)/forecast/actions";
import { Button } from "@/components/ui/button";
import { SelectField, TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Row = { uid: string; direction: string; metric: ForecastMetricCode; month: string; budget: string; forecast: string; reason: ForecastReasonCode | ""; comment: string; previous: ForecastLineView["previous"]; unit: "mln" | "count"; fromCarry: boolean };

let uid = 0;
const nextUid = () => `r${++uid}`;

const num = (s: string): number | null => {
  const t = s.replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function toRow(l: ForecastLineView, fromCarry: boolean): Row {
  return { uid: nextUid(), direction: l.direction, metric: l.metric, month: l.month, budget: l.budget === null ? "" : String(l.budget), forecast: fromCarry ? String(l.forecast) : String(l.forecast), reason: l.reason ?? "", comment: fromCarry ? "" : (l.comment ?? ""), previous: l.previous, unit: l.unit, fromCarry };
}

export function ForecastForm({ initial }: { initial: MyForecast }) {
  const router = useRouter();
  const { me, notify, manage, observer } = usePrototype();
  const [rows, setRows] = useState<Row[]>(() => [...initial.lines.map((l) => toRow(l, false)), ...initial.carry.map((l) => toRow(l, true))]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const months = [addMonths(initial.month, -1), initial.month, addMonths(initial.month, 1), addMonths(initial.month, 2), addMonths(initial.month, 3)];
  const readOnly = observer || (initial.closed && !manage);
  const directions = dictOptions("DIRECTION");

  const update = (id: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.uid === id ? { ...r, ...patch } : r)));
  const add = () =>
    setRows((prev) => [
      ...prev,
      { uid: nextUid(), direction: me.direction ?? directions[0]?.value ?? "", metric: "revenue", month: initial.month, budget: "", forecast: "", reason: "", comment: "", previous: null, unit: "mln", fromCarry: false },
    ]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const lines: ForecastLineInput[] = [];
    for (const r of rows) {
      const forecast = num(r.forecast);
      if (forecast === null) return setError(`${directions.find((d) => d.value === r.direction)?.label ?? r.direction}, ${FORECAST_METRICS.find((m) => m.code === r.metric)?.label.toLowerCase()}: укажите прогноз числом`);
      const budget = num(r.budget);
      if (!r.reason && reasonNeeded(forecast, budget)) return setError(`${directions.find((d) => d.value === r.direction)?.label ?? r.direction}: прогноз отличается от бюджета, назовите, что поехало`);
      lines.push({ direction: r.direction, metric: r.metric, month: r.month, budget, forecast, reason: r.reason || null, comment: r.comment.trim() || null });
    }
    setBusy(true);
    try {
      const res = await saveForecastAction(initial.week, lines);
      if (!res.ok) return setError(res.error);
      setRows([...res.value.lines.map((l) => toRow(l, false)), ...res.value.carry.map((l) => toRow(l, true))]);
      setSaved(new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }));
      notify(`Прогноз за неделю ${initial.weekNumber} сохранён`);
      router.refresh();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="my-forecast" className="rounded-xl px-5 py-5 ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-forecast" className="text-title-sm font-semibold text-ink">
          Мой прогноз, неделя {initial.weekNumber}
        </h2>
        <p className="text-caption text-muted">{initial.closed ? "Неделя закрыта" : initial.lines.length ? "Обновлён на этой неделе" : "На этой неделе ещё не обновлён"}</p>
      </div>
      <p className="mt-1 text-body text-muted">
        Раз в неделю: по каждой линии и метрике прогноз до конца месяца, бюджет из LRF и причина, если прогноз от бюджета отличается. Строки с прошлой недели уже подставлены, поправьте цифры.
      </p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        {rows.length === 0 ? <p className="rounded-lg bg-field px-4 py-3 text-body text-muted">Строк пока нет. Добавьте линию: направление, метрику и месяц.</p> : null}
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => {
            const forecast = num(r.forecast);
            const budget = num(r.budget);
            const toBudget = deltaPct(forecast, budget);
            const toPrev = r.previous ? deltaPct(forecast, r.previous.forecast) : null;
            const unit = FORECAST_METRICS.find((m) => m.code === r.metric)?.unit ?? "mln";
            return (
              <li key={r.uid} className={cn("rounded-xl p-3 ring-1 ring-line", r.fromCarry && "bg-blue-soft/40")}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.2fr_1fr_1fr_1fr_1.2fr_auto]">
                  <SelectField label="Направление" id={`fc-dir-${i}`} value={r.direction} onChange={(e) => update(r.uid, { direction: e.target.value })} options={dictOptions("DIRECTION", r.direction)} disabled={readOnly} />
                  <SelectField label="Метрика" id={`fc-metric-${i}`} value={r.metric} onChange={(e) => update(r.uid, { metric: e.target.value as ForecastMetricCode })} options={FORECAST_METRICS.map((m) => ({ value: m.code, label: m.label }))} disabled={readOnly} />
                  <SelectField label="Месяц" id={`fc-month-${i}`} value={r.month} onChange={(e) => update(r.uid, { month: e.target.value })} options={months.map((m) => ({ value: m, label: monthLabel(m) }))} disabled={readOnly} />
                  <TextInput label={`Бюджет${unit === "mln" ? ", млн" : ", шт."}`} id={`fc-budget-${i}`} value={r.budget} onChange={(e) => update(r.uid, { budget: e.target.value })} inputMode="decimal" placeholder="из LRF" disabled={readOnly} />
                  <TextInput label={`Прогноз${unit === "mln" ? ", млн" : ", шт."}`} id={`fc-forecast-${i}`} value={r.forecast} onChange={(e) => update(r.uid, { forecast: e.target.value })} inputMode="decimal" disabled={readOnly} />
                  <SelectField label="Что поехало" id={`fc-reason-${i}`} value={r.reason} onChange={(e) => update(r.uid, { reason: e.target.value as ForecastReasonCode | "" })} options={[{ value: "", label: reasonNeeded(forecast ?? 0, budget) ? "Выберите причину" : "В бюджете" }, ...FORECAST_REASONS.map((x) => ({ value: x.code, label: x.label }))]} disabled={readOnly} />
                  {!readOnly ? (
                    <div className="flex items-end">
                      <button type="button" onClick={() => setRows((prev) => prev.filter((x) => x.uid !== r.uid))} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted hover:bg-field hover:text-ink" aria-label={`Убрать строку ${i + 1}`}>
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-end">
                  <TextInput label="Комментарий" hideLabel id={`fc-comment-${i}`} value={r.comment} onChange={(e) => update(r.uid, { comment: e.target.value })} placeholder="Одной фразой: что произошло и что делаем" maxLength={500} className="min-w-0 flex-1" disabled={readOnly} />
                  <p className="flex flex-wrap gap-x-4 text-caption text-muted lg:pb-3">
                    {toBudget !== null ? <span className={cn("tabular-nums", toBudget < -2 ? "text-danger-ink" : toBudget > 2 ? "text-green-ink" : "")}>к бюджету {formatPct(toBudget)}</span> : null}
                    {r.previous ? <span className="tabular-nums">прошлый прогноз {formatForecast(r.previous.forecast, unit)} (нед. {r.previous.weekNumber}){toPrev !== null && Math.abs(toPrev) >= 0.05 ? `, ${formatPct(toPrev)}` : ""}</span> : null}
                    {r.fromCarry ? <span>перенесено с прошлой недели</span> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
        <FormError message={error ?? undefined} />
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={add}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Добавить линию
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить прогноз"}
            </Button>
            {saved ? <span className="text-caption text-muted">Сохранено в {saved}</span> : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
