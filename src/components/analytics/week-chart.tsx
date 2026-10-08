"use client";

// График по неделям для аналитики (этап 27). Основа: BarLineChart дизайн-системы (components/charts), плюс то, что
// требуют правила графиков: одна шкала, тонкие столбики со скруглённым верхом, линия 2 px с точками, подсказка при
// наведении и касании, таблица вместо графика, легенда при двух рядах и подпись последнего значения.

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type ChartWeek = { key: string; number: number; current: boolean };

export type WeekChartProps = {
  title: string;
  /** Одна фраза с выводом под графиком */
  insight?: string;
  weeks: ChartWeek[];
  bars?: { label: string; values: (number | null)[] };
  line?: { label: string; values: (number | null)[] };
  /** «%»: шкала до 100 */
  unit?: "%" | "";
  /** Строки подсказки по неделе */
  tip: (index: number) => string[];
  /** Колонки таблицы: заголовок и значение по неделе */
  columns: { label: string; value: (index: number) => string | number }[];
};

/** Ширина по умолчанию до первого замера: дальше график рисуется в настоящую ширину, текст не растягивается */
const W_DEFAULT = 560;
const H = 176;
const PAD_L = 34;
const PAD_R = 8;
const PAD_T = 18;
const PAD_B = 24;

/** Верх шкалы: 1, 2, 4, 5 или 10 на степень десяти */
export function niceMax(value: number): number {
  if (value <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 2, 4, 5, 10]) if (m * pow >= value) return Math.max(4, m * pow);
  return 10 * pow;
}

export function WeekChart({ title, insight, weeks, bars, line, unit = "", tip, columns }: WeekChartProps) {
  const [active, setActive] = useState<number | null>(null);
  // Касание пальцем: подсказка по нажатию (click), а не по началу жеста, чтобы прокрутка страницы её не дёргала
  const touch = useRef(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipW, setTipW] = useState(0);
  const [table, setTable] = useState(false);
  const id = useId();
  const plot = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(W_DEFAULT);
  useEffect(() => {
    const el = plot.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setW(Math.max(240, w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  // Подсказка не выходит за края графика: центр сдвигается на половину её ширины от края (в пикселях, не в процентах)
  useLayoutEffect(() => {
    if (active !== null && tipRef.current) setTipW(tipRef.current.offsetWidth);
  }, [active]);
  const tipLeft = (x: number) => {
    const half = Math.min(tipW, W) / 2;
    return `${Math.min(W - half, Math.max(half, x))}px`;
  };
  // Касание вне графика прячет подсказку
  useEffect(() => {
    if (active === null || !touch.current) return;
    const away = (e: PointerEvent) => {
      if (plot.current && !plot.current.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [active]);
  const n = weeks.length || 1;
  const all = [...(bars?.values ?? []), ...(line?.values ?? [])].filter((v): v is number => v !== null);
  const max = unit === "%" ? 100 : niceMax(Math.max(0, ...all));
  const plotH = H - PAD_T - PAD_B;
  const y = (v: number) => PAD_T + plotH * (1 - v / max);
  const slot = (W - PAD_L - PAD_R) / n;
  const cx = (i: number) => PAD_L + slot * i + slot / 2;
  const bw = Math.min(28, slot * 0.5);
  const ticks = [0, max / 2, max].filter((t) => Number.isInteger(t));
  const base = y(0);

  // Столбик со скруглённым верхом 4 px, низ прямой: стоит на нулевой линии
  const barPath = (i: number, v: number) => {
    const x0 = cx(i) - bw / 2;
    const top = y(v);
    const h = base - top;
    if (h <= 0) return "";
    const r = Math.min(4, h, bw / 2);
    return `M${x0} ${base}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + bw - r}Q${x0 + bw} ${top} ${x0 + bw} ${top + r}V${base}Z`;
  };

  const points = (line?.values ?? []).map((v, i) => (v === null ? null : ([cx(i), y(v)] as const)));
  const path = points.map((p, i) => (p ? `${i === 0 || !points[i - 1] ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}` : "")).join(" ");
  // Подпись только у последнего значения каждого ряда: число на каждой точке перегружает
  const lastIndex = (vals: (number | null)[] | undefined) => (vals ? vals.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop() ?? -1 : -1);
  const lastBar = lastIndex(bars?.values);
  const lastLine = lastIndex(line?.values);
  const series = (bars ? 1 : 0) + (line ? 1 : 0);

  return (
    <figure className="sv-chart m-0" aria-labelledby={`${id}-t`}>
      <div className="flex items-start justify-between gap-3">
        <figcaption id={`${id}-t`} className="sv-chart__title">
          {title}
        </figcaption>
        <button type="button" className="shrink-0 text-small font-medium text-link hover:underline" onClick={() => {
            setActive(null);
            setTable((t) => !t);
          }}
        >
          {table ? "Графиком" : "Таблицей"}
        </button>
      </div>
      {table ? (
        <div className="sv-table-wrap">
          <table className="sv-table">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Неделя</th>
                {columns.map((c) => (
                  <th key={c.label} scope="col" className="is-num">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w.key} className="cursor-default">
                  <td>
                    {w.number}
                    {w.current ? <span className="text-muted">, идёт</span> : null}
                  </td>
                  {columns.map((c) => (
                    <td key={c.label} className="is-num">
                      {c.value(i)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={plot} className="sv-chart__plot" onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)} onPointerDown={(e) => (touch.current = e.pointerType !== "mouse")}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Подробности по неделям в таблице: кнопка «Таблицей»`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="sv-chart__grid" x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} />
                <text className="sv-chart__axis" x={PAD_L - 6} y={y(t) + 4} textAnchor="end">
                  {t}
                  {unit}
                </text>
              </g>
            ))}
            {active !== null ? <line className="sv-chart__cross" x1={cx(active)} x2={cx(active)} y1={PAD_T - 6} y2={base} /> : null}
            {bars?.values.map((v, i) =>
              v === null ? null : (
                <path key={weeks[i].key} d={barPath(i, v)} className={cn("sv-chart__bar", weeks[i].current && "sv-chart__bar--muted", active !== null && active !== i && "is-dim")} />
              ),
            )}
            {/* Линия без столбиков: единственный ряд, цвет первого ряда */}
            {line && path ? <path className={cn("sv-chart__line", !bars && "sv-chart__line--solo")} d={path} /> : null}
            {points.map((p, i) => (p ? <circle key={weeks[i].key} className={cn("sv-chart__dot", !bars && "sv-chart__dot--solo")} cx={p[0]} cy={p[1]} r={active === i ? 5 : 4} /> : null))}
            {bars && lastBar >= 0 ? (
              <text className="sv-chart__value" x={cx(lastBar)} y={y(bars.values[lastBar]!) - 6} textAnchor="middle">
                {bars.values[lastBar]}
                {unit}
              </text>
            ) : null}
            {line && lastLine >= 0 && !(bars && lastBar === lastLine) ? (
              <text className="sv-chart__value" x={cx(lastLine)} y={y(line.values[lastLine]!) - 8} textAnchor="middle">
                {line.values[lastLine]}
                {unit}
              </text>
            ) : null}
            {weeks.map((w, i) => (
              <text key={w.key} className="sv-chart__axis" x={cx(i)} y={H - 6} textAnchor="middle">
                {w.current && slot >= 60 ? `${w.number}, идёт` : w.number}
              </text>
            ))}
            {/* Зона наведения шире столбика: вся колонка недели */}
            {weeks.map((w, i) => (
              <rect
                key={w.key}
                className="sv-chart__hit"
                x={PAD_L + slot * i}
                y={0}
                width={slot}
                height={H}
                // Мышь: подсказка, пока указатель над неделей. Палец: касание показывает, повторное касание прячет
                onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
                onClick={() => touch.current && setActive((a) => (a === i ? null : i))}
                aria-hidden="true"
              />
            ))}
          </svg>
          {active !== null ? (
            <div ref={tipRef} className="sv-tooltip sv-tooltip--top sv-chart__tip" style={{ left: tipLeft(cx(active)) }} aria-hidden="true">
              <b className="block">Неделя {weeks[active].number}{weeks[active].current ? ", идёт" : ""}</b>
              {tip(active).map((t) => (
                <span key={t} className="block">
                  {t}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {series > 1 && !table ? (
        <div className="sv-chart__legend">
          {bars ? (
            <span>
              <i className="sv-chart__swatch-bar" />
              {bars.label}
            </span>
          ) : null}
          {line ? (
            <span>
              <i className="sv-chart__swatch-line" />
              {line.label}
            </span>
          ) : null}
        </div>
      ) : null}
      {insight ? <p className="sv-chart__insight">{insight}</p> : null}
    </figure>
  );
}
