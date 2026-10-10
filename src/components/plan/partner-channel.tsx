"use client";

// Партнёрский канал в прогнозе месяца (этап 35б). Сверху выручка, расходы на партнёров и маржа канала: прогноз против
// LBE и бюджета канала из P&L b2b. Ниже итоги по продуктам и каналам и список партнёров с поиском. У партнёра драйверы
// из листа «Инструкция» LRF b2b: ёмкость, полисы через Сравни, выручка на полис, конверсия в кросс, комиссия. Пересчёт
// тот же, что на сервере (src/lib/plan/partners.ts)

import { useMemo, useState } from "react";
import { usePrototype } from "@/domain/store";
import { adjustPartnerAction, checkPlanAction } from "@/app/(app)/forecast/actions";
import { FORECAST_REASONS, type ForecastReasonCode } from "@/lib/forecast/codes";
import { formatPlan, inputValue, lcFirst, parsePlanInput, unitLabel } from "@/lib/plan/format";
import {
  PARTNER_CHANNELS,
  PARTNER_LABEL,
  PARTNER_UNITS,
  channelLabel,
  computePartner,
  derivePartner,
  kindLabel,
  partnerDrivers,
  partnerHint,
  partnerMetricLabel,
  partnerResults,
  partnerTotals,
  productName,
  activePartnerDrivers,
  type PartnerMetric,
  type PartnerSum,
  type PartnerTriple,
} from "@/lib/plan/partners";
import type { MonthPlanView, PartnerChannelView, PartnerLineView } from "@/lib/plan/types";
import { Button } from "@/components/ui/button";
import { Delta, Module, StatTile, Stats } from "@/components/ui/data";
import { FormError } from "@/components/ui/field";
import { Segmented, SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { delta, shortName, when } from "./plan-ui";
import { reviewText } from "./product-card";

const COMMENT_MAX = 300;

type Measure = "revenue" | "costs" | "margin" | "policies";
const MEASURES: { key: Measure; label: string; unit: "mln" | "count"; better: "up" | "down" }[] = [
  { key: "revenue", label: "Выручка", unit: "mln", better: "up" },
  { key: "costs", label: "Расходы на партнёров", unit: "mln", better: "down" },
  { key: "margin", label: "Маржа", unit: "mln", better: "up" },
  { key: "policies", label: "Полисы", unit: "count", better: "up" },
];

/** Партнёр продаёт: полисы или выручка в LBE или в прогнозе */
const selling = (l: PartnerLineView) => {
  const L = derivePartner(l.lbe);
  const c = computePartner(l.lbe, l.drivers);
  const some = (x: number | null | undefined) => Math.abs(x ?? 0) > 1e-9;
  return some(L.policies) || some(L.revenue) || some(c.policies) || some(c.revenue);
};

const defaultReason = (key: PartnerMetric): ForecastReasonCode => (key === "rpu" || key === "commission" ? "check-kv" : key === "crUpsale" ? "conversion" : "partner-sk");

export function PartnerChannel({
  month,
  partners,
  canOwners,
  adjustHint,
  onSaved,
  onOwners,
}: {
  month: string;
  partners: PartnerChannelView;
  canOwners: boolean;
  adjustHint: string | null;
  onSaved: (view: MonthPlanView) => void;
  onOwners: () => void;
}) {
  const { notify } = usePrototype();
  const totals = useMemo(() => partnerTotals(partners.lines, partners.totals), [partners]);
  const products = useMemo(() => [...new Set(partners.lines.map((l) => l.product))], [partners]);
  const [measure, setMeasure] = useState<Measure>("revenue");
  const [product, setProduct] = useState<string>("all");
  const [channel, setChannel] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [showIdle, setShowIdle] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const owners = partners.owners.map((o) => o.name).join(", ") || "не назначена";
  const q = query.trim().toLowerCase().replace(/ё/g, "е");
  const filtered = partners.lines.filter((l) => (product === "all" || l.product === product) && (channel === "all" || l.channel === channel) && (!q || l.label.toLowerCase().replace(/ё/g, "е").includes(q)));
  const idle = filtered.filter((l) => !selling(l));
  const shown = showIdle || q ? filtered : filtered.filter(selling);

  const check = async () => {
    setChecking(true);
    const r = await checkPlanAction(month, "b2b");
    setChecking(false);
    if (!r.ok) return notify(r.error, "error");
    notify(`${PARTNER_LABEL}: прогноз отмечен проверенным`);
    onSaved(r.value);
  };

  const m = MEASURES.find((x) => x.key === measure)!;

  return (
    <Module
      id="plan-partners"
      title={PARTNER_LABEL}
      description={
        partners.canAdjust
          ? "Полисы B2B продуктов через партнёров, отказной трафик и агентов. Меняйте драйверы партнёра: выручка, расходы и маржа пересчитаются сами. Бюджета по партнёрам в LRF нет, он по продукту и каналу из P&L b2b."
          : (adjustHint ?? `Полисы B2B продуктов через партнёров и агентов из LRF b2b. Прогноз канала корректирует его команда: ${owners}.`)
      }
      actions={
        <>
          {partners.canAdjust && partners.review?.state === "waiting" ? (
            <Button size="sm" onClick={() => void check()} loading={checking} disabled={checking} data-testid="partners-check">
              Прогноз проверен
            </Button>
          ) : null}
          {canOwners ? (
            <Button variant="secondary" size="sm" onClick={onOwners} data-testid="partners-owners-open">
              Команда канала
            </Button>
          ) : null}
        </>
      }
      params={[
        { label: "Команда", value: owners },
        { label: "Партнёров", value: `${totals.total.partners}, продают ${partners.lines.filter(selling).length}` },
        { label: "Скорректировано", value: String(totals.total.adjusted) },
        { label: "Партнёры загружены", value: when(partners.pulledAt) },
        { label: "После LBE", value: <span data-testid="partners-review">{reviewText(partners.review)}</span> },
      ]}
      flush
    >
      <div className="border-b border-border px-5 py-4">
        <Stats label="Партнёрский канал в цифрах">
          {MEASURES.slice(0, 3).map((x) => {
            const t = totals.total[x.key];
            return (
              <StatTile
                key={x.key}
                testId={`partners-stat-${x.key}`}
                label={`${x.label}, прогноз`}
                value={formatPlan(t.forecast, "mln")}
                unit="млн ₽"
                better={x.better}
                compare={[
                  { label: "LBE", deltaLabel: `${x.label} к LBE`, value: formatPlan(t.lbe, "mln"), delta: delta(t.forecast, t.lbe, "mln") },
                  { label: "Бюджет", deltaLabel: `${x.label} к бюджету`, value: formatPlan(t.budget, "mln"), delta: delta(t.forecast, t.budget, "mln") },
                ]}
              />
            );
          })}
        </Stats>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <h3 className="font-heading text-title-sm font-bold text-ink">По продуктам и каналам</h3>
        <Segmented label="Показатель канала" value={measure} onChange={setMeasure} options={MEASURES.map((x) => ({ value: x.key, label: x.label }))} />
      </div>
      <TotalsTable totals={totals} products={products} measure={m} />

      <div className="flex flex-col gap-3 border-t border-border px-5 py-4">
        <h3 className="font-heading text-title-sm font-bold text-ink">Партнёры</h3>
        <div className="flex flex-wrap items-end gap-3">
          <SelectField id="partners-product" label="Продукт" value={product} onChange={(e) => setProduct(e.target.value)} options={[{ value: "all", label: "Все продукты" }, ...products.map((p) => ({ value: p, label: productName(p) }))]} />
          <SelectField id="partners-channel" label="Канал" value={channel} onChange={(e) => setChannel(e.target.value)} options={[{ value: "all", label: "Все каналы" }, ...PARTNER_CHANNELS.map((c) => ({ value: c.code, label: c.label }))]} />
          <TextInput id="partners-search" label="Поиск партнёра" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" className="min-w-0 sm:w-64" />
        </div>
      </div>
      {shown.length ? (
        <PartnerTable lines={shown} open={open} onOpen={(code) => setOpen((x) => (x === code ? null : code))} month={month} canAdjust={partners.canAdjust} all={partners.lines} onSaved={(v) => onSaved(v)} />
      ) : (
        <p className="px-5 pb-4 text-body text-text-secondary" data-testid="partners-empty">
          {q ? "Партнёров с таким названием нет." : "Под эти отборы партнёров с продажами нет."}
        </p>
      )}
      {idle.length && !q ? (
        <div className="px-5 pb-4">
          <Button variant="ghost" size="sm" onClick={() => setShowIdle((x) => !x)} data-testid="partners-idle">
            {showIdle ? "Скрыть партнёров без продаж" : `Показать партнёров без продаж: ${idle.length}`}
          </Button>
        </div>
      ) : null}
      {partners.history.length ? <PartnerHistory partners={partners} /> : null}
    </Module>
  );
}

function TotalsTable({ totals, products, measure }: { totals: ReturnType<typeof partnerTotals>; products: string[]; measure: (typeof MEASURES)[number] }) {
  const line = (key: string, name: string, s: PartnerSum | undefined, kind: "product" | "sub" | "total", context?: string) => {
    if (!s) return null;
    const t: PartnerTriple = s[measure.key];
    // У вложенных строк «CPA и отказной» и «Агенты» для экранного диктора добавляется продукт: строки повторяются
    const full = context ? `${context}, ${lcFirst(name)}` : name;
    return (
      <tr key={key} className={cn(kind === "sub" && "sv-datatable__row--sub", kind === "total" && "sv-datatable__row--total")} data-testid={`partners-total-${key}`}>
        <th scope="row" className="is-wide text-left font-normal">
          <span className={cn(kind !== "sub" && "sv-datatable__strong")}>{name}</span>
          {context ? <span className="sr-only">, {context}</span> : null}
        </th>
        <td className="is-num" data-label="Бюджет">
          {measure.key === "policies" ? <span className="sv-datatable__muted">нет в P&L</span> : formatPlan(t.budget, measure.unit)}
        </td>
        <td className="is-num" data-label="LBE">
          {formatPlan(t.lbe, measure.unit)}
        </td>
        <td className="is-num" data-label="Прогноз">
          {formatPlan(t.forecast, measure.unit)}
        </td>
        <td className="is-num" data-label="К LBE">
          <Delta value={delta(t.forecast, t.lbe, measure.unit)} better={measure.better} label={`${full} к LBE`} />
        </td>
        <td className="is-num" data-label="К бюджету">
          <Delta value={delta(t.forecast, t.budget, measure.unit)} better={measure.better} label={`${full} к бюджету`} />
        </td>
        <td className="is-num" data-label="Партнёров">
          <span>
            {s.partners}
            {s.adjusted ? <span className="sv-datatable__muted">{`, с правками ${s.adjusted}`}</span> : null}
          </span>
        </td>
      </tr>
    );
  };
  const unit = measure.unit === "mln" ? ", млн" : "";
  return (
    <div className="overflow-x-auto">
      <table className="sv-datatable sv-datatable--stack" data-testid="partners-totals">
        <caption className="sr-only">
          {PARTNER_LABEL}: {lcFirst(measure.label)} по продуктам и каналам, бюджет, LBE и прогноз
        </caption>
        <thead>
          <tr>
            <th scope="col">Продукт и канал</th>
            <th scope="col" className="is-num">
              Бюджет{unit}
            </th>
            <th scope="col" className="is-num">
              LBE{unit}
            </th>
            <th scope="col" className="is-num">
              Прогноз{unit}
            </th>
            <th scope="col" className="is-num">
              К LBE
            </th>
            <th scope="col" className="is-num">
              К бюджету
            </th>
            <th scope="col" className="is-num">
              Партнёров
            </th>
          </tr>
        </thead>
        <tbody>
          {products.flatMap((p) => [
            line(p, productName(p), totals.byProduct.get(p), "product"),
            ...PARTNER_CHANNELS.map((c) => line(`${p}-${c.code}`, c.label, totals.byPair.get(`${p}:${c.code}`), "sub", productName(p))),
          ])}
          {line("total", "Весь канал", totals.total, "total")}
        </tbody>
      </table>
    </div>
  );
}

function PartnerTable({
  lines,
  all,
  open,
  onOpen,
  month,
  canAdjust,
  onSaved,
}: {
  lines: PartnerLineView[];
  all: PartnerLineView[];
  open: string | null;
  onOpen: (code: string) => void;
  month: string;
  canAdjust: boolean;
  onSaved: (view: MonthPlanView) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="sv-datatable sv-datatable--stack" data-testid="partners-table">
        <caption className="sr-only">Партнёры: полисы, выручка и маржа, LBE и прогноз</caption>
        <thead>
          <tr>
            <th scope="col">Партнёр</th>
            <th scope="col" className="is-num">
              Полисы LBE
            </th>
            <th scope="col" className="is-num">
              Полисы, прогноз
            </th>
            <th scope="col" className="is-num">
              Выручка, млн
            </th>
            <th scope="col" className="is-num">
              Маржа, млн
            </th>
            <th scope="col" className="is-num">
              Выручка к LBE
            </th>
            <th scope="col">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.flatMap((l) => {
            const L = derivePartner(l.lbe);
            const c = computePartner(l.lbe, l.drivers);
            const adjusted = Object.keys(activePartnerDrivers(l.lbe, l.drivers)).length;
            const isOpen = open === l.code;
            return [
              <tr key={l.code} className={cn(adjusted > 0 && "sv-datatable__row--changed", isOpen && "sv-datatable__row--edit")} data-testid={`partner-${l.code}`}>
                <th scope="row" className="is-wide text-left font-normal">
                  <div className="sv-datatable__name">
                    <span className="font-semibold text-ink">
                      {l.label}
                      {adjusted ? <span className="sr-only">, скорректировано</span> : null}
                    </span>
                    <span className="sv-datatable__hint">
                      {productName(l.product)}, {lcFirst(channelLabel(l.channel))}, {lcFirst(kindLabel(l.kind))}
                    </span>
                  </div>
                </th>
                <td className="is-num" data-label="Полисы LBE">
                  {formatPlan(L.policies, "count")}
                </td>
                <td className="is-num" data-label="Полисы, прогноз">
                  <span className={cn(c.policies !== L.policies && "sv-datatable__strong")}>{formatPlan(c.policies, "count")}</span>
                </td>
                <td className="is-num" data-label="Выручка, млн">
                  {formatPlan(c.revenue, "mln")}
                </td>
                <td className="is-num" data-label="Маржа, млн">
                  {formatPlan(c.margin, "mln")}
                </td>
                <td className="is-num" data-label="Выручка к LBE">
                  <Delta value={delta(c.revenue, L.revenue, "mln")} label={`${l.label}: выручка к LBE`} />
                </td>
                <td className="is-num is-action">
                  <Button variant="soft" size="sm" onClick={() => onOpen(l.code)} aria-expanded={isOpen} aria-controls={isOpen ? `partner-card-${l.code}` : undefined} data-testid={`partner-open-${l.code}`}>
                    {isOpen ? "Скрыть" : canAdjust ? "Драйверы" : "Подробно"}
                  </Button>
                </td>
              </tr>,
              isOpen ? (
                <tr key={`${l.code}-card`} className="sv-datatable__row--edit">
                  <td colSpan={7} className="is-wide" id={`partner-card-${l.code}`}>
                    <PartnerCard line={l} all={all} month={month} canAdjust={canAdjust} onSaved={onSaved} />
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function PartnerCard({ line, all, month, canAdjust, onSaved }: { line: PartnerLineView; all: PartnerLineView[]; month: string; canAdjust: boolean; onSaved: (view: MonthPlanView) => void }) {
  const [editing, setEditing] = useState<PartnerMetric | null>(null);
  const L = derivePartner(line.lbe);
  const c = computePartner(line.lbe, line.drivers);
  // Пометка «скорректирован» как в списке и итогах: корректировка, равная LBE после перезагрузки, не считается
  const active = activePartnerDrivers(line.lbe, line.drivers);
  const row = (key: PartnerMetric, driver: boolean) => {
    const unit = PARTNER_UNITS[key];
    const label = partnerMetricLabel(key, line.channel);
    const last = line.last[key];
    const adjusted = driver && active[key] !== undefined;
    const isEditing = editing === key;
    return [
      <tr key={key} className={cn(adjusted && "sv-datatable__row--changed")} data-testid={`partner-row-${key}`}>
        <th scope="row" className="is-wide text-left font-normal">
          <div className="sv-datatable__name">
            <span className={cn(!driver && "sv-datatable__strong")}>{label}</span>
            {driver ? <span className="sv-datatable__hint max-sm:hidden">{partnerHint(key)}</span> : null}
            {driver && last ? (
              <span className="sv-note">
                <span className="sv-note__who">
                  {last.value === null ? "Возврат к LBE" : "Корректировка"}: {shortName(last.author.name)}
                </span>
                <span>{when(last.at)}</span>
                <span>
                  {last.reasonLabel}: {last.comment}
                </span>
              </span>
            ) : null}
          </div>
        </th>
        <td className="is-num" data-label="LBE">
          {formatPlan(L[key], unit)}
        </td>
        <td className="is-num" data-label="Прогноз">
          <span className={cn((adjusted || (!driver && c[key] !== L[key])) && "sv-datatable__strong")}>{formatPlan(c[key], unit)}</span>
        </td>
        <td className="is-num" data-label="К LBE">
          <Delta value={delta(c[key], L[key], unit)} better={key === "costs" || key === "commission" ? "down" : "up"} label={`${label} к LBE`} />
        </td>
        <td className="is-num is-action">
          {driver && canAdjust && !isEditing ? (
            <Button variant="soft" size="sm" onClick={() => setEditing(key)} aria-label={`Изменить: ${label}`} data-testid={`partner-edit-${key}`}>
              Изменить
            </Button>
          ) : null}
        </td>
      </tr>,
      isEditing ? (
        <tr key={`${key}-edit`} className="sv-datatable__row--edit">
          <td colSpan={5} className="is-wide">
            <PartnerEditor
              month={month}
              line={line}
              all={all}
              metric={key}
              onCancel={() => setEditing(null)}
              onSaved={(v) => {
                setEditing(null);
                onSaved(v);
              }}
            />
          </td>
        </tr>
      ) : null,
    ];
  };
  return (
    <div className="flex flex-col gap-2 py-2" data-testid="partner-card">
      <table className="sv-datatable sv-datatable--stack">
        <caption className="sr-only">{line.label}: драйверы и результат, LBE и прогноз</caption>
        <thead>
          <tr>
            <th scope="col">Показатель</th>
            <th scope="col" className="is-num">
              LBE
            </th>
            <th scope="col" className="is-num">
              Прогноз
            </th>
            <th scope="col" className="is-num">
              К LBE
            </th>
            <th scope="col">
              <span className="sr-only">Действия</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="sv-datatable__section">
            <td colSpan={5}>Драйверы: меняет команда канала</td>
          </tr>
          {partnerDrivers(line.lbe).flatMap((k) => row(k, true))}
          <tr className="sv-datatable__section">
            <td colSpan={5}>Результат: пересчитывается от драйверов</td>
          </tr>
          {partnerResults(line.lbe).flatMap((k) => row(k, false))}
        </tbody>
      </table>
    </div>
  );
}

function PartnerEditor({ month, line, all, metric, onCancel, onSaved }: { month: string; line: PartnerLineView; all: PartnerLineView[]; metric: PartnerMetric; onCancel: () => void; onSaved: (view: MonthPlanView) => void }) {
  const { notify } = usePrototype();
  const unit = PARTNER_UNITS[metric];
  const L = derivePartner(line.lbe);
  const current = computePartner(line.lbe, line.drivers)[metric] ?? null;
  const initialText = inputValue(current, unit);
  const [text, setText] = useState(initialText);
  const [reason, setReason] = useState<ForecastReasonCode>(() => defaultReason(metric));
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = parsePlanInput(text, unit);
  const valid = parsed !== null && Number.isFinite(parsed);
  const adjusted = line.drivers[metric] !== undefined;
  const label = partnerMetricLabel(metric, line.channel);
  const id = `partner-${line.code}-${metric}`;

  // Как изменится прогноз: партнёр, его продукт в канале и весь канал
  const impact = useMemo(() => {
    if (!valid) return [];
    const drivers = { ...line.drivers, [metric]: parsed! };
    const now = computePartner(line.lbe, line.drivers);
    const next = computePartner(line.lbe, drivers);
    const before = partnerTotals(all, []);
    const after = partnerTotals(
      all.map((l) => (l.code === line.code ? { ...l, drivers } : l)),
      [],
    );
    const items: { key: string; label: string; unit: "mln" | "count" | "pct"; now: number | null; next: number | null; better: "up" | "down" }[] = [
      { key: "share", label: partnerMetricLabel("share", line.channel), unit: "pct", now: now.share ?? null, next: next.share ?? null, better: "up" },
      { key: "revenue", label: `${line.label}: выручка, млн`, unit: "mln", now: now.revenue ?? null, next: next.revenue ?? null, better: "up" },
      { key: "costs", label: partnerMetricLabel("costs", line.channel), unit: "mln", now: now.costs ?? null, next: next.costs ?? null, better: "down" },
      { key: "margin", label: `${line.label}: маржа, млн`, unit: "mln", now: now.margin ?? null, next: next.margin ?? null, better: "up" },
      { key: "product-policies", label: `${productName(line.product)}: полисы партнёрского канала`, unit: "count", now: before.byProduct.get(line.product)?.policies.forecast ?? null, next: after.byProduct.get(line.product)?.policies.forecast ?? null, better: "up" },
      { key: "total-margin", label: "Весь канал: маржа, млн", unit: "mln", now: before.total.margin.forecast, next: after.total.margin.forecast, better: "up" },
    ];
    return items;
  }, [valid, parsed, line, metric, all]);

  // Доля больше 100%: не ошибка (ёмкость в LRF могла устареть), но стоит проверить
  const overCapacity = useMemo(() => {
    if (!valid) return false;
    const share = computePartner(line.lbe, { ...line.drivers, [metric]: parsed! }).share;
    return share != null && share > 1 + 1e-9;
  }, [valid, parsed, line, metric]);

  const save = async (reset: boolean) => {
    setError(null);
    if (!reset && text.trim() === "") return setError("Укажите новое значение");
    if (!reset && !valid) return setError(`Укажите значение числом${unit === "pct" ? " в процентах, например 85" : ""}`);
    if (!reset && text.trim() === initialText) return setError("Значение не изменилось: введите новое");
    const length = [...comment.trim()].length;
    if (length < 3) return setError("Напишите, почему меняется прогноз: одной фразой");
    if (length > COMMENT_MAX) return setError(`Обоснование не длиннее ${COMMENT_MAX} знаков`);
    setBusy(true);
    const r = await adjustPartnerAction({ month, partner: line.code, metric, value: reset ? null : parsed, seen: current, reason, comment });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    notify(reset ? `${line.label}, ${lcFirst(label)}: как в LBE` : `${line.label}, ${lcFirst(label)}: корректировка сохранена`);
    onSaved(r.value);
  };

  return (
    <form
      className="flex flex-col gap-4 py-2"
      role="group"
      aria-label={`Корректировка: ${line.label}, ${label}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      data-testid="partner-editor"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(160px,220px)_minmax(180px,260px)_1fr]">
        <TextInput
          id={`${id}-value`}
          label={`Новое значение, ${unitLabel(unit)}`}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint={`LBE: ${formatPlan(L[metric] ?? null, unit)}`}
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
          placeholder="Например: партнёр подтвердил объём, с 15 октября комиссия 80%"
          className="min-w-0"
        />
      </div>
      {impact.length ? (
        <div className="rounded-control border border-border bg-surface px-4 py-3" aria-live="polite" data-testid="partner-impact">
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
      {overCapacity ? (
        <p className="text-caption text-warning-ink" data-testid="partner-over-capacity">
          Полисов через Сравни больше ёмкости партнёра: проверьте ёмкость или полисы.
        </p>
      ) : null}
      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={busy} data-testid="partner-save">
          Сохранить корректировку
        </Button>
        {adjusted ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(true)} data-testid="partner-reset">
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

function PartnerHistory({ partners }: { partners: PartnerChannelView }) {
  return (
    <div className="border-t border-border">
      <h3 className="px-5 pt-4 font-heading text-title-sm font-bold text-ink">Корректировки партнёров</h3>
      <ol className="sv-log" data-testid="partners-history">
        {partners.history.map((a) => (
          <li key={a.id} className="sv-log__item">
            <span className="sv-log__when">{when(a.at)}</span>
            <div className="sv-log__what">
              <span className="sv-log__title">
                {a.partnerLabel}
                {a.product ? `, ${productName(a.product)}` : ""}: {lcFirst(a.metricLabel)}
              </span>
              <span className="sv-log__change">
                <span>было {formatPlan(a.previous, a.unit)}</span>
                <span className="font-semibold text-ink">{a.value === null ? "вернули как в LBE" : `стало ${formatPlan(a.value, a.unit)}`}</span>
                {a.value !== null ? <Delta value={delta(a.value, a.previous, a.unit)} better={a.metric === "commission" ? "down" : "up"} /> : null}
              </span>
              <span className="sv-log__comment">
                <span className="font-semibold">{a.reasonLabel}:</span> {a.comment}
              </span>
              <span className="text-caption text-text-secondary">{a.author.name}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
