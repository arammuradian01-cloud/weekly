// Прогноз месяца по драйверам (этап 32): что сервер отдаёт экрану

import type { ForecastReasonCode } from "@/lib/forecast/codes";
import type { Values } from "./lrf";
import type { MetricKey, PlanUnit } from "./spec";
import type { Drivers } from "./summary";

export type PlanPerson = { slug: string; name: string };

export type AdjustmentView = {
  id: string;
  product: string;
  productLabel: string;
  metric: MetricKey;
  metricLabel: string;
  unit: PlanUnit;
  /** null: вернули как в LBE */
  value: number | null;
  previous: number | null;
  reason: ForecastReasonCode;
  reasonLabel: string;
  comment: string;
  author: PlanPerson;
  at: string;
};

export type PlanProductData = {
  code: string;
  lbe: Values;
  budget: Values;
  /** Действующие корректировки драйверов */
  drivers: Drivers;
  /** Последняя корректировка каждого драйвера: кто, когда и почему */
  last: Partial<Record<MetricKey, AdjustmentView>>;
  owners: PlanPerson[];
  canAdjust: boolean;
};

export type PlanSource = {
  sourceId: string;
  mode: "google" | "imitation" | "off";
  serviceEmail: string | null;
  pulledAt: string | null;
  pulledBy: string | null;
};

export type MonthPlanView = {
  month: string;
  monthLabel: string;
  /** Месяцы, по которым есть версии, новые сверху */
  months: string[];
  empty: boolean;
  products: PlanProductData[];
  groups: { code: string; lbe: Values; budget: Values }[];
  history: AdjustmentView[];
  canPull: boolean;
  canOwners: boolean;
  /** Источник LRF меняет только владелец */
  canSource: boolean;
  /** Кто я: можно ли мне корректировать хоть что-то */
  canAdjustAny: boolean;
  /** Прошлый месяц: прогноз виден, но не меняется */
  closed: boolean;
  /** Почему нельзя корректировать: месяц закрыт, наблюдатель или общий логин. null: дело в команде продукта */
  adjustHint: string | null;
  source: PlanSource;
};

export type PullPreview = {
  month: string;
  monthLabel: string;
  problems: string[];
  /** Заметки, которые не мешают загрузке: лист больше лимита */
  notes: string[];
  /** Действующие корректировки, у которых поменялся LBE драйвера: после загрузки их стоит проверить */
  changed: { product: string; metric: string; value: string; lbeBefore: string; lbeAfter: string }[];
  /** Можно ли загружать: все листы на месте, строки найдены и у каждого продукта есть выручка */
  ready: boolean;
  products: {
    code: string;
    label: string;
    missing: string[];
    warnings: string[];
    revenue: { lbe: number | null; budget: number | null; before: number | null };
  }[];
  /** Показателей с корректировками за месяц: останутся после загрузки */
  adjustments: number;
};

export type AdjustInput = {
  month: string;
  product: string;
  metric: string;
  /** null: вернуть как в LBE */
  value: number | null;
  /** Какое значение человек видел перед правкой: если с тех пор поменяли, правка не проходит */
  seen: number | null;
  reason: string;
  comment: string;
};
