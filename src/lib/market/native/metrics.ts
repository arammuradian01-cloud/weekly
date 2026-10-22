// Показатели «Обзора» рынка (этап 79): название, единица, как показывать значение и изменение, в какую сторону
// хорошо. Те же определения, что в дашборде из пакета: поток (договоры, премии) меняется в процентах к базе, доля
// меняется разницей в процентных пунктах. Общие для сервера и экрана.

import { FORMATS, pct, pp, type FormatKey } from "./format";

export type MetricKind = "flow" | "ratio";
export type MetricDef = {
  /** Название с единицей: «Договоры полного КАСКО ФЛ, тыс.» */
  name: string;
  format: FormatKey;
  kind: MetricKind;
  /** Рост во благо (по умолчанию да): у доли мини-КАСКО и доли пула рост не в нашу пользу */
  goodUp?: boolean;
  /** Мелкая доля: изменение с двумя знаками после запятой */
  small?: boolean;
};

export const KASKO_METRICS = {
  fl_cnt: { name: "Договоры полного КАСКО ФЛ, тыс.", format: "n1", kind: "flow" },
  fl_prem: { name: "Премии полного КАСКО ФЛ, млн руб", format: "n0", kind: "flow" },
  fl_avg: { name: "Средняя премия, тыс. руб", format: "n1", kind: "flow" },
  core_cnt: { name: "Машины от 1 года, тыс.", format: "n1", kind: "flow" },
  new_share: { name: "Доля новых машин", format: "p1", kind: "ratio" },
  top4_share: { name: "Доля топ-4 регионов", format: "p1", kind: "ratio" },
  mini_share: { name: "Доля мини-КАСКО", format: "p1", kind: "ratio", goodUp: false },
  sravni_deals: { name: "Сделки Сравни", format: "n0", kind: "flow" },
  sravni_leads: { name: "Лиды Сравни", format: "n0", kind: "flow" },
  sravni_share: { name: "Доля Сравни", format: "p2", kind: "ratio", small: true },
  sravni_reach: { name: "Охват лидами", format: "p1", kind: "ratio" },
  sravni_cr: { name: "Конверсия лида в сделку", format: "p1", kind: "ratio" },
} as const satisfies Record<string, MetricDef>;

export const OSAGO_METRICS = {
  total: { name: "Весь рынок, тыс. полисов", format: "n0", kind: "flow" },
  wo_short: { name: "Рынок без коротких, тыс. полисов", format: "n0", kind: "flow" },
  relevant: { name: "Доступный рынок, тыс. полисов", format: "n0", kind: "flow" },
  taxi_short: { name: "Короткие полисы такси, тыс.", format: "n0", kind: "flow" },
  gmv: { name: "Премии без коротких, млрд руб", format: "n1", kind: "flow" },
  avg_check: { name: "Средний чек, руб", format: "n0", kind: "flow" },
  agg_cnt: { name: "Продажи агрегаторов, тыс.", format: "n0", kind: "flow" },
  pool_share: { name: "Доля пула", format: "p1", kind: "ratio", goodUp: false },
  eosago_share: { name: "Доля е-ОСАГО", format: "p1", kind: "ratio" },
  short_share: { name: "Доля коротких полисов", format: "p1", kind: "ratio" },
  agg_share: { name: "Доля агрегаторов", format: "p1", kind: "ratio" },
  sravni_policies: { name: "Полисы Сравни, тыс.", format: "n0", kind: "flow" },
  sravni_b2c: { name: "Полисы Сравни b2c, тыс.", format: "n0", kind: "flow" },
  sravni_partners: { name: "Полисы Сравни через партнёров, тыс.", format: "n0", kind: "flow" },
  sravni_agents: { name: "Полисы Сравни через агентов, тыс.", format: "n0", kind: "flow" },
  sravni_avg_check: { name: "Средний чек Сравни, руб", format: "n0", kind: "flow" },
  sravni_share_rel: { name: "Доля Сравни в доступном рынке", format: "p1", kind: "ratio" },
  sravni_share_wo: { name: "Доля Сравни в рынке без коротких", format: "p1", kind: "ratio" },
  sravni_in_agg: { name: "Доля Сравни среди агрегаторов", format: "p1", kind: "ratio" },
  quote_cr: { name: "Конверсия котировки b2c в полис", format: "p1", kind: "ratio" },
  price_gap: { name: "Чек Сравни к рыночному", format: "pct", kind: "ratio", goodUp: false },
} as const satisfies Record<string, MetricDef>;

export type KaskoMetric = keyof typeof KASKO_METRICS;
export type OsagoMetric = keyof typeof OSAGO_METRICS;

/** Название без единицы: «Договоры полного КАСКО ФЛ» */
export const shortName = (def: MetricDef) => def.name.replace(/, (тыс|млн|млрд|руб).*$/, "");

/** Значение показателя для таблиц и матрицы */
export function metricValue(def: MetricDef, v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return FORMATS[def.format](v);
}

/** Изменение: поток в процентах со знаком, доля в процентных пунктах */
export function metricChange(def: MetricDef, v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return def.kind === "flow" ? pct(v) : pp(v, def.small);
}

/** Хорошо, плохо или без изменения: для цвета */
export function tone(v: number | null | undefined, goodUp = true): "good" | "bad" | "flat" {
  if (v === null || v === undefined || Math.abs(v) < 1e-9) return "flat";
  return v > 0 === goodUp ? "good" : "bad";
}
