"use client";

// Сравнение двух версий месяца (этап 35): бюджет, LBE, прогноз сейчас, LBE прежних загрузок и прогноз на конец любого
// дня. Версии выбираются в адресе страницы, поэтому сравнение можно отправить ссылкой

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPlan } from "@/lib/plan/format";
import type { CompareMetric, CompareView } from "@/lib/plan/types";
import { Delta, Module } from "@/components/ui/data";
import { Segmented, SelectField } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { delta } from "./plan-ui";

const METRICS: { key: CompareMetric; label: string; unit: "mln" | "count" }[] = [
  { key: "revenue", label: "Выручка", unit: "mln" },
  { key: "promoMargin", label: "Промо-маржа", unit: "mln" },
  { key: "directMargin", label: "Прямая маржа", unit: "mln" },
  { key: "units", label: "Продажи", unit: "count" },
];

export function PlanCompare({ view }: { view: CompareView }) {
  const router = useRouter();
  const [metric, setMetric] = useState<CompareMetric>("revenue");
  const m = METRICS.find((x) => x.key === metric)!;
  const go = (a: string, b: string) => router.push(`/forecast?tab=compare&month=${view.month}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  const options = view.options.map((o) => ({ value: o.id, label: o.group === "Версии месяца" ? o.label : `${o.group}: ${o.label.charAt(0).toLowerCase()}${o.label.slice(1)}` }));
  // Продажи есть только у продуктов: у групп и итога разные единицы, их не складываем
  const rows = view.rows.filter((r) => metric !== "units" || r.kind === "product" || r.kind === "sub");
  const unitText = m.unit === "mln" ? ", млн" : "";

  return (
    <div className="flex flex-col gap-6" data-testid="plan-compare">
      <Module
        title={`Сравнение версий: ${view.monthLabel}`}
        description="Выберите две версии месяца. Прогноз на конец дня собран из LBE, который действовал в тот день, и корректировок до конца дня."
        actions={<Segmented label="Показатель" value={metric} onChange={setMetric} options={METRICS.map((x) => ({ value: x.key, label: x.label }))} />}
        flush
      >
        <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2">
          <SelectField id="plan-compare-a" label="Версия А" value={view.a.id} onChange={(e) => go(e.target.value, view.b.id)} options={options} />
          <SelectField id="plan-compare-b" label="Версия Б" value={view.b.id} onChange={(e) => go(view.a.id, e.target.value)} options={options} />
        </div>
        {view.notes.map((n) => (
          <p key={n} className="px-5 pb-3 text-caption text-text-secondary">
            {n}
          </p>
        ))}
        <div className="overflow-x-auto">
          <table className="sv-datatable sv-datatable--stack" data-testid="plan-compare-table">
            <caption className="sr-only">
              {m.label}: {view.a.label} и {view.b.label}
            </caption>
            <thead>
              <tr>
                <th scope="col">Продукт</th>
                <th scope="col" className="is-num">
                  {view.a.label}
                  {unitText}
                </th>
                <th scope="col" className="is-num">
                  {view.b.label}
                  {unitText}
                </th>
                <th scope="col" className="is-num">
                  Б минус А
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const a = r.a[metric] ?? null;
                const b = r.b[metric] ?? null;
                return (
                  <tr key={r.code} className={cn(r.kind === "sub" && "sv-datatable__row--sub", r.kind === "total" && "sv-datatable__row--total")} data-testid={`plan-compare-${r.code}`}>
                    <td className="is-wide">
                      <span className={cn(r.kind !== "sub" && "sv-datatable__strong")}>{r.label}</span>
                    </td>
                    <td className="is-num" data-label="Версия А">
                      {formatPlan(a, m.unit)}
                    </td>
                    <td className="is-num" data-label="Версия Б">
                      {formatPlan(b, m.unit)}
                    </td>
                    <td className="is-num" data-label="Б минус А">
                      <Delta value={delta(b, a, m.unit)} label={`${r.label}: Б минус А`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Module>
    </div>
  );
}
