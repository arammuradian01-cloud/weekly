"use client";

// Графики раздела «Рынок», новая версия (этап 79). Свои SVG на классах дизайн-системы, по правилам навыка dataviz:
// одна шкала, тонкие столбики (не толще 24 px) со скруглённым краем данных и прямым основанием, линии 2 px, точки
// от 8 px, сетка волосяной линией, подпись выборочно (последнее значение), легенда при двух рядах и больше, подсказка
// при наведении и касании (у столбиков цель вся колонка, у линий перекрестие по ближайшему месяцу), то же с
// клавиатуры стрелками. Каждый график можно открыть таблицей. Цвета рядов только переменными --mk-*, текст в
// токенах текста. Тексты подписей приходят данными и ставятся текстом React, без разметки.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// ---------- Общее ----------

/** Ширина элемента: график рисуется в настоящую ширину, текст не растягивается */
export function useWidth<T extends HTMLElement>(initial = 640): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const v = Math.round(entry!.contentRect.width);
      if (v > 0) setW(Math.max(260, v));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Шкала с круглыми делениями: шаг 1, 2, 2,5 или 5 на степень десяти */
export function niceScale(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12)));
  return { lo, hi, ticks };
}

/** Какие подписи оси показывать: не теснее minGap px, последняя всегда */
export function axisEvery(n: number, width: number, minGap = 46): (i: number) => boolean {
  const k = Math.ceil(n / Math.max(2, Math.floor(width / minGap)));
  return (i) => (n - 1 - i) % k === 0;
}

export type TipLine = { text: string; color?: string };
export type LegendItem = { label: string; color: string; kind?: "box" | "line" | "partial" };

export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="mk-legend">
      {items.map((it) => (
        <li key={it.label}>
          <i className={cn(it.kind === "line" && "is-line", it.kind === "partial" && "is-partial")} style={it.kind === "partial" ? undefined : { background: it.color }} aria-hidden="true" />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Подсказка и активный столбик: мышь показывает по наведению, палец по касанию (повторное касание прячет), стрелки
 * двигают по точкам, когда график в фокусе
 */
function useActive(n: number) {
  const [active, setActive] = useState<number | null>(null);
  const touch = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active === null || !touch.current) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setActive(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [active]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!n) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setActive((a) => {
        const cur = a ?? n - 1;
        return e.key === "ArrowRight" ? Math.min(n - 1, cur + 1) : Math.max(0, cur - 1);
      });
    } else if (e.key === "Escape") setActive(null);
  };
  const boxProps = {
    ref: box,
    tabIndex: 0,
    onKeyDown,
    onFocus: () => setActive((a) => a ?? (n ? n - 1 : null)),
    onBlur: () => setActive(null),
    onPointerDown: (e: React.PointerEvent) => (touch.current = e.pointerType !== "mouse"),
    onPointerLeave: (e: React.PointerEvent) => e.pointerType === "mouse" && setActive(null),
  };
  const hover = (i: number) => ({
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && setActive(i),
    onClick: () => touch.current && setActive((a) => (a === i ? null : i)),
  });
  return { active, setActive, boxProps, hover, touch };
}

/** Подсказка над графиком: не выходит за его края */
function Tip({ x, width, title, lines }: { x: number; width: number; title: string; lines: TipLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setTw(ref.current.offsetWidth);
  }, [title, lines.length]);
  const half = Math.min(tw, width) / 2;
  return (
    <div ref={ref} className="sv-tooltip sv-tooltip--top mk-tip" style={{ left: `${Math.min(width - half, Math.max(half, x))}px` }} aria-hidden="true">
      <b>{title}</b>
      {lines.map((l, i) => (
        <span key={i}>
          {l.color ? <i style={{ background: l.color }} /> : null}
          {l.text}
        </span>
      ))}
    </div>
  );
}

export type TableData = { head: string[]; rows: { key: string; cells: string[] }[]; caption: string };

/** Простая таблица данных графика: первая колонка подписи, остальные числа */
export function DataTable({ data, className }: { data: TableData; className?: string }) {
  return (
    <div className={cn("mk-scroll", className)}>
      <table className="mk-table">
        <caption className="sr-only">{data.caption}</caption>
        <thead>
          <tr>
            {data.head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((c, i) =>
                i === 0 ? (
                  <th key={i} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={i} className="mk-cell">
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Рамка графика: подпись для экранного диктора, легенда, кнопка «Таблицей» и подпись-вывод под графиком */
export function Figure({ label, legend, table, note, children, testId }: { label: string; legend?: LegendItem[]; table?: TableData; note?: string | null; children: React.ReactNode; testId?: string }) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure className="mk-fig" aria-labelledby={`${id}-l`} data-testid={testId}>
      <figcaption id={`${id}-l`} className="sr-only">
        {label}
      </figcaption>
      {legend?.length || table ? (
        <div className="mk-fig__head">
          {!asTable && legend ? <Legend items={legend} /> : <span />}
          {table ? (
            <button type="button" className="mk-fig__toggle" onClick={() => setAsTable((t) => !t)} aria-pressed={asTable}>
              {asTable ? "Графиком" : "Таблицей"}
            </button>
          ) : null}
        </div>
      ) : null}
      {asTable && table ? <DataTable data={table} /> : children}
      {note ? <p className="mk-note">{note}</p> : null}
    </figure>
  );
}

// ---------- Столбики ----------

export type Column = {
  key: string;
  /** Подпись оси */
  axis: string;
  /** Заголовок подсказки */
  title: string;
  value: number | null;
  /** Значение год назад: серая линия поверх столбиков */
  prev?: number | null;
  /** Неполный период: бледный столбик с обводкой */
  partial?: boolean;
  /** Цвет столбика: по умолчанию первый ряд */
  color?: string;
  tip?: string[];
};

const H_COL = 200;

/** Столбики по периодам от нулевой линии (бывают и отрицательные), линия год назад, подпись последнего значения */
export function Columns({ items, format, label, prevLabel = "год назад", height = H_COL }: { items: Column[]; format: (v: number) => string; label: string; prevLabel?: string; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = items.length;
  const { active, boxProps, hover } = useActive(n);
  const vals = items.flatMap((c) => [c.value, c.prev]).filter((v): v is number => typeof v === "number");
  const { lo, hi, ticks } = niceScale(Math.min(0, ...vals), Math.max(0, ...vals));
  const PAD = { l: 56, r: 10, t: 16, b: 24 };
  const plotH = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + plotH * (1 - (v - lo) / (hi - lo || 1));
  const slot = (W - PAD.l - PAD.r) / Math.max(1, n);
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  const bw = Math.max(2, Math.min(24, slot * 0.62));
  const base = y(0);
  const show = axisEvery(n, W - PAD.l - PAD.r);
  const lastIdx = items.map((c, i) => (c.value !== null && !c.partial ? i : -1)).filter((i) => i >= 0).pop() ?? -1;
  const bar = (i: number, v: number) => {
    const x0 = cx(i) - bw / 2;
    const top = y(Math.max(0, v));
    const bottom = y(Math.min(0, v));
    const h = Math.max(1, bottom - top);
    const r = Math.min(4, h, bw / 2);
    // Скругление только у края данных: сверху у положительного, снизу у отрицательного
    return v >= 0
      ? `M${x0} ${top + h}V${top + r}Q${x0} ${top} ${x0 + r} ${top}H${x0 + bw - r}Q${x0 + bw} ${top} ${x0 + bw} ${top + r}V${top + h}Z`
      : `M${x0} ${top}V${top + h - r}Q${x0} ${top + h} ${x0 + r} ${top + h}H${x0 + bw - r}Q${x0 + bw} ${top + h} ${x0 + bw} ${top + h - r}V${top}Z`;
  };
  const prevPts = items.map((c, i) => (typeof c.prev === "number" ? `${cx(i).toFixed(1)} ${y(c.prev).toFixed(1)}` : null));
  const prevPath = prevPts.map((p, i) => (p ? `${i === 0 || !prevPts[i - 1] ? "M" : "L"}${p}` : "")).join(" ");
  const a = active !== null ? items[active] : null;
  return (
    <div ref={ref} className="mk-plot" {...boxProps} role="group" aria-label={`${label}. Стрелки влево и вправо: значения по периодам`}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "mk-zero" : "mk-gridline"} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="mk-axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {items.map((c, i) =>
          c.value === null ? null : (
            <path
              key={c.key}
              d={bar(i, c.value)}
              className={cn(active !== null && active !== i && "mk-dim")}
              style={c.partial ? { fill: `color-mix(in srgb, ${c.color ?? "var(--mk-1)"} 30%, transparent)`, stroke: c.color ?? "var(--mk-1)", strokeWidth: 1.5 } : { fill: c.color ?? "var(--mk-1)" }}
            />
          ),
        )}
        {prevPath.trim() ? <path d={prevPath} fill="none" stroke="var(--mk-ref)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" /> : null}
        {lastIdx >= 0 && active === null ? (
          <text className="mk-label" x={Math.min(W - PAD.r, Math.max(PAD.l, cx(lastIdx)))} y={items[lastIdx]!.value! >= 0 ? y(items[lastIdx]!.value!) - 6 : y(items[lastIdx]!.value!) + 14} textAnchor={cx(lastIdx) > W - 40 ? "end" : "middle"}>
            {format(items[lastIdx]!.value!)}
          </text>
        ) : null}
        {items.map((c, i) =>
          show(i) ? (
            <text key={c.key} className="mk-axis" x={cx(i)} y={height - 6} textAnchor="middle">
              {c.axis}
            </text>
          ) : null,
        )}
        {items.map((c, i) => (
          <rect key={c.key} className="mk-hit" x={PAD.l + slot * i} y={0} width={slot} height={height} {...hover(i)} aria-hidden="true" />
        ))}
      </svg>
      {a ? (
        <Tip
          x={cx(active!)}
          width={W}
          title={a.title}
          lines={[...(a.value !== null ? [{ text: format(a.value), color: a.color ?? "var(--mk-1)" }] : []), ...(typeof a.prev === "number" ? [{ text: `${prevLabel}: ${format(a.prev)}`, color: "var(--mk-ref)" }] : []), ...(a.tip ?? []).map((t) => ({ text: t }))]}
        />
      ) : null}
    </div>
  );
}

// ---------- Линии ----------

export type Series = { key: string; name: string; values: (number | null)[]; color: string; width?: number; /** Подписать последнее значение */ label?: boolean };

/** Линии по общей оси: перекрестие по ближайшей точке, подсказка со всеми рядами */
export function Lines({
  x,
  series,
  format,
  label,
  height = 220,
  reference,
  zero = false,
  extraTip,
}: {
  /** Подписи оси и заголовки подсказки */
  x: { axis: string; title: string }[];
  series: Series[];
  format: (v: number) => string;
  label: string;
  height?: number;
  /** Опорная линия (например, индекс 1) */
  reference?: number;
  /** Шкала от нуля */
  zero?: boolean;
  extraTip?: (i: number) => string[];
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = x.length;
  const { active, setActive, boxProps, touch } = useActive(n);
  const vals = series.flatMap((s) => s.values).filter((v): v is number => typeof v === "number");
  if (reference !== undefined) vals.push(reference);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
  const { lo, hi, ticks } = niceScale(zero ? Math.min(0, min) : min - pad, max + pad);
  const labelled = series.some((s) => s.label);
  const PAD = { l: 56, r: labelled ? 52 : 14, t: 14, b: 24 };
  const plotH = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + plotH * (1 - (v - lo) / (hi - lo || 1));
  const step = n > 1 ? (W - PAD.l - PAD.r) / (n - 1) : 0;
  const cx = (i: number) => (n > 1 ? PAD.l + step * i : (PAD.l + W - PAD.r) / 2);
  const show = axisEvery(n, W - PAD.l - PAD.r);
  const path = (vs: (number | null)[]) =>
    vs
      .map((v, i) => (v === null ? null : `${cx(i).toFixed(1)} ${y(v).toFixed(1)}`))
      .map((p, i, arr) => (p ? `${i === 0 || !arr[i - 1] ? "M" : "L"}${p}` : ""))
      .join(" ");
  const nearest = (clientX: number, el: SVGRectElement) => {
    const r = el.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * (W - PAD.l - PAD.r);
    return Math.max(0, Math.min(n - 1, Math.round(px / (step || 1))));
  };
  const onMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      if (e.pointerType === "mouse") setActive(nearest(e.clientX, e.currentTarget));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [W, n, step],
  );
  // Подписи концов линий раздвигаются, чтобы не налезать друг на друга
  const ends = series
    .filter((s) => s.label)
    .map((s) => {
      const i = s.values.map((v, k) => (v === null ? -1 : k)).filter((k) => k >= 0).pop() ?? -1;
      return i < 0 ? null : { key: s.key, x: cx(i), y: y(s.values[i]!), text: format(s.values[i]!) };
    })
    .filter((e): e is { key: string; x: number; y: number; text: string } => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i]!.y - ends[i - 1]!.y < 13) ends[i]!.y = ends[i - 1]!.y + 13;
  return (
    <div ref={ref} className="mk-plot" {...boxProps} role="group" aria-label={`${label}. Стрелки влево и вправо: значения по точкам`}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="mk-gridline" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="mk-axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {reference !== undefined ? <line className="mk-zero" x1={PAD.l} x2={W - PAD.r} y1={y(reference)} y2={y(reference)} /> : null}
        {active !== null ? <line className="mk-cross" x1={cx(active)} x2={cx(active)} y1={PAD.t} y2={height - PAD.b} /> : null}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const i = active ?? s.values.map((v, k) => (v === null ? -1 : k)).filter((k) => k >= 0).pop() ?? -1;
          const v = i >= 0 ? s.values[i] : null;
          if (v === null || v === undefined || (active === null && !s.label)) return null;
          return <circle key={s.key} cx={cx(i)} cy={y(v)} r={4} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />;
        })}
        {active === null
          ? ends.map((e) => (
              <text key={e.key} className="mk-label" x={Math.min(e.x + 8, W - 2)} y={e.y + 4} textAnchor={e.x + 8 > W - PAD.r ? "end" : "start"}>
                {e.text}
              </text>
            ))
          : null}
        {x.map((p, i) =>
          show(i) ? (
            <text key={i} className="mk-axis" x={cx(i)} y={height - 6} textAnchor="middle">
              {p.axis}
            </text>
          ) : null,
        )}
        <rect
          className="mk-hit"
          x={PAD.l - 6}
          y={0}
          width={W - PAD.l - PAD.r + 12}
          height={height}
          onPointerMove={onMove}
          onClick={(e) => {
            if (!touch.current) return;
            const i = nearest(e.clientX, e.currentTarget);
            setActive((a) => (a === i ? null : i));
          }}
          aria-hidden="true"
        />
      </svg>
      {active !== null ? (
        <Tip
          x={cx(active)}
          width={W}
          title={x[active]!.title}
          lines={[
            ...series.map((s) => ({ text: `${s.name}: ${typeof s.values[active] === "number" ? format(s.values[active]!) : "-"}`, color: s.color })),
            ...(extraTip ? extraTip(active).map((t) => ({ text: t })) : []),
          ]}
        />
      ) : null}
    </div>
  );
}

// ---------- Столбики из частей ----------

export type StackPart = { key: string; label: string; color: string };

/** Столбики из частей по периодам: положительные части вверх, отрицательные вниз; точка поверх (итог) */
export function Stacks({
  x,
  parts,
  values,
  format,
  tipFormat,
  label,
  height = 240,
  dot,
  max,
}: {
  x: { axis: string; title: string }[];
  parts: StackPart[];
  /** values[i][k]: часть k периода i */
  values: (number | null)[][];
  format: (v: number) => string;
  tipFormat?: (v: number, partIndex: number, i: number) => string;
  label: string;
  height?: number;
  dot?: { label: string; values: (number | null)[] };
  /** Верх шкалы (доли: 1) */
  max?: number;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const n = x.length;
  const { active, boxProps, hover } = useActive(n);
  const pos = values.map((r) => r.reduce<number>((s, v) => s + Math.max(0, v ?? 0), 0));
  const neg = values.map((r) => r.reduce<number>((s, v) => s + Math.min(0, v ?? 0), 0));
  const dots = dot?.values.filter((v): v is number => typeof v === "number") ?? [];
  const { lo, hi, ticks } = niceScale(Math.min(0, ...neg, ...dots), max ?? Math.max(0, ...pos, ...dots));
  const PAD = { l: 56, r: 10, t: 12, b: 24 };
  const plotH = height - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + plotH * (1 - (v - lo) / (hi - lo || 1));
  const slot = (W - PAD.l - PAD.r) / Math.max(1, n);
  const cx = (i: number) => PAD.l + slot * i + slot / 2;
  const bw = Math.max(2, Math.min(24, slot * 0.7));
  const show = axisEvery(n, W - PAD.l - PAD.r);
  return (
    <div ref={ref} className="mk-plot" {...boxProps} role="group" aria-label={`${label}. Стрелки влево и вправо: значения по периодам`}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "mk-zero" : "mk-gridline"} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="mk-axis" x={PAD.l - 6} y={y(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {values.map((row, i) => {
          let up = 0;
          let down = 0;
          return (
            <g key={i} className={cn(active !== null && active !== i && "mk-dim")}>
              {row.map((v, k) => {
                if (!v) return null;
                const from = v >= 0 ? up : down;
                const to = from + v;
                if (v >= 0) up = to;
                else down = to;
                const top = y(Math.max(from, to));
                const h = Math.abs(y(from) - y(to));
                return <rect key={parts[k]!.key} className="mk-seg" x={cx(i) - bw / 2} y={top} width={bw} height={Math.max(0, h)} style={{ fill: parts[k]!.color }} />;
              })}
            </g>
          );
        })}
        {dot
          ? dot.values.map((v, i) => (typeof v === "number" ? <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill="var(--color-text)" stroke="var(--color-surface)" strokeWidth={2} /> : null))
          : null}
        {x.map((p, i) =>
          show(i) ? (
            <text key={i} className="mk-axis" x={cx(i)} y={height - 6} textAnchor="middle">
              {p.axis}
            </text>
          ) : null,
        )}
        {x.map((p, i) => (
          <rect key={i} className="mk-hit" x={PAD.l + slot * i} y={0} width={slot} height={height} {...hover(i)} aria-hidden="true" />
        ))}
      </svg>
      {active !== null ? (
        <Tip
          x={cx(active)}
          width={W}
          title={x[active]!.title}
          lines={[
            ...(dot && typeof dot.values[active] === "number" ? [{ text: `${dot.label}: ${(tipFormat ?? format)(dot.values[active]!, -1, active)}`, color: "var(--color-text)" }] : []),
            ...parts.map((p, k) => ({ text: `${p.label}: ${typeof values[active]![k] === "number" ? (tipFormat ?? format)(values[active]![k]!, k, active) : "-"}`, color: p.color })),
          ]}
        />
      ) : null}
    </div>
  );
}

// ---------- Мини-график ----------

/** Мини-график плитки: последние 12 значений, линия первого ряда и точка на последнем */
export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || 1e-6;
  const x = (i: number) => 3 + ((W - 8) * i) / (values.length - 1);
  const y = (v: number) => H - 3 - ((H - 6) * (v - (min - pad))) / (max + pad - (min - pad));
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--mk-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={2.5} fill="var(--mk-1)" />
    </svg>
  );
}

// ---------- Полосы ----------

export type BarRow = { key: string; label: string; cur: number; prev: number | null; accent?: boolean; value: React.ReactNode };

/** Полосы «этот год» с тонкой полосой «год назад» под ней и подписью значения */
export function BarList({ rows, label }: { rows: BarRow[]; label: string }) {
  const max = Math.max(1e-9, ...rows.map((r) => Math.max(r.cur, r.prev ?? 0)));
  return (
    <ul className="mk-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span>{r.label}</span>
          <span className="mk-bars__track" aria-hidden="true">
            <span className={cn("mk-bars__cur", r.accent && "is-accent")} style={{ width: `${(100 * Math.max(0, r.cur)) / max}%` }} />
            {r.prev !== null ? <span className="mk-bars__prev" style={{ width: `${(100 * Math.max(0, r.prev)) / max}%` }} /> : null}
          </span>
          <span className="mk-bars__val">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
