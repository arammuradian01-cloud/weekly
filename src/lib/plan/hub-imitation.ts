// Имитация хаба «Единая воронка: данные» (этап 58) для тестов и показа без ключа: четыре СК, прошлый месяц целиком и
// текущий нарастающим итогом по вчерашний день, как в настоящем листе (1-го числа строк текущего месяца ещё нет). Цифры
// выдуманные, порядок величин как у ОСАГО

import type { Grid } from "./lrf";
import { HUB_SHEETS, daysIn, factDay } from "./hub";

export const HUB_FAKE_SK: { sk: string; monthly: number; pool: number }[] = [
  { sk: "АльфаСтрахование", monthly: 120_000, pool: 0.3 },
  { sk: "Ингосстрах", monthly: 60_000, pool: 0.05 },
  { sk: "Росгосстрах", monthly: 45_000, pool: 0.1 },
  { sk: "СберСтрахование", monthly: 40_000, pool: 0.08 },
];

const serial = (month: string) => Math.round((Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) - Date.UTC(1899, 11, 30)) / 86_400_000);

/** Листы хаба на день снимка: today это «YYYY-MM-DD» по Москве, prev прошлый месяц */
export function hubImitation(today: string, prev: string): Record<string, Grid> {
  const month = today.slice(0, 7);
  const last = factDay(today);
  const share = last.startsWith(month) ? Number(last.slice(8, 10)) / daysIn(month) : 0;
  const head = ["MONTH", "PARTNER_NAME", "POOL", "WITH_UPSALE", "POLICIES_CNT", "POLICIES_INCOME", "POLICIES_REVENUE_VAT_INCLUDED", "POLICIES_REVENUE_WO_VAT", "UPSALE_INCOME", "UPSALE_REVENUE_VAT_INCLUDED", "UPSALE_REVENUE_WO_VAT"];
  const vse: Grid = [head];
  for (const m of share > 0 ? [prev, month] : [prev]) {
    const k = m === month ? share : 1;
    for (const s of HUB_FAKE_SK) {
      const pool = Math.round(s.monthly * s.pool * k);
      const np = Math.round(s.monthly * (1 - s.pool) * k);
      vse.push([serial(m), s.sk, "False", "False", np, np * 7000, np * 7000 * 0.15, np * 7000 * 0.15 / 1.22, 0, 0, 0]);
      vse.push([serial(m), s.sk, "True", "True", pool, pool * 9000, 0, 0, pool * 2000, pool * 700, pool * 700 / 1.22]);
    }
  }
  const periods = [prev, month, `FY${month.slice(0, 4)}`];
  const plan: Grid = [["Источник: имитация модели ОСАГО по СК"], [], ["СК", "Раздел", "Канал", "Регион", "Код", "Показатель", ...periods]];
  const metric = (sk: string, code: string, label: string, values: number[]) => plan.push([sk, "Воронка", "Все каналы", "Все регионы", code, label, ...values]);
  const totals = { pol: [0, 0, 0], prem: [0, 0, 0], rev: [0, 0, 0] };
  for (const s of HUB_FAKE_SK) {
    // План месяца чуть выше факта прошлого месяца: так ранрейт в имитации видно против плана
    const pol = [s.monthly, Math.round(s.monthly * 1.05), s.monthly * 12];
    const prem = pol.map((p) => (p * 7200) / 1e6);
    const rev = prem.map((p) => p * 0.14);
    metric(s.sk, "pol", "ПОЛИСЫ ОСАГО, всего (без пула + пул)", pol);
    metric(s.sk, "np", "Полисы ОСАГО без пула", pol.map((p) => Math.round(p * (1 - s.pool))));
    metric(s.sk, "pool", "Полисы пула", pol.map((p) => Math.round(p * s.pool)));
    metric(s.sk, "prem_tot", "ПРЕМИЯ ОСАГО всего, млн ₽", prem);
    metric(s.sk, "rev", "ВЫРУЧКА ОСАГО ВСЕГО с EV, млн ₽", rev);
    metric(s.sk, "kv_tot", "СУММА ВСЕХ КВ, % от премии", rev.map((r, i) => r / prem[i]!));
    pol.forEach((v, i) => (totals.pol[i]! += v));
    prem.forEach((v, i) => (totals.prem[i]! += v));
    rev.forEach((v, i) => (totals.rev[i]! += v));
  }
  metric("ИТОГО", "pol", "ПОЛИСЫ ОСАГО, всего (без пула + пул)", totals.pol);
  metric("ИТОГО", "prem_tot", "ПРЕМИЯ ОСАГО всего, млн ₽", totals.prem);
  metric("ИТОГО", "rev", "ВЫРУЧКА ОСАГО ВСЕГО с EV, млн ₽", totals.rev);
  // Строка канала не читается: проверка, что отбор по разделу и каналу работает
  plan.push(["АльфаСтрахование", "Каналы", "b2c", "Все регионы", "pol", "Полисы b2c", 1, 1, 1]);
  return { [HUB_SHEETS.vseSk]: vse, [HUB_SHEETS.skPlan]: plan };
}
