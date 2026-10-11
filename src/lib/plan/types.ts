// Прогноз месяца по драйверам (этап 32): что сервер отдаёт экрану

import type { ForecastReasonCode } from "@/lib/forecast/codes";
import type { Values } from "./lrf";
import type { MetricKey, PlanUnit } from "./spec";
import type { Drivers } from "./summary";
import type { FactMetric } from "./facts";
import type { PartnerChannel, PartnerDrivers, PartnerMetric, PartnerTotalInput, PartnerUnit, PartnerValues } from "./partners";

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

/**
 * Проверка прогноза после загрузки LBE (этап 35): команда продукта скорректировала драйверы или отметила «Прогноз
 * проверен». waiting: после загрузки ни того, ни другого
 */
export type ReviewView = { state: "waiting" | "adjusted" | "checked"; by: string | null; at: string | null; since: string };

export type FactDaily = { day: string; value: number };

/** Факт месяца по дням из отчёта аналитиков (этап 35) */
export type ProductFacts = { daily: Partial<Record<FactMetric, FactDaily[]>>; loadedAt: string; loadedBy: string };

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
  /** null: время загрузки LBE неизвестно */
  review: ReviewView | null;
  facts: ProductFacts | null;
};

/** Корректировка драйвера партнёра (этап 35б) */
export type PartnerAdjustmentView = {
  id: string;
  partner: string;
  partnerLabel: string;
  product: string;
  channel: PartnerChannel;
  metric: PartnerMetric;
  metricLabel: string;
  unit: PartnerUnit;
  value: number | null;
  previous: number | null;
  reason: ForecastReasonCode;
  reasonLabel: string;
  comment: string;
  author: PlanPerson;
  at: string;
};

export type PartnerLineView = {
  code: string;
  label: string;
  product: string;
  channel: PartnerChannel;
  kind: string;
  lbe: PartnerValues;
  drivers: PartnerDrivers;
  last: Partial<Record<PartnerMetric, PartnerAdjustmentView>>;
};

/** Партнёрский канал месяца (этап 35б): партнёры с LBE и корректировками, бюджет канала из P&L b2b */
export type PartnerChannelView = {
  lines: PartnerLineView[];
  totals: PartnerTotalInput[];
  owners: PlanPerson[];
  canAdjust: boolean;
  review: ReviewView | null;
  history: PartnerAdjustmentView[];
  pulledAt: string;
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
  /** Загружать факт по дням: владелец и администраторы в режиме управления */
  canFacts: boolean;
  /** Выгрузка в Excel: управление и команды продуктов при личном входе */
  canExport: boolean;
  /** Партнёрский канал: null, пока листы LRF b2b не загружены */
  partners: PartnerChannelView | null;
};

export type VersionOption = { id: string; label: string; group: "Версии месяца" | "Загрузки LBE" | "Прогноз на дату" };

export type CompareMetric = "units" | "revenue" | "promoMargin" | "directMargin";

export type CompareRow = {
  code: string;
  label: string;
  kind: "product" | "group" | "sub" | "total";
  a: Partial<Record<CompareMetric, number | null>>;
  b: Partial<Record<CompareMetric, number | null>>;
};

/** Сравнение двух версий месяца (этап 35) */
export type CompareView = {
  month: string;
  monthLabel: string;
  options: VersionOption[];
  a: VersionOption;
  b: VersionOption;
  rows: CompareRow[];
  /** Пояснение: например, у ранних дат нет снимка LBE и берётся текущий */
  notes: string[];
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
  /** Партнёрский канал (этап 35б): загрузится, если листы на месте и прочитаны без проблем */
  partners: {
    found: boolean;
    ready: boolean;
    problems: string[];
    warnings: string[];
    lines: number;
    before: number;
    revenue: { lbe: number | null; budget: number | null };
  };
};

export type PartnerAdjustInput = {
  month: string;
  partner: string;
  metric: string;
  value: number | null;
  seen: number | null;
  reason: string;
  comment: string;
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
