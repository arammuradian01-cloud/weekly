"use client";

// Блоки «Обзора» рынка в новой версии (этап 79): плитки, «Главное», сравнение месяцев, ключевые цифры по месяцам
// (матрица, график, таблица), сезонность и полосы «из чего состоит рынок». Общие для КАСКО и ОСАГО: показатели и
// ряды приходят моделью с сервера, здесь только показ и переключатели вида (они живут в адресе страницы).

import { Module } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { MON, fixed, monthAxis, monthBefore, monthLong, monthShort, n0, n1, n2, p1, pct, yearAgo, FORMATS } from "@/lib/market/native/format";
import { metricChange, metricValue, shortName, tone, type MetricDef } from "@/lib/market/native/metrics";
import type { SeasonBlock, Tile } from "@/lib/market/native/overview";
import { BarList, Columns, DataTable, Figure, Lines, Sparkline, Stacks, type Column, type Series, type StackPart, type TableData } from "./charts";
import { Seg, useUrlChoice, useUrlValue } from "./state";

type MonthRow = { month: string };
type Defs = Record<string, MetricDef>;
const nv = (r: MonthRow | undefined, k: string): number | null => {
  const v = r ? (r as Record<string, unknown>)[k] : null;
  return typeof v === "number" ? v : null;
};
const TONE_CLASS = { good: "mk-good", bad: "mk-bad", flat: "mk-flat" } as const;

// ---------- Плитки и «Главное» ----------

export function Tiles({ tiles, label }: { tiles: Tile[]; label: string }) {
  return (
    <ul className="mk-tiles" aria-label={label} data-testid="mk-tiles">
      {tiles.map((t) => (
        <li key={t.key} className="mk-tile" data-testid={`mk-tile-${t.key}`}>
          <span className="mk-tile__label">{t.label}</span>
          <span className="mk-tile__value">
            {t.value}
            {t.unit && t.value !== "-" ? <small>{t.unit}</small> : null}
          </span>
          <span className={cn("mk-tile__delta", TONE_CLASS[t.delta.tone])}>{t.delta.text}</span>
          <span className="mk-tile__spark">
            <Sparkline values={t.spark} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Insights({ items }: { items: string[] }) {
  return (
    <Module title="Главное" id="mk-insights">
      {items.length ? (
        <ul className="mk-insights" data-testid="mk-insights">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="mk-note">Для выводов не хватает данных.</p>
      )}
    </Module>
  );
}

// ---------- Сравнение месяцев ----------

export function MonthCompare({ months, metrics, defs, keys, initial }: { months: MonthRow[]; metrics: string[]; defs: Defs; keys: { a: string; b: string }; initial: Record<string, string> }) {
  const list = months.map((m) => m.month);
  const [rawA, setA] = useUrlValue(keys.a, initial[keys.a]);
  const [rawB, setB] = useUrlValue(keys.b, initial[keys.b]);
  if (!list.length) return null;
  const a = rawA && list.includes(rawA) ? rawA : list.at(-1)!;
  let b = rawB && list.includes(rawB) && rawB !== a ? rawB : null;
  if (!b) b = list.includes(yearAgo(a)) ? yearAgo(a) : list[Math.max(0, list.indexOf(a) - 1)]!;
  const ra = months.find((m) => m.month === a);
  const rb = months.find((m) => m.month === b);
  const options = list.slice().reverse();
  const quick = (kind: "y" | "m") => {
    const target = kind === "y" ? yearAgo(a) : monthBefore(a);
    setB(target);
  };
  const quickValue = b === yearAgo(a) ? "y" : b === monthBefore(a) ? "m" : "";
  return (
    <Module
      title="Сравнение месяцев"
      id="mk-compare"
      actions={
        <div className="mk-bar">
          <label>
            Месяц
            <select className="sv-control sv-control--sm" value={a} onChange={(e) => setA(e.target.value)} data-testid="mk-compare-a">
              {options.map((m) => (
                <option key={m} value={m}>
                  {monthLong(m)}
                </option>
              ))}
            </select>
          </label>
          <label>
            с
            <select className="sv-control sv-control--sm" value={b} onChange={(e) => setB(e.target.value)} data-testid="mk-compare-b">
              {options.map((m) => (
                <option key={m} value={m}>
                  {monthLong(m)}
                </option>
              ))}
            </select>
          </label>
          <Seg
            label="Быстрый выбор"
            value={quickValue as "y" | "m"}
            onChange={quick}
            options={[
              { value: "y", label: "Тот же месяц год назад", disabled: !list.includes(yearAgo(a)) },
              { value: "m", label: "Предыдущий месяц", disabled: !list.includes(monthBefore(a)) },
            ]}
          />
        </div>
      }
    >
      <div className="mk-cmp" data-testid="mk-compare">
        <div className="mk-cmp__row mk-cmp__row--head">
          <span>Показатель</span>
          <span className="mk-cmp__bars">
            <span className="mk-legend">
              <span className="inline-flex items-center gap-1.5">
                <i style={{ background: "var(--mk-1)" }} aria-hidden="true" />
                {monthLong(a)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <i style={{ background: "var(--mk-muted)" }} aria-hidden="true" />
                {monthLong(b)}
              </span>
            </span>
          </span>
          <span className="mk-cmp__val">Значения</span>
          <span className="mk-cmp__chg">Изменение</span>
        </div>
        {metrics.map((k) => {
          const def = defs[k]!;
          const va = nv(ra, k);
          const vb = nv(rb, k);
          if (va === null && vb === null) return null;
          const max = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0)) || 1;
          const change = va !== null && vb !== null ? (def.kind === "flow" ? (vb ? va / vb - 1 : null) : va - vb) : null;
          return (
            <div key={k} className="mk-cmp__row" data-testid={`mk-compare-${k}`}>
              <span title={def.name}>{shortName(def)}</span>
              <span className="mk-cmp__bars" aria-hidden="true">
                <i style={{ width: `${(100 * Math.abs(va ?? 0)) / max}%`, background: "var(--mk-1)" }} />
                <i style={{ width: `${(100 * Math.abs(vb ?? 0)) / max}%`, background: "var(--mk-muted)" }} />
              </span>
              <span className="mk-cmp__val">
                {metricValue(def, va)} / {metricValue(def, vb)}
              </span>
              <span className={cn("mk-cmp__chg", TONE_CLASS[tone(change, def.goodUp !== false)])}>{metricChange(def, change)}</span>
            </div>
          );
        })}
      </div>
    </Module>
  );
}

// ---------- Ключевые цифры по месяцам ----------

export type TableCol = { field: string; label: string; delta?: boolean; narrow?: boolean };
type View = "mat" | "chart" | "table";
type Cmp = "abs" | "yoy" | "mom";

const CHANGE_WORD = { yoy: "к прошлому году", mom: "к прошлому месяцу" } as const;

/** Фон клетки матрицы: изменение в лучшую сторону синим, в худшую оранжевым, сила по самому сильному в строке */
function heat(v: number | null, max: number, goodUp: boolean): string | undefined {
  if (v === null || !max) return undefined;
  const k = Math.min(1, Math.abs(v) / max);
  return `color-mix(in srgb, ${v >= 0 === goodUp ? "var(--mk-good)" : "var(--mk-bad)"} ${Math.round(8 + 50 * k)}%, var(--color-surface))`;
}

export function MonthlyBlock({
  months,
  matrix,
  defs,
  chartMetrics,
  table,
  keys,
  initial,
  fallbackMetric,
}: {
  months: MonthRow[];
  matrix: string[];
  defs: Defs;
  chartMetrics: { value: string; label: string }[];
  table: TableCol[];
  keys: { view: string; cmp: string; metric: string };
  initial: Record<string, string>;
  fallbackMetric: string;
}) {
  const [view, setView] = useUrlChoice<View>(keys.view, initial[keys.view], ["mat", "chart", "table"], "mat");
  const [rawCmp, setCmp] = useUrlChoice<Cmp>(keys.cmp, initial[keys.cmp], ["abs", "yoy", "mom"], "yoy");
  const [metric, setMetric] = useUrlChoice<string>(keys.metric, initial[keys.metric], chartMetrics.map((m) => m.value), fallbackMetric);
  // В матрице и таблице значения видны всегда, сравнение: к году или к месяцу
  const cmp: Cmp = view !== "chart" && rawCmp === "abs" ? "yoy" : rawCmp;
  const suffix = cmp === "mom" ? "_mom" : "_yoy";
  return (
    <Module
      title="Ключевые цифры по месяцам"
      id="mk-monthly"
      actions={
        <div className="mk-bar">
          <Seg
            label="Вид"
            value={view}
            onChange={setView}
            testId="mk-monthly-view"
            options={[
              { value: "mat", label: "Матрица" },
              { value: "chart", label: "График" },
              { value: "table", label: "Таблица" },
            ]}
          />
          <Seg
            label="С чем сравнивать"
            value={cmp}
            onChange={setCmp}
            testId="mk-monthly-cmp"
            options={[
              { value: "abs", label: "Значения", disabled: view !== "chart" },
              { value: "yoy", label: "К году" },
              { value: "mom", label: "К месяцу" },
            ]}
          />
          {view === "chart" ? (
            <label>
              Показатель
              <select className="sv-control sv-control--sm" value={metric} onChange={(e) => setMetric(e.target.value)} data-testid="mk-monthly-metric">
                {chartMetrics.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      }
    >
      {view === "mat" ? <Matrix months={months} metrics={matrix} defs={defs} suffix={suffix} cmp={cmp === "mom" ? "mom" : "yoy"} /> : null}
      {view === "chart" ? <MonthChart months={months} def={defs[metric]!} metric={metric} cmp={cmp} /> : null}
      {view === "table" ? <MonthTable months={months} defs={defs} cols={table} cmp={cmp === "mom" ? "mom" : "yoy"} /> : null}
    </Module>
  );
}

function Matrix({ months, metrics, defs, suffix, cmp }: { months: MonthRow[]; metrics: string[]; defs: Defs; suffix: string; cmp: "yoy" | "mom" }) {
  const cols = months.filter((r) => metrics.some((k) => nv(r, k) !== null)).slice(-13);
  if (!cols.length) return <p className="mk-note">Нет данных.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="mk-scroll" data-testid="mk-matrix">
        <table className="mk-table">
          <caption className="sr-only">Ключевые цифры по месяцам; цвет клетки: изменение {CHANGE_WORD[cmp]}</caption>
          <thead>
            <tr>
              <th scope="col">Показатель</th>
              {cols.map((r) => (
                <th key={r.month} scope="col">
                  {monthAxis(r.month)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((k) => {
              const def = defs[k]!;
              const mul = def.kind === "flow" ? 1 : 10;
              const max = Math.max(0, ...cols.map((r) => Math.abs(nv(r, k + suffix) ?? 0) * mul));
              return (
                <tr key={k}>
                  <th scope="row" title={def.name}>
                    {shortName(def)}
                  </th>
                  {cols.map((r) => {
                    const ch = nv(r, k + suffix);
                    const v = nv(r, k);
                    return (
                      <td key={r.month} className="mk-cell" style={{ background: heat(ch === null ? null : ch * mul, max, def.goodUp !== false) }} title={`${def.name}, ${monthLong(r.month)}: ${metricValue(def, v)}${ch === null ? "" : `, ${CHANGE_WORD[cmp]} ${metricChange(def, ch)}`}`}>
                        {v === null ? "" : metricValue(def, v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mk-note">Цвет клетки: изменение {CHANGE_WORD[cmp]}. Синий: в лучшую сторону, оранжевый: в худшую, чем насыщеннее, тем сильнее.</p>
    </div>
  );
}

function MonthChart({ months, def, metric, cmp }: { months: MonthRow[]; def: MetricDef; metric: string; cmp: Cmp }) {
  const fmtV = (v: number) => metricValue(def, v);
  if (cmp === "abs") {
    const rows = months.filter((r) => nv(r, metric) !== null);
    if (rows.length < 2) return <p className="mk-note">Мало данных для графика.</p>;
    const by = new Map(months.map((r) => [r.month, nv(r, metric)]));
    const items: Column[] = rows.map((r) => {
      const yoy = nv(r, `${metric}_yoy`);
      return { key: r.month, axis: monthAxis(r.month), title: monthLong(r.month), value: nv(r, metric), prev: by.get(yearAgo(r.month)) ?? null, tip: yoy === null ? [] : [`${CHANGE_WORD.yoy}: ${metricChange(def, yoy)}`] };
    });
    const table: TableData = {
      caption: def.name,
      head: ["Месяц", def.name, "Год назад", "Изменение к прошлому году"],
      rows: items
        .slice()
        .reverse()
        .map((c) => ({ key: c.key, cells: [monthShort(c.key), metricValue(def, c.value), metricValue(def, c.prev), metricChange(def, nv(rows.find((r) => r.month === c.key), `${metric}_yoy`))] })),
    };
    return (
      <Figure
        label={`${def.name} по месяцам, столбики; линия: тот же месяц год назад`}
        legend={[
          { label: def.name, color: "var(--mk-1)" },
          { label: "Тот же месяц год назад", color: "var(--mk-ref)", kind: "line" },
        ]}
        table={table}
        testId="mk-monthly-chart"
      >
        <Columns items={items} format={fmtV} label={def.name} />
      </Figure>
    );
  }
  const key = `${metric}_${cmp}`;
  const rows = months.filter((r) => nv(r, key) !== null);
  if (!rows.length) return <p className="mk-note">Нет периода для сравнения.</p>;
  const goodUp = def.goodUp !== false;
  const items: Column[] = rows.map((r) => {
    const v = nv(r, key)!;
    return { key: r.month, axis: monthAxis(r.month), title: monthLong(r.month), value: v, color: v >= 0 === goodUp ? "var(--mk-good)" : "var(--mk-bad)", tip: [`${shortName(def)}: ${metricValue(def, nv(r, metric))}`] };
  });
  const word = CHANGE_WORD[cmp];
  return (
    <Figure
      label={`${def.name}: изменение ${word} по месяцам`}
      legend={[
        { label: `Лучше, чем ${cmp === "yoy" ? "год назад" : "месяцем раньше"}`, color: "var(--mk-good)" },
        { label: `Хуже, чем ${cmp === "yoy" ? "год назад" : "месяцем раньше"}`, color: "var(--mk-bad)" },
      ]}
      table={{
        caption: `${def.name}: изменение ${word}`,
        head: ["Месяц", def.name, `Изменение ${word}`],
        rows: rows
          .slice()
          .reverse()
          .map((r) => ({ key: r.month, cells: [monthShort(r.month), metricValue(def, nv(r, metric)), metricChange(def, nv(r, key))] })),
      }}
      testId="mk-monthly-chart"
    >
      <Columns items={items} format={(v) => metricChange(def, v)} label={`${def.name}: изменение ${word}`} />
    </Figure>
  );
}

function MonthTable({ months, defs, cols, cmp }: { months: MonthRow[]; defs: Defs; cols: TableCol[]; cmp: "yoy" | "mom" }) {
  const valueCols = cols.filter((c) => !c.delta).map((c) => c.field);
  const rows = months
    .filter((r) => valueCols.some((k) => nv(r, k) !== null))
    .slice()
    .reverse();
  return (
    <div className="mk-scroll" data-testid="mk-month-table">
      <table className="mk-table">
        <caption className="sr-only">Ключевые цифры по месяцам, изменение {CHANGE_WORD[cmp]}</caption>
        <thead>
          <tr>
            <th scope="col">Месяц</th>
            {cols.map((c) => (
              <th key={c.field + (c.delta ? "d" : "")} scope="col" className={cn(c.narrow && "mk-narrow")}>
                {c.delta ? (cmp === "yoy" ? "За год" : "За месяц") : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <th scope="row">{monthShort(r.month)}</th>
              {cols.map((c) => {
                const def = defs[c.field]!;
                if (c.delta) {
                  const v = nv(r, `${c.field}_${cmp}`);
                  return (
                    <td key={c.field + "d"} className={cn("mk-cell", c.narrow && "mk-narrow", v !== null && TONE_CLASS[tone(v, def.goodUp !== false)])}>
                      {metricChange(def, v)}
                    </td>
                  );
                }
                return (
                  <td key={c.field} className={cn("mk-cell", c.narrow && "mk-narrow")}>
                    {metricValue(def, nv(r, c.field))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Сезонность ----------

type SeasonView = "heat" | "index" | "lines";
/** Цвет года: последний синий, предыдущий оранжевый, старше серые; один и тот же во всех видах */
const yearColor = (i: number, n: number) => (i === n - 1 ? "var(--mk-1)" : i === n - 2 ? "var(--mk-2)" : "var(--mk-muted)");

export function SeasonSection<M extends string>({
  seasons,
  units,
  keys,
  initial,
  fallback,
}: {
  seasons: Record<M, SeasonBlock>;
  units: Record<M, { label: string; format: "n0" | "n1"; unit: string }>;
  keys: { metric: string; view: string };
  initial: Record<string, string>;
  fallback: M;
}) {
  const metrics = Object.keys(units) as M[];
  const [metric, setMetric] = useUrlChoice<M>(keys.metric, initial[keys.metric], metrics, fallback);
  const [view, setView] = useUrlChoice<SeasonView>(keys.view, initial[keys.view], ["heat", "index", "lines"], "heat");
  const blk = seasons[metric];
  const u = units[metric];
  const f = FORMATS[u.format];
  const years = blk.season.years;
  const n = years.length;
  const x = MON.map((m, i) => ({ axis: m, title: monthLong(`2000-${String(i + 1).padStart(2, "0")}`).replace(" 2000", "") }));
  return (
    <Module
      title="Сезонность"
      id="mk-season"
      actions={
        <div className="mk-bar">
          <label>
            Показатель
            <select className="sv-control sv-control--sm" value={metric} onChange={(e) => setMetric(e.target.value as M)} data-testid="mk-season-metric">
              {metrics.map((m) => (
                <option key={m} value={m}>
                  {units[m].label}
                </option>
              ))}
            </select>
          </label>
          <Seg
            label="Вид"
            value={view}
            onChange={setView}
            testId="mk-season-view"
            options={[
              { value: "heat", label: "Год и месяц" },
              { value: "index", label: "Индекс сезонности" },
              { value: "lines", label: "Линии по годам" },
            ]}
          />
        </div>
      }
    >
      {!n ? (
        <p className="mk-note">Нет данных.</p>
      ) : view === "heat" ? (
        <div className="flex flex-col gap-2">
          <div className="mk-scroll" data-testid="mk-season-table">
            <table className="mk-table">
              <caption className="sr-only">
                {u.label}, {u.unit}, по годам и месяцам; строка «Индекс»: средний индекс месяца по полным годам
              </caption>
              <thead>
                <tr>
                  <th scope="col">Год</th>
                  {MON.map((m) => (
                    <th key={m} scope="col">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {years.map((y) => (
                  <tr key={y.year}>
                    <th scope="row">{y.year}</th>
                    {y.values.map((v, i) => (
                      <td key={i} className="mk-cell" style={{ background: seasonBg(y.idx[i] ?? null) }} title={v === null ? undefined : `${monthLong(`${y.year}-${String(i + 1).padStart(2, "0")}`)}: ${f(v)} ${u.unit}, индекс ${n2(y.idx[i] ?? null)}`}>
                        {v === null ? "" : f(v)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="mk-sum">
                  <th scope="row" title="Средний индекс по полным годам: 1 = средний месяц">
                    Индекс
                  </th>
                  {blk.season.avgIdx.map((v, i) => (
                    <td key={i} className="mk-cell" style={{ background: seasonBg(v) }}>
                      {v === null ? "" : n2(v)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mk-note">
            Значения в {u.unit}. Цвет: месяц выше среднего месяца своего года синим, ниже оранжевым. Индекс 1: средний месяц.
          </p>
        </div>
      ) : view === "index" ? (
        <Figure
          label={`${u.label}: индекс сезонности по месяцам, линии по годам и средний индекс`}
          legend={[...years.map((y, i) => ({ label: String(y.year), color: yearColor(i, n), kind: "line" as const })), { label: "Средний индекс", color: "var(--mk-ref)", kind: "line" }]}
          table={{
            caption: `${u.label}: индекс сезонности`,
            head: ["Месяц", ...years.map((y) => String(y.year)), "Средний индекс"],
            rows: MON.map((m, i) => ({ key: m, cells: [x[i]!.title, ...years.map((y) => n2(y.idx[i] ?? null)), n2(blk.season.avgIdx[i] ?? null)] })),
          }}
          testId="mk-season-chart"
        >
          <Lines
            x={x}
            series={[
              ...years.map((y, i): Series => ({ key: String(y.year), name: String(y.year), values: y.idx, color: yearColor(i, n), width: i === n - 1 ? 2 : 1.5 })),
              { key: "avg", name: "Средний индекс", values: blk.season.avgIdx, color: "var(--mk-ref)", width: 1.5 },
            ]}
            format={(v) => n2(v)}
            reference={1}
            label={`${u.label}: индекс сезонности`}
          />
        </Figure>
      ) : (
        <Figure
          label={`${u.label}, ${u.unit}: линии по годам`}
          legend={years.map((y, i) => ({ label: String(y.year), color: yearColor(i, n), kind: "line" as const }))}
          table={{
            caption: `${u.label}, ${u.unit}`,
            head: ["Месяц", ...years.map((y) => String(y.year))],
            rows: MON.map((m, i) => ({ key: m, cells: [x[i]!.title, ...years.map((y) => (y.values[i] === null ? "-" : f(y.values[i]!)))] })),
          }}
          testId="mk-season-chart"
        >
          <Lines x={x} series={years.map((y, i): Series => ({ key: String(y.year), name: String(y.year), values: y.values, color: yearColor(i, n), width: i === n - 1 ? 2 : 1.5, label: true }))} format={(v) => f(v)} zero label={`${u.label}, ${u.unit}`} />
        </Figure>
      )}
      <p className="mk-note mt-3" data-testid="mk-season-note">
        {blk.note}
      </p>
    </Module>
  );
}

function seasonBg(idx: number | null): string | undefined {
  if (idx === null) return undefined;
  return `color-mix(in srgb, ${idx >= 1 ? "var(--mk-good)" : "var(--mk-bad)"} ${Math.round(Math.min(50, 220 * Math.abs(idx - 1)))}%, var(--color-surface))`;
}

// ---------- Структура рынка по месяцам ----------

export type MixPart = StackPart & { share: (i: number) => number | null; abs: (i: number) => number };

export function MixSection({ title, months, parts, keys, initial, unitWord }: { title: string; months: string[]; parts: MixPart[]; keys: { view: string }; initial: Record<string, string>; unitWord: string }) {
  const [view, setView] = useUrlChoice<"share" | "abs">(keys.view, initial[keys.view], ["share", "abs"], "share");
  const x = months.map((m) => ({ axis: monthAxis(m), title: monthLong(m) }));
  const values = months.map((_, i) => parts.map((p) => (view === "share" ? (p.share(i) ?? 0) : p.abs(i))));
  return (
    <Module
      title={title}
      id="mk-mix"
      actions={
        <Seg
          label="Вид"
          value={view}
          onChange={setView}
          testId="mk-mix-view"
          options={[
            { value: "share", label: "Доли" },
            { value: "abs", label: unitWord },
          ]}
        />
      }
    >
      {months.length ? (
        <Figure
          label={`${title}: ${view === "share" ? "доли сегментов" : `${unitWord.toLowerCase()}, тыс.`}`}
          legend={parts.map((p) => ({ label: p.label, color: p.color }))}
          table={{
            caption: title,
            head: ["Месяц", ...parts.flatMap((p) => [`${p.label}, доля`, `${p.label}, тыс.`])],
            rows: months
              .map((m, i) => ({ key: m, cells: [monthShort(m), ...parts.flatMap((p) => [p1(p.share(i)), n0(p.abs(i))])] }))
              .reverse(),
          }}
          testId="mk-mix-chart"
        >
          <Stacks
            x={x}
            parts={parts}
            values={values}
            max={view === "share" ? 1 : undefined}
            format={(v) => (view === "share" ? `${fixed(v * 100, 0, false)}%` : n0(v))}
            tipFormat={(_v, k, i) => (k < 0 ? "" : `${p1(parts[k]!.share(i))}, ${n0(parts[k]!.abs(i))} тыс.`)}
            label={title}
          />
        </Figure>
      ) : (
        <p className="mk-note">Нет данных.</p>
      )}
    </Module>
  );
}

// ---------- Из чего состоит рынок ----------

export type ShareItem = { key: string; label: string; cur: number; prev: number; share: number | null; change: number | null };

export function StructureSection({ title, rows, accent, digits, shareWord, colorChange, id }: { title: string; rows: ShareItem[]; accent: (key: string) => boolean; digits: 0 | 1; shareWord: string; colorChange?: boolean; id: string }) {
  const f = digits ? n1 : n0;
  return (
    <Module title={title} id={id} description="С начала года. Тонкая полоса под каждой строкой: те же месяцы год назад.">
      {rows.length ? (
        <BarList
          label={title}
          rows={rows.map((r) => ({
            key: r.key,
            label: r.label,
            cur: r.cur,
            prev: r.prev,
            accent: accent(r.key),
            value: (
              <>
                <b>{f(r.cur)} тыс.</b>, {p1(r.share)} {shareWord}
                {r.change !== null ? (
                  <>
                    , <span className={cn(colorChange && TONE_CLASS[tone(r.change)])}>{pct(r.change)} к прошлому году</span>
                  </>
                ) : null}
              </>
            ),
          }))}
        />
      ) : (
        <p className="mk-note">Нет данных.</p>
      )}
    </Module>
  );
}

export { DataTable };
