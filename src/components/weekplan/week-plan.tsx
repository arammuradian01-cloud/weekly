// Неделя к плану (этап 81): части экрана без состояния. Переключатели ссылками (неделя, версия плана, продукт, показатель),
// плитки итогов, таблицы продуктов и срезов. Цифры приходят готовыми из src/lib/weekplan/view.ts

import Link from "next/link";
import { cn } from "@/lib/cn";
import { Delta as DeltaView, StatTile } from "@/components/ui/data";
import type { Unit, Version } from "@/lib/weekplan/contract";
import { VERSION_LABEL } from "@/lib/weekplan/contract";
import { delta, num, pct, share } from "@/lib/weekplan/format";
import { METRIC_TITLE, type Figure, type ItemRow } from "@/lib/weekplan/view";

/** Переключатель ссылками: активный пункт отмечен для экранного диктора */
export function LinkSegment({ label, items, testId }: { label: string; items: { href: string; label: string; active: boolean; testId?: string }[]; testId?: string }) {
  return (
    <nav aria-label={label} className="sv-segment max-w-full flex-wrap self-start" data-testid={testId}>
      {items.map((i) => (
        <Link key={i.href + i.label} href={i.href} className={cn("sv-segment__item", i.active && "is-active")} aria-current={i.active ? "page" : undefined} data-testid={i.testId}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Плитка: факт недели, рядом план выбранной версии и вторая версия с отклонением */
export function FigureTile({ label, figure, unit, base, testId }: { label: string; figure: Figure; unit: Unit; base: Version; testId?: string }) {
  const alt: Version = base === "BUD" ? "LRF" : "BUD";
  return (
    <StatTile
      label={label}
      value={figure.fact === null ? "нет факта" : num(figure.fact, unit)}
      unit={figure.fact === null ? undefined : unit === "шт" ? "шт" : "млн ₽"}
      testId={testId}
      compare={[
        { label: VERSION_LABEL[base], value: num(figure.plan, unit), delta: delta(figure.fact, figure.plan, figure.vsPlan, unit), deltaLabel: `${label}: факт к плану ${VERSION_LABEL[base]}` },
        { label: VERSION_LABEL[alt], value: num(figure.other, unit), delta: delta(figure.fact, figure.other, figure.vsOther, unit), deltaLabel: `${label}: факт к плану ${VERSION_LABEL[alt]}` },
      ]}
      note={
        <>
          Месяц к дате {share(figure.mtd === null ? null : figure.mtd + 1)}, прогноз месяца {num(figure.forecast, unit)} из {num(figure.monthPlan, unit)}
          {figure.vsYear !== null ? `, к прошлому году ${pct(figure.vsYear)}` : ""}
          {figure.partial ? ". Факт есть не по всем строкам" : ""}
        </>
      }
    />
  );
}

/** Ячейки показателя: факт, план, к плану */
function MetricCells({ cell, label }: { cell: ItemRow["cells"][string] | undefined; label: string }) {
  if (!cell) {
    return (
      <>
        <td className="is-num" data-label={`${label}: факт`}>
          —
        </td>
        <td className="is-num" data-label={`${label}: план`}>
          —
        </td>
        <td className="is-num" data-label={`${label}: к плану`}>
          —
        </td>
      </>
    );
  }
  const f = cell.figure;
  return (
    <>
      <td className="is-num" data-label={`${label}: факт`}>
        {num(f.fact, cell.unit)}
      </td>
      <td className="is-num" data-label={`${label}: план`}>
        {num(f.plan, cell.unit)}
      </td>
      <td className="is-num" data-label={`${label}: к плану`}>
        {f.vsPlan === null ? "—" : <DeltaView value={{ text: pct(f.vsPlan), pct: null, sign: Math.abs(f.vsPlan) < 0.0005 ? 0 : f.vsPlan > 0 ? 1 : -1 }} label={`${label}: к плану`} />}
      </td>
    </>
  );
}

/**
 * Таблица среза: позиция в строке, по каждому показателю факт, план и отклонение. total: строка итога в конце (сумма
 * позиций), shareOf: доля позиции в факте этого показателя (страховые)
 */
export function ItemTable({
  caption,
  head,
  metrics,
  rows,
  total,
  shareOf,
  testId,
}: {
  caption: string;
  head: string;
  metrics: string[];
  rows: ItemRow[];
  total?: ItemRow | null;
  shareOf?: string;
  testId?: string;
}) {
  const sumFact = shareOf ? rows.reduce((s, r) => s + (r.cells[shareOf]?.figure.fact ?? 0), 0) : 0;
  const line = (r: ItemRow, isTotal = false) => (
    <tr key={r.key} className={isTotal ? "sv-datatable__row--total font-semibold" : undefined} data-testid={isTotal ? `${testId}-total` : `${testId}-row`}>
      <td className="is-wide">{r.name}</td>
      {metrics.map((m) => (
        <MetricCells key={m} cell={r.cells[m]} label={METRIC_TITLE[m] ?? m} />
      ))}
      {shareOf ? (
        <td className="is-num" data-label="Доля в факте">
          {!isTotal && sumFact > 0 && r.cells[shareOf]?.figure.fact != null ? share(r.cells[shareOf]!.figure.fact! / sumFact) : isTotal && sumFact > 0 ? "100,0%" : "—"}
        </td>
      ) : null}
    </tr>
  );
  return (
    <div className="sv-table-scroll rounded-card border border-border" tabIndex={0} role="region" aria-label="Таблица, на узком экране прокручивается вбок">
      <table className="sv-datatable sv-datatable--sticky-first" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{head}</th>
            {metrics.map((m) => (
              <MetricHead key={m} title={METRIC_TITLE[m] ?? m} />
            ))}
            {shareOf ? (
              <th scope="col" className="is-num">
                Доля в факте
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => line(r))}
          {total ? line(total, true) : null}
        </tbody>
      </table>
    </div>
  );
}

function MetricHead({ title }: { title: string }) {
  return (
    <>
      <th scope="col" className="is-num">
        {title}: факт
      </th>
      <th scope="col" className="is-num">
        план
      </th>
      <th scope="col" className="is-num">
        к плану
      </th>
    </>
  );
}

export type ProductRow = { code: string; name: string; href: string; unit: Unit; figure: Figure | null };

/** Таблица продуктов на «Итоге»: факт, план, отклонение, вторая версия, месяц к дате, прогноз и план месяца */
export function ProductsTable({ rows, base, metricLabel }: { rows: ProductRow[]; base: Version; metricLabel: string }) {
  const alt: Version = base === "BUD" ? "LRF" : "BUD";
  return (
    <div className="sv-table-scroll rounded-card border border-border" tabIndex={0} role="region" aria-label="Таблица, на узком экране прокручивается вбок">
      <table className="sv-datatable sv-datatable--sticky-first" data-testid="weekplan-products">
        <caption className="sr-only">Продукты: {metricLabel.toLowerCase()} недели против плана, месяц к дате и прогноз месяца</caption>
        <thead>
          <tr>
            <th scope="col">Продукт</th>
            <th scope="col" className="is-num">
              Факт
            </th>
            <th scope="col" className="is-num">
              {VERSION_LABEL[base]}
            </th>
            <th scope="col" className="is-num">
              К плану
            </th>
            <th scope="col" className="is-num">
              {VERSION_LABEL[alt]}
            </th>
            <th scope="col" className="is-num">
              Месяц к дате
            </th>
            <th scope="col" className="is-num">
              Прогноз месяца
            </th>
            <th scope="col" className="is-num">
              План месяца
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} data-testid="weekplan-product-row">
              <td className="is-wide">
                <Link href={r.href} className="font-semibold text-link underline-offset-2 hover:underline">
                  {r.name}
                </Link>
                {r.unit === "шт" ? null : <span className="sv-datatable__hint">млн ₽</span>}
              </td>
              {r.figure ? (
                <>
                  <td className="is-num" data-label="Факт">
                    {num(r.figure.fact, r.unit)}
                  </td>
                  <td className="is-num" data-label={VERSION_LABEL[base]}>
                    {num(r.figure.plan, r.unit)}
                  </td>
                  <td className="is-num" data-label="К плану">
                    {r.figure.vsPlan === null ? "—" : <DeltaView value={{ text: pct(r.figure.vsPlan), pct: null, sign: r.figure.vsPlan > 0.0005 ? 1 : r.figure.vsPlan < -0.0005 ? -1 : 0 }} label={`${r.name}: к плану`} />}
                  </td>
                  <td className="is-num" data-label={VERSION_LABEL[alt]}>
                    {num(r.figure.other, r.unit)}
                  </td>
                  <td className="is-num" data-label="Месяц к дате">
                    {share(r.figure.mtd === null ? null : r.figure.mtd + 1)}
                  </td>
                  <td className="is-num" data-label="Прогноз месяца">
                    {num(r.figure.forecast, r.unit)}
                  </td>
                  <td className="is-num" data-label="План месяца">
                    {num(r.figure.monthPlan, r.unit)}
                  </td>
                </>
              ) : (
                <td className="is-num" colSpan={7}>
                  нет строки «{metricLabel.toLowerCase()}» у продукта
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Строки только по месяцам: план месяца двух версий, факта по неделям у них нет */
export function MonthOnlyTable({ rows, monthLabel }: { rows: { id: string; label: string; unit: Unit; bud: number | null; lrf: number | null }[]; monthLabel: string }) {
  return (
    <div className="sv-table-scroll rounded-card border border-border" tabIndex={0} role="region" aria-label="Таблица, на узком экране прокручивается вбок">
      <table className="sv-datatable sv-datatable--sticky-first" data-testid="weekplan-month-only">
        <caption className="sr-only">Строки только по месяцам: план на {monthLabel}</caption>
        <thead>
          <tr>
            <th scope="col">Строка</th>
            <th scope="col" className="is-num">
              Бюджет
            </th>
            <th scope="col" className="is-num">
              LRF
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="is-wide">{r.label}</td>
              <td className="is-num" data-label="Бюджет">
                {num(r.bud, r.unit)}
              </td>
              <td className="is-num" data-label="LRF">
                {num(r.lrf, r.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
