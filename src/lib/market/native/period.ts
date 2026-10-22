// Страховые с начала года (этап 79): строки периода «ytd» из расчётов k_sk_v и o_sk_v дашборда. Для «Обзора» нужны
// только они: кто дал рост договоров, тариф и страховая сумма по сегменту. Период «с начала года» есть, только пока
// год не закончился (последний месяц не декабрь); сравнение с теми же месяцами прошлого года.

import { MON } from "./format";
import { monthNum, monthOf, num0, yearNum, type Row } from "./rows";

export type SkYtdRow = {
  item: string;
  total: boolean;
  /** Тыс. договоров (полисов) */
  cnt: number;
  share: number | null;
  avg: number | null;
  avg_ss: number | null;
  rate: number | null;
  /** Изменение к тем же месяцам прошлого года: рост договоров, прирост в тыс., доля, средняя премия, сумма, тариф */
  growth_y: number | null;
  dcnt_y: number | null;
  delta_y: number | null;
  avg_y: number | null;
  avgss_y: number | null;
  rate_y: number | null;
};
export type SkYtd = { label: string; rows: SkYtdRow[] };

type Acc = { cnt: number; prem: number; ss: number; cs: number; ps: number };
const empty = (): Acc => ({ cnt: 0, prem: 0, ss: 0, cs: 0, ps: 0 });
const add = (a: Acc, v: Acc) => {
  a.cnt += v.cnt;
  a.prem += v.prem;
  a.ss += v.ss;
  a.cs += v.cs;
  a.ps += v.ps;
};
const kpis = (a: Acc) => ({ avg: a.cnt && a.prem ? (a.prem * 1e6) / a.cnt : null, avg_ss: a.cs && a.ss ? a.ss / a.cs : null, rate: a.ss ? a.ps / a.ss : null });
const fin = (v: number | null): number | null => (v === null || !Number.isFinite(v) ? null : v);

export const TOTAL_ITEM = "Весь сегмент";

/**
 * Строки «с начала года» по страховым одного сегмента. segment: значение поля segment (или null: все строки одним
 * сегментом, как у ОСАГО); cntMul: множитель поля cnt (у ОСАГО cnt в тысячах). null: периода с начала года нет
 */
export function ytdBySk(rows: Row[], opt: { segment: string | null; cntMul: number }): SkYtd | null {
  const months = [...new Set(rows.map(monthOf))].sort();
  const last = months.at(-1);
  if (!last || !/^\d{4}-\d{2}$/.test(last)) return null;
  const Y = yearNum(last);
  const M = monthNum(last);
  if (M >= 12) return null;
  const curMs = new Set(months.filter((m) => yearNum(m) === Y && monthNum(m) <= M));
  const prevMs = new Set(months.filter((m) => yearNum(m) === Y - 1 && monthNum(m) <= M));
  const hasPrev = prevMs.size > 0;
  const cur = new Map<string, Acc>();
  const prev = new Map<string, Acc>();
  const curTot = empty();
  let prevTot: Acc | null = null;
  // Порядок как в дашборде: месяцы по возрастанию, внутри месяца строки как в наборе (от него зависит порядок равных)
  const byMonth = new Map<string, Row[]>();
  for (const r of rows) {
    const m = monthOf(r);
    if (!curMs.has(m) && !prevMs.has(m)) continue;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(r);
  }
  const ordered = [...curMs, ...prevMs].flatMap((m) => byMonth.get(m) ?? []);
  for (const r of ordered) {
    if (opt.segment !== null && r.segment !== opt.segment) continue;
    const m = monthOf(r);
    const target = curMs.has(m) ? cur : prev;
    const v: Acc = { cnt: Number(r.cnt) * opt.cntMul, prem: num0(r.prem), ss: num0(r.ss), cs: num0(r.cnt_ss), ps: num0(r.prem_ss) };
    const item = String(r.sk ?? "");
    const a = target.get(item) ?? empty();
    add(a, v);
    target.set(item, a);
    if (target === cur) add(curTot, v);
    else add((prevTot ??= empty()), v);
  }
  if (!cur.size) return null;
  const line = (item: string, a: Acc, q: Acc | null, total: boolean): SkYtdRow => {
    const share = curTot.cnt ? a.cnt / curTot.cnt : null;
    const k = kpis(a);
    const qk = q ? kpis(q) : null;
    return {
      item,
      total,
      cnt: a.cnt / 1e3,
      share: fin(share),
      avg: fin(k.avg),
      avg_ss: fin(k.avg_ss),
      rate: fin(k.rate),
      growth_y: fin(q && q.cnt ? a.cnt / q.cnt - 1 : null),
      dcnt_y: hasPrev ? fin((a.cnt - (q ? q.cnt : 0)) / 1e3) : null,
      delta_y: fin(prevTot && prevTot.cnt && share !== null ? share - (q ? q.cnt : 0) / prevTot.cnt : null),
      avg_y: fin(qk && qk.avg && k.avg ? k.avg / qk.avg - 1 : null),
      avgss_y: fin(qk && qk.avg_ss && k.avg_ss ? k.avg_ss / qk.avg_ss - 1 : null),
      rate_y: fin(qk && qk.rate !== null && k.rate !== null ? k.rate - qk.rate : null),
    };
  };
  const out: SkYtdRow[] = [...cur.entries()].map(([item, a]) => line(item, a, hasPrev ? (prev.get(item) ?? null) : null, false));
  out.push(line(TOTAL_ITEM, curTot, hasPrev ? prevTot : null, true));
  return { label: `янв-${MON[M - 1]} ${Y}`, rows: out };
}
