"use client";

// Прогноз месяца по драйверам (этап 32). Сверху три ключевые цифры: выручка, промо-маржа и прямая маржа по продуктам,
// прогноз против LBE и бюджета. Ниже таблица продуктов, карточка выбранного продукта с драйверами и журнал корректировок.
// Пересчёт тот же, что на сервере (src/lib/plan/summary.ts), поэтому цифры на экране и в отчётах одинаковые

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPlan } from "@/lib/plan/format";
import { productOf } from "@/lib/plan/spec";
import { planLabel, summarize, type PlanInput, type TopSummary } from "@/lib/plan/summary";
import type { MonthPlanView, PlanPerson } from "@/lib/plan/types";
import { monthLabel } from "@/lib/forecast/codes";
import { Button, buttonClass } from "@/components/ui/button";
import { Delta, Module, StatTile, Stats } from "@/components/ui/data";
import { Segmented } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { HEADLINES, delta, when, type Headline } from "./plan-ui";
import { ProductCard } from "./product-card";
import { FactsDrawer, OwnersDrawer, PullDrawer } from "./plan-admin";
import { pace } from "@/lib/plan/facts";

export function MonthPlan({ initial }: { initial: MonthPlanView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  // Новые данные с сервера после обновления страницы (загружен факт, отметили проверку в другой вкладке) заменяют экран
  useEffect(() => setView(initial), [initial]);
  const [headline, setHeadline] = useState<Headline>("revenue");
  const [selected, setSelected] = useState(() => initial.products.find((p) => p.canAdjust)?.code ?? initial.products[0]?.code ?? "");
  const [pullOpen, setPullOpen] = useState(false);
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);

  const input: PlanInput = useMemo(() => ({ products: view.products.map((p) => ({ code: p.code, lbe: p.lbe, budget: p.budget, drivers: p.drivers })), groups: view.groups }), [view]);
  const summary = useMemo(() => summarize(input), [input]);
  const product = view.products.find((p) => p.code === selected);
  const productSummary = summary.products.find((p) => p.code === selected);

  const pick = (code: string) => {
    setSelected(code);
    requestAnimationFrame(() => document.getElementById(`plan-product-${code}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const setOwners = (owners: PlanPerson[]) => setView((v) => ({ ...v, products: v.products.map((p) => (p.code === selected ? { ...p, owners } : p)) }));

  // Плитка факта (этап 35): выручка с начала месяца по продуктам, где загружен факт, против прогноза тех же продуктов
  const factTile = useMemo(() => {
    const parts = view.products
      .map((p) => {
        const s = summary.products.find((x) => x.code === p.code);
        const x = s ? pace(p.facts?.daily.revenue ?? [], view.month, s.revenue.forecast) : null;
        return x && s ? { label: productOf(p.code)?.label ?? p.code, x, forecast: s.revenue.forecast } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    if (!parts.length) return null;
    const sum = (f: (p: (typeof parts)[number]) => number | null) => parts.reduce<number | null>((acc, p) => (acc === null || f(p) === null ? null : acc + f(p)!), 0);
    return {
      products: parts.map((p) => p.label),
      elapsed: Math.max(...parts.map((p) => p.x.elapsed)),
      toDate: sum((p) => p.x.toDate)!,
      planToDate: sum((p) => p.x.planToDate),
      runRate: sum((p) => p.x.runRate)!,
      forecast: sum((p) => p.forecast),
    };
  }, [view, summary]);

  const pulled = view.source.pulledAt ? `Бюджет и LBE из LRF загружены ${when(view.source.pulledAt)}${view.source.pulledBy ? `, загрузка: ${view.source.pulledBy}` : ""}` : "Бюджет и LBE ещё не загружены";

  return (
    <div className="flex flex-col gap-6" data-testid="month-plan">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {view.months.length > 1 ? (
            <Segmented label="Месяц прогноза" value={view.month} onChange={(m) => router.push(`/forecast?month=${m}`)} options={view.months.slice(0, 6).map((m) => ({ value: m, label: monthLabel(m) }))} />
          ) : (
            <p className="font-heading text-title-sm font-bold text-ink first-letter:uppercase">{view.monthLabel}</p>
          )}
          <p className="text-caption text-text-secondary" data-testid="plan-source">
            {pulled}. {view.source.mode === "imitation" ? "Цифры из имитации LRF для проверки." : "LRF ресурс только читает."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {view.canExport && !view.empty ? (
            <a href={`/forecast/export?month=${view.month}`} className={buttonClass("ghost")} data-testid="plan-export" download>
              Выгрузить в Excel
            </a>
          ) : null}
          {view.canFacts ? (
            <Button variant="secondary" onClick={() => setFactsOpen(true)} data-testid="plan-facts-open">
              Загрузить факт
            </Button>
          ) : null}
          {view.canPull ? (
            <Button variant="secondary" onClick={() => setPullOpen(true)} data-testid="plan-pull-open">
              Загрузить из LRF
            </Button>
          ) : null}
        </div>
      </div>

      {view.empty ? (
        <Module title={`Прогноз на ${view.monthLabel} ещё не начат`} description={view.canPull ? "Загрузите бюджет и LBE месяца из LRF: после этого команды продуктов смогут корректировать драйверы." : "Бюджет и LBE месяца загружает владелец ресурса после того, как LBE заполнен в LRF. Тогда здесь появятся продукты и драйверы."} />
      ) : (
        <>
          <Stats label="Итог по продуктам">
            {HEADLINES.map((h) => {
              const t = summary.total[h.key];
              return (
                <StatTile
                  key={h.key}
                  testId={`plan-stat-${h.key}`}
                  label={`${h.label}, прогноз`}
                  value={formatPlan(t.forecast, "mln")}
                  unit="млн ₽"
                  compare={[
                    { label: "LBE", deltaLabel: `${h.label} к LBE`, value: formatPlan(t.lbe, "mln"), delta: delta(t.forecast, t.lbe, "mln") },
                    { label: "Бюджет", deltaLabel: `${h.label} к бюджету`, value: formatPlan(t.budget, "mln"), delta: delta(t.forecast, t.budget, "mln") },
                  ]}
                  note={t.without.length ? `Без ${t.without.join(", ")}: в LRF нет этой строки` : undefined}
                />
              );
            })}
            {factTile ? (
              <StatTile
                testId="plan-stat-fact"
                label="Выручка, факт с начала месяца"
                value={formatPlan(factTile.toDate, "mln")}
                unit="млн ₽"
                compare={[
                  { label: "Прогноз на дату", deltaLabel: "Факт к прогнозу на дату", value: formatPlan(factTile.planToDate, "mln"), delta: delta(factTile.toDate, factTile.planToDate, "mln") },
                  { label: "Месяц при этом темпе", deltaLabel: "Темп к прогнозу месяца", value: formatPlan(factTile.runRate, "mln"), delta: delta(factTile.runRate, factTile.forecast, "mln") },
                ]}
                note={`По продуктам: ${factTile.products.join(", ")}. По ${factTile.elapsed} число, темп равномерный по дням`}
              />
            ) : null}
          </Stats>

          <Module
            id="plan-products"
            title="По продуктам"
            description="Прогноз после корректировок команды против LBE и бюджета. Нажмите на продукт, чтобы открыть его драйверы."
            actions={<Segmented label="Показатель" value={headline} onChange={setHeadline} options={HEADLINES.map((h) => ({ value: h.key, label: h.label }))} />}
            flush
          >
            <ProductsTable top={summary.top} productRows={summary.products} headline={headline} selected={selected} onPick={pick} total={summary.total[headline]} waiting={new Set(view.products.filter((p) => p.review?.state === "waiting").map((p) => p.code))} />
          </Module>

          <div className="flex flex-col gap-3">
            <Segmented label="Продукт" value={selected} onChange={pick} options={view.products.map((p) => ({ value: p.code, label: productOf(p.code)?.label ?? p.code }))} className="self-start" />
            {product && productSummary ? (
              <ProductCard
                key={`${product.code}:${view.month}`}
                month={view.month}
                product={product}
                summary={productSummary}
                input={input}
                total={summary.total}
                canOwners={view.canOwners}
                adjustHint={view.adjustHint}
                onSaved={setView}
                onOwners={() => setOwnersOpen(true)}
              />
            ) : null}
          </div>

          <History view={view} />
        </>
      )}

      {view.canPull ? <PullDrawer open={pullOpen} onOpenChange={setPullOpen} month={view.month} serviceEmail={view.source.serviceEmail} mode={view.source.mode} sourceId={view.source.sourceId} canSource={view.canSource} /> : null}
      {view.canFacts ? <FactsDrawer open={factsOpen} onOpenChange={setFactsOpen} /> : null}
      {view.canOwners && product ? <OwnersDrawer key={product.code} open={ownersOpen} onOpenChange={setOwnersOpen} product={product.code} owners={product.owners} onSaved={setOwners} /> : null}
    </div>
  );
}

function ProductsTable({
  top,
  productRows,
  headline,
  selected,
  onPick,
  total,
  waiting,
}: {
  top: TopSummary[];
  productRows: ReturnType<typeof summarize>["products"];
  headline: Headline;
  selected: string;
  onPick: (code: string) => void;
  total: ReturnType<typeof summarize>["total"][Headline];
  /** Продукты, где после загрузки LBE прогноз ещё не проверен (этап 35) */
  waiting: Set<string>;
}) {
  const label = HEADLINES.find((h) => h.key === headline)!.label;
  const line = (key: string, name: string, t: { budget: number | null; lbe: number | null; forecast: number | null }, adjusted: number, kind: "product" | "group" | "sub" | "total", code?: string) => {
    const pickable = code !== undefined;
    const changed = t.forecast !== null && t.lbe !== null && Math.abs(t.forecast - t.lbe) > 1e-9;
    return (
      <tr
        key={key}
        className={cn(
          pickable && "sv-datatable__row--pick",
          pickable && code === selected && "sv-datatable__row--picked",
          kind === "sub" && "sv-datatable__row--sub",
          kind === "total" && "sv-datatable__row--total",
        )}
        onClick={pickable ? () => onPick(code!) : undefined}
        data-testid={`plan-top-${key}`}
      >
        <td className="is-wide">
          {pickable ? (
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <button type="button" className="text-left font-semibold text-ink hover:underline focus-visible:underline" onClick={(e) => (e.stopPropagation(), onPick(code!))} aria-pressed={code === selected}>
                {name}
              </button>
              {waiting.has(code!) ? (
                <span className="sv-tag sv-tag--risk" data-testid={`plan-waiting-${code}`}>
                  ждёт проверки
                </span>
              ) : null}
            </span>
          ) : (
            <span className={cn(kind !== "sub" && "sv-datatable__strong")}>{name}</span>
          )}
        </td>
        <td className="is-num" data-label="Бюджет">
          {formatPlan(t.budget, "mln")}
        </td>
        <td className="is-num" data-label="LBE">
          {formatPlan(t.lbe, "mln")}
        </td>
        <td className="is-num" data-label="Прогноз">
          <span className={cn(changed && "sv-datatable__strong")}>{formatPlan(t.forecast, "mln")}</span>
        </td>
        <td className="is-num" data-label="К LBE">
          <Delta value={delta(t.forecast, t.lbe, "mln")} label={`${name} к LBE`} />
        </td>
        <td className="is-num" data-label="К бюджету">
          <Delta value={delta(t.forecast, t.budget, "mln")} label={`${name} к бюджету`} />
        </td>
        <td className="is-num" data-label="Корректировок">
          {kind === "total" ? "" : adjusted || <span className="sv-datatable__muted">0</span>}
        </td>
      </tr>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="sv-datatable sv-datatable--stack" data-testid="plan-products-table">
        <caption className="sr-only">{label} по продуктам, млн рублей: бюджет, LBE и прогноз</caption>
        <thead>
          <tr>
            <th scope="col">Продукт</th>
            <th scope="col" className="is-num">
              Бюджет, млн
            </th>
            <th scope="col" className="is-num">
              LBE, млн
            </th>
            <th scope="col" className="is-num">
              Прогноз, млн
            </th>
            <th scope="col" className="is-num">
              К LBE
            </th>
            <th scope="col" className="is-num">
              К бюджету
            </th>
            <th scope="col" className="is-num">
              Корректировок
            </th>
          </tr>
        </thead>
        <tbody>
          {top.flatMap((t) =>
            t.kind === "product"
              ? [line(t.code, t.label, t[headline], t.adjusted, "product", t.code)]
              : [
                  line(t.code, t.label, t[headline], t.adjusted, "group"),
                  ...t.parts.map((code) => {
                    const p = productRows.find((x) => x.code === code)!;
                    return line(code, planLabel(code), p[headline], p.adjusted, "sub", code);
                  }),
                ],
          )}
          {line("total", "Итого по продуктам", total, 0, "total")}
        </tbody>
      </table>
      {total.without.length ? <p className="px-5 py-3 text-caption text-text-secondary">Итог без {total.without.join(", ")}: в LRF нет строки «{label}» для них.</p> : null}
    </div>
  );
}

function History({ view }: { view: MonthPlanView }) {
  return (
    <Module
      id="plan-history"
      title="Журнал корректировок"
      description="Все корректировки драйверов за месяц: кто, когда и почему. Действует последняя корректировка показателя, прежние остаются в журнале."
      flush
    >
      {view.history.length ? (
        <ol className="sv-log" data-testid="plan-history">
          {view.history.map((a) => (
            <li key={a.id} className="sv-log__item">
              <span className="sv-log__when">{when(a.at)}</span>
              <div className="sv-log__what">
                <span className="sv-log__title">
                  {a.productLabel}, {a.metricLabel.toLowerCase()}
                </span>
                <span className="sv-log__change">
                  <span>было {formatPlan(a.previous, a.unit)}</span>
                  <span className="font-semibold text-ink">{a.value === null ? "вернули как в LBE" : `стало ${formatPlan(a.value, a.unit)}`}</span>
                  {a.value !== null ? <Delta value={delta(a.value, a.previous, a.unit)} better={a.metric === "promoCosts" ? "down" : "up"} /> : null}
                </span>
                <span className="sv-log__comment">
                  <span className="font-semibold">{a.reasonLabel}:</span> {a.comment}
                </span>
                <span className="text-caption text-text-secondary">{a.author.name}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 pb-4 text-body text-text-secondary">Корректировок за {view.monthLabel} пока нет: прогноз совпадает с LBE.</p>
      )}
    </Module>
  );
}
