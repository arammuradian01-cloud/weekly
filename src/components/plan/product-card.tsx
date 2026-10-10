"use client";

// Карточка продукта в прогнозе месяца (этап 32): драйверы и результат в одной таблице. У драйвера кнопка «Изменить»:
// новое значение, причина и обоснование, а под формой сразу видно, как поменяются продажи, выручка и маржа продукта и
// итог по продуктам. Сохраняет сервер, он же проверяет права, границы значения и что цифру не поменяли за это время

import { useMemo, useState } from "react";
import { usePrototype } from "@/domain/store";
import { adjustPlanAction, checkPlanAction } from "@/app/(app)/forecast/actions";
import { FORECAST_REASONS, type ForecastReasonCode } from "@/lib/forecast/codes";
import { derive } from "@/lib/plan/model";
import { formatPlan, inputValue, parsePlanInput, unitLabel } from "@/lib/plan/format";
import { UNITS, driverHint, metricLabel, productOf, type MetricKey } from "@/lib/plan/spec";
import { summarize, summarizeProduct, type PlanInput, type PlanSummary, type ProductSummary } from "@/lib/plan/summary";
import type { MonthPlanView, PlanProductData, ReviewView } from "@/lib/plan/types";
import { Button } from "@/components/ui/button";
import { Delta, Module } from "@/components/ui/data";
import { FormError } from "@/components/ui/field";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { betterOf, defaultReason, delta, shortName, when } from "./plan-ui";
import { PlanFacts } from "./plan-facts";

const COMMENT_MAX = 300;

type Props = {
  month: string;
  product: PlanProductData;
  summary: ProductSummary;
  input: PlanInput;
  total: PlanSummary["total"];
  canOwners: boolean;
  adjustHint: string | null;
  onSaved: (view: MonthPlanView) => void;
  onOwners: () => void;
  /** Партнёрский канал продукта (этап 35б): изменение полисов партнёров к LBE. null: партнёров у продукта нет */
  partner?: { delta: number } | null;
};

type Preset = { text: string; reason: ForecastReasonCode; comment: string };

/** Проверка после загрузки LBE словами: «ждёт проверки», «скорректирован: Головкин В., 6 октября в 10:20» */
export function reviewText(review: ReviewView | null): string {
  if (!review) return "нет данных о загрузке LBE";
  if (review.state === "waiting") return `ждёт проверки после загрузки LBE ${when(review.since)}`;
  return `${review.state === "adjusted" ? "скорректирован" : "проверен без корректировок"}: ${shortName(review.by ?? "")}, ${when(review.at!)}`;
}

export function ProductCard({ month, product, summary, input, total, canOwners, adjustHint, onSaved, onOwners, partner }: Props) {
  const spec = productOf(product.code)!;
  const [editing, setEditing] = useState<MetricKey | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const { notify } = usePrototype();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    const r = await checkPlanAction(month, product.code);
    setChecking(false);
    if (!r.ok) return notify(r.error, "error");
    notify(`${spec.label}: прогноз отмечен проверенным`);
    onSaved(r.value);
  };
  const L = useMemo(() => derive(product.lbe), [product.lbe]);
  const drivers = summary.rows.filter((r) => r.kind === "driver");
  const results = summary.rows.filter((r) => r.kind === "result");
  const owners = product.owners.map((o) => o.name).join(", ") || "не назначена";
  const model = spec.model === "funnel" ? "продажи B2C из трафика и конверсии, к ним B2B, выручка от продаж из продаж и выручки на продажу" : "выручка от продаж из объёма продаж и выручки на продажу";

  const row = (r: ProductSummary["rows"][number]) => {
    const unit = UNITS[r.key];
    const last = product.last[r.key];
    const isEditing = editing === r.key;
    const label = metricLabel(spec, r.key);
    return [
      <tr key={r.key} className={cn(r.adjusted && "sv-datatable__row--changed", isEditing && "sv-datatable__row--edit")} data-testid={`plan-row-${r.key}`}>
        <td className="is-wide">
          <div className="sv-datatable__name">
            <span className={cn(r.kind === "result" && "sv-datatable__strong")}>
              {label}
              {r.adjusted ? <span className="sr-only">, скорректировано</span> : null}
            </span>
            {r.kind === "driver" ? <span className="sv-datatable__hint max-sm:hidden">{driverHint(spec, r.key)}</span> : null}
            {r.kind === "driver" && last ? (
              <span className="sv-note" data-testid={`plan-note-${r.key}`}>
                <span className="sv-note__who">{last.value === null ? "Возврат к LBE" : "Корректировка"}: {shortName(last.author.name)}</span>
                <span>{when(last.at)}</span>
                <span>
                  {last.reasonLabel}: {last.comment}
                </span>
              </span>
            ) : null}
          </div>
        </td>
        <td className="is-num" data-label="Бюджет">
          {formatPlan(r.budget, unit)}
        </td>
        <td className="is-num" data-label="LBE">
          {formatPlan(r.lbe, unit)}
        </td>
        <td className="is-num" data-label="Прогноз">
          <span className={cn((r.adjusted || (r.kind === "result" && r.forecast !== r.lbe)) && "sv-datatable__strong")}>{formatPlan(r.forecast, unit)}</span>
        </td>
        <td className="is-num" data-label="К LBE">
          <Delta value={delta(r.forecast, r.lbe, unit)} better={betterOf(r.key)} label={`${label} к LBE`} />
        </td>
        <td className="is-num" data-label="К бюджету">
          <Delta value={delta(r.forecast, r.budget, unit)} better={betterOf(r.key)} label={`${label} к бюджету`} />
        </td>
        <td className="is-num is-action">
          {r.kind === "driver" && product.canAdjust && !isEditing ? (
            <Button
              variant="soft"
              size="sm"
              onClick={() => {
                setPreset(null);
                setEditing(r.key);
              }}
              aria-label={`Изменить: ${label}`}
              data-testid={`plan-edit-${r.key}`}
            >
              Изменить
            </Button>
          ) : null}
        </td>
      </tr>,
      isEditing ? (
        <tr key={`${r.key}-edit`} className="sv-datatable__row--edit">
          <td colSpan={7} className="is-wide">
            <DriverEditor
              key={preset?.text ?? "plain"}
              month={month}
              product={product}
              metric={r.key}
              lbeValue={L[r.key] ?? null}
              current={r.forecast}
              input={input}
              total={total}
              summary={summary}
              preset={preset}
              onCancel={() => setEditing(null)}
              onSaved={(view) => {
                setEditing(null);
                onSaved(view);
              }}
            />
          </td>
        </tr>
      ) : null,
    ];
  };

  return (
    <Module
      id={`plan-product-${product.code}`}
      title={spec.label}
      description={product.canAdjust ? "Меняйте драйверы: выручка и маржа пересчитаются сами. Каждая корректировка с причиной и обоснованием видна всей команде." : (adjustHint ?? `Прогноз продукта корректирует его команда: ${owners}.`)}
      actions={
        product.canAdjust && product.review?.state === "waiting" ? (
          <>
            <Button size="sm" onClick={() => void check()} loading={checking} disabled={checking} data-testid="plan-check">
              Прогноз проверен
            </Button>
            {canOwners ? (
              <Button variant="secondary" size="sm" onClick={onOwners} data-testid="plan-owners-open">
                Команда продукта
              </Button>
            ) : null}
          </>
        ) : canOwners ? (
          <Button variant="secondary" size="sm" onClick={onOwners} data-testid="plan-owners-open">
            Команда продукта
          </Button>
        ) : null
      }
      params={[
        { label: "Команда", value: owners },
        { label: "Модель", value: model },
        { label: "Корректировок", value: String(summary.adjusted) },
        { label: "После LBE", value: <span data-testid="plan-review">{reviewText(product.review)}</span> },
      ]}
      flush
    >
      {partner ? <PartnerBand partner={partner} product={product} summary={summary} onApply={(p) => (setPreset(p), setEditing("unitsB2b"))} /> : null}
      {product.facts ? (
        <div className="border-b border-border px-5 py-4">
          <PlanFacts month={month} facts={product.facts} summary={summary} label={spec.label} />
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="sv-datatable sv-datatable--stack" data-testid="plan-product-table">
          <caption className="sr-only">
            {spec.label}: драйверы и результат, бюджет, LBE и прогноз
          </caption>
          <thead>
            <tr>
              <th scope="col">Показатель</th>
              <th scope="col" className="is-num">
                Бюджет
              </th>
              <th scope="col" className="is-num">
                LBE
              </th>
              <th scope="col" className="is-num">
                Прогноз
              </th>
              <th scope="col" className="is-num">
                К LBE
              </th>
              <th scope="col" className="is-num">
                К бюджету
              </th>
              <th scope="col">
                <span className="sr-only">Действия</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="sv-datatable__section">
              <td colSpan={7}>Драйверы: меняет команда продукта</td>
            </tr>
            {drivers.flatMap(row)}
            <tr className="sv-datatable__section">
              <td colSpan={7}>Результат: пересчитывается от драйверов</td>
            </tr>
            {results.flatMap(row)}
          </tbody>
        </table>
      </div>
    </Module>
  );
}

/**
 * Партнёрский канал продукта (этап 35б): насколько полисы партнёров по прогнозу отличаются от LBE и учтено ли это в
 * полисах B2B продукта. Учитывает команда продукта сама: кнопка открывает обычную корректировку с подставленным значением
 */
function PartnerBand({ partner, product, summary, onApply }: { partner: { delta: number }; product: PlanProductData; summary: ProductSummary; onApply: (preset: Preset) => void }) {
  const row = summary.rows.find((r) => r.key === "unitsB2b" && r.kind === "driver");
  const d = Math.round(partner.delta);
  if (!row || row.lbe === null) return null;
  const proposed = row.lbe + d;
  const done = row.forecast !== null && Math.abs(row.forecast - proposed) < 0.5;
  const shift = formatPlan(Math.abs(d), "count");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 text-body" data-testid="plan-partner-band">
      <p className="min-w-0 text-text-secondary">
        Партнёрский канал: {d === 0 ? "полисы партнёров по прогнозу как в LBE." : `полисы партнёров по прогнозу ${d > 0 ? "больше" : "меньше"} LBE на ${shift}.`}{" "}
        {d === 0 ? null : done ? <span className="font-semibold text-ink">Учтено в полисах B2B.</span> : `Полисы B2B продукта с этим изменением: ${formatPlan(proposed, "count")}.`}
      </p>
      {d !== 0 && !done && product.canAdjust ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onApply({ text: inputValue(proposed, "count"), reason: "partner-sk", comment: `По прогнозу партнёрского канала: ${d > 0 ? "+" : "-"}${shift} полисов к LBE` })}
          data-testid="plan-partner-apply"
        >
          Учесть в полисах B2B
        </Button>
      ) : null}
    </div>
  );
}

function DriverEditor({
  month,
  product,
  metric,
  lbeValue,
  current,
  input,
  total,
  summary,
  preset,
  onCancel,
  onSaved,
}: {
  month: string;
  product: PlanProductData;
  metric: MetricKey;
  lbeValue: number | null;
  current: number | null;
  input: PlanInput;
  total: PlanSummary["total"];
  summary: ProductSummary;
  /** Подставленные значение, причина и обоснование: «Учесть в полисах B2B» (этап 35б) */
  preset?: Preset | null;
  onCancel: () => void;
  onSaved: (view: MonthPlanView) => void;
}) {
  const spec = productOf(product.code)!;
  const unit = UNITS[metric];
  const { notify } = usePrototype();
  const initialText = inputValue(current, unit);
  const [text, setText] = useState(preset?.text ?? initialText);
  const [reason, setReason] = useState<ForecastReasonCode>(() => preset?.reason ?? defaultReason(metric));
  const [comment, setComment] = useState(preset?.comment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parsePlanInput(text, unit);
  const valid = parsed !== null && Number.isFinite(parsed);
  const adjusted = product.drivers[metric] !== undefined;
  const id = `plan-${product.code}-${metric}`;

  // Как поменяется прогноз с новым значением: продукт и итог по продуктам
  const draft = useMemo(() => {
    if (!valid) return null;
    const drivers = { ...product.drivers, [metric]: parsed! };
    const one = summarizeProduct(spec, product.lbe, product.budget, drivers);
    const all = summarize({ ...input, products: input.products.map((p) => (p.code === product.code ? { ...p, drivers } : p)) });
    return { one, all };
  }, [valid, parsed, product, metric, spec, input]);

  /** reset: вернуть как в LBE. Иначе нужно новое значение: пустое поле не снимает корректировку */
  const save = async (reset: boolean) => {
    setError(null);
    if (!reset && text.trim() === "") return setError("Укажите новое значение");
    if (!reset && !valid) return setError(`Укажите значение числом${unit === "pct" ? " в процентах, например 10,5" : ""}`);
    if (!reset && text.trim() === initialText) return setError("Значение не изменилось: введите новое");
    const value = reset ? null : parsed;
    // Длина в символах, как на сервере и в базе: эмодзи один символ
    const length = [...comment.trim()].length;
    if (length < 3) return setError("Напишите, почему меняется прогноз: одной фразой");
    if (length > COMMENT_MAX) return setError(`Обоснование не длиннее ${COMMENT_MAX} знаков`);
    setBusy(true);
    const r = await adjustPlanAction({ month, product: product.code, metric, value, seen: current, reason, comment });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    notify(value === null ? `${metricLabel(spec, metric)}: как в LBE` : `${metricLabel(spec, metric)}: корректировка сохранена`);
    onSaved(r.value);
  };

  const impact: { key: string; label: string; unit: typeof unit; now: number | null; next: number | null; better: "up" | "down" }[] = draft
    ? [
        ...summary.rows
          .filter((r) => r.kind === "result")
          .map((r) => ({ key: r.key, label: metricLabel(spec, r.key), unit: UNITS[r.key], now: r.forecast, next: draft.one.rows.find((x) => x.key === r.key)?.forecast ?? null, better: betterOf(r.key) })),
        { key: "total-revenue", label: "Итог по продуктам: выручка, млн", unit: "mln", now: total.revenue.forecast, next: draft.all.total.revenue.forecast, better: "up" },
        { key: "total-pm", label: "Итог по продуктам: промо-маржа, млн", unit: "mln", now: total.promoMargin.forecast, next: draft.all.total.promoMargin.forecast, better: "up" },
      ]
    : [];

  return (
    <form
      className="flex flex-col gap-4 py-2"
      role="group"
      aria-label={`Корректировка: ${metricLabel(spec, metric)}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      data-testid="plan-editor"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(160px,220px)_minmax(180px,260px)_1fr]">
        <TextInput
          id={`${id}-value`}
          label={`Новое значение, ${unitLabel(unit)}`}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint={`LBE: ${formatPlan(lbeValue, unit)}`}
          aria-invalid={text !== "" && !valid ? true : undefined}
          autoFocus
        />
        <SelectField id={`${id}-reason`} label="Причина" value={reason} onChange={(e) => setReason(e.target.value as ForecastReasonCode)} options={FORECAST_REASONS.map((r) => ({ value: r.code, label: r.label }))} />
        <TextArea
          id={`${id}-comment`}
          label="Почему меняется прогноз"
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          counter={{ value: [...comment].length, max: COMMENT_MAX }}
          placeholder="Например: с 1 октября выросла комиссия партнёра, конверсия первой недели 11%"
          className="min-w-0"
        />
      </div>
      {draft ? (
        <div className="rounded-control border border-border bg-surface px-4 py-3" aria-live="polite" data-testid="plan-impact">
          <p className="mb-2 text-caption font-semibold text-text-secondary">Как изменится прогноз</p>
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {impact.map((i) => (
              <div key={i.key} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-body">
                <dt className="text-text-secondary">{i.label}</dt>
                <dd className="flex flex-wrap items-baseline gap-2 tabular-nums">
                  <span className="text-text-secondary">сейчас {formatPlan(i.now, i.unit)}</span>
                  <span className="font-semibold text-ink">станет {formatPlan(i.next, i.unit)}</span>
                  <Delta value={delta(i.next, i.now, i.unit)} better={i.better} />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={busy} data-testid="plan-save">
          Сохранить корректировку
        </Button>
        {adjusted ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(true)} data-testid="plan-reset">
            Вернуть как в LBE
          </Button>
        ) : null}
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  );
}
