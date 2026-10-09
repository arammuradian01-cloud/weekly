// Прогноз месяца по драйверам (этап 32): какие продукты, где они в LRF и какие у них показатели. Без базы, нужно и серверу,
// и экранам.
//
// LRF «INSURANCE & INVEST: 5Y_LRF (CURRENT)»: у каждого продукта лист ключевых метрик с одинаковым деревом драйверов.
// Трафик сайта и приложения, конверсия в продажу, продажи B2C и B2B, выручка на продажу, выручка, промо-маржа, прямая маржа.
// Строка ищется по названию в первых колонках листа, при повторе названия (B2C встречается и в трафике, и в полисах)
// по якорю: первое совпадение после строки-якоря. Продажи B2C и B2B ищутся с учётом регистра: строчные b2c и b2b ниже
// это выручка, и без строки продаж поиск не должен съехать на неё (у КАСКО, наоборот, продажи строчными)

export type MetricKey =
  | "trafficWeb"
  | "trafficApp"
  | "crWeb"
  | "crApp"
  | "unitsB2c"
  | "unitsB2b"
  | "units"
  | "rpu"
  | "revenueCore"
  | "otherRevenue"
  | "revenue"
  | "promoCosts"
  | "promoMargin"
  | "directMargin";

/** Единица показателя: штуки, доля (0,15 это 15%), рубли, миллионы рублей */
export type PlanUnit = "count" | "pct" | "rub" | "mln";

/** Драйвер команда меняет, результат пересчитывается, база нужна только для пересчёта */
export type MetricKind = "driver" | "result" | "base";

/** Воронка: продажи из трафика и конверсии. Объём: продажи задаются числом (у вкладов клики) */
export type PlanModel = "funnel" | "units";

type Find = { label: RegExp; after?: RegExp };

export type ProductSpec = {
  code: string;
  label: string;
  /** Группа продукта: RED. Итог группы берётся из её строк LRF и меняется на сумму изменений продуктов */
  group?: string;
  sheet: string;
  /** Раздел листа: от строки start до первой из end */
  start: RegExp;
  end?: RegExp[];
  model: PlanModel;
  /** Как называются продажи и выручка на продажу у продукта */
  nouns: { units: string; unitsB2c: string; unitsB2b: string; rpu: string };
  find: Partial<Record<MetricKey, Find>>;
  /** Владельцы по умолчанию: кто корректирует прогноз продукта (меняется владельцем ресурса) */
  owners: string[];
};

export type GroupSpec = {
  code: string;
  label: string;
  sheet: string;
  start: RegExp;
  end?: RegExp[];
  find: Partial<Record<MetricKey, Find>>;
};

const re = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

const RED_FIND: ProductSpec["find"] = {
  trafficWeb: { label: /^TOTAL \w+ Web \(MAU\)$/i },
  trafficApp: { label: /^TOTAL \w+ App \(MAU\)$/i },
  crWeb: { label: /^CR: WEB \(%\):?$/i, after: /^CR: end-to-end \/ B2C/i },
  crApp: { label: /^CR: APP \(%\):?$/i, after: /^CR: end-to-end \/ B2C/i },
  units: { label: re("POLICIES (units)") },
  unitsB2c: { label: /^B2C$/, after: re("POLICIES (units)") },
  unitsB2b: { label: /^B2B$/, after: re("POLICIES (units)") },
  rpu: { label: re("Revenue per policy (RUB)") },
  revenueCore: { label: re("REVENUE (RUB MLN)") },
  revenue: { label: re("TOTAL REVENUE") },
  promoMargin: { label: re("PROMO MARGIN") },
};

const POLICY_NOUNS = { units: "Полисы, всего", unitsB2c: "Полисы B2C", unitsB2b: "Полисы B2B", rpu: "Выручка на полис, руб." };
const RED_OWNERS = ["loginova", "reva"];

// Разделы продуктов RED начинаются строкой трафика продукта: она одна на листе. Названия продуктов встречаются и в итоге
// RED (строки «Travel insurance» в разбивке трафика и выручки), поэтому по названию раздел не ищется
const RED_NAMES = ["MORTGAGE INSURANCE", "TRAVEL INSURANCE", "ACCIDENT INSURANCE", "PROPERTY INSURANCE", "TICK BITE INSURANCE"];
const redTraffic = (name: string) => re(`TOTAL ${name} TRAFFIC (MAU)`);
const redSection = (name: string) => ({ start: redTraffic(name), end: [...RED_NAMES.filter((n) => n !== name).map(redTraffic), /^technical rows/i] });

export const PRODUCTS: ProductSpec[] = [
  {
    code: "osago",
    label: "ОСАГО",
    sheet: "OSAGO_KEY METRICS",
    start: /^OSAGO$/i,
    end: [/^technical rows/i],
    model: "funnel",
    nouns: POLICY_NOUNS,
    find: {
      trafficWeb: { label: re("TOTAL OSAGO Web (MAU)") },
      trafficApp: { label: re("TOTAL OSAGO App (MAU)") },
      crWeb: { label: /^CR: WEB \(%\):?$/i, after: /^CR: end-to-end \/ B2C/i },
      crApp: { label: /^CR: APP \(%\):?$/i, after: /^CR: end-to-end \/ B2C/i },
      units: { label: re("POLICIES (units)") },
      unitsB2c: { label: /^B2C$/, after: re("POLICIES (units)") },
      unitsB2b: { label: /^B2B$/, after: re("POLICIES (units)") },
      rpu: { label: /^REVENUE PER POLICY/i },
      // Выручка от продаж с апсейлами: растёт вместе с полисами. Ретро-бонусы, медиа и прочее в прочей выручке
      revenueCore: { label: re("REVENUE: b2c + b2b (RUB MLN)") },
      revenue: { label: re("TOTAL REVENUE") },
      promoMargin: { label: re("PROMO MARGIN") },
      directMargin: { label: re("DIRECT MARGIN") },
    },
    owners: ["golovkin", "reva"],
  },
  {
    code: "kasko",
    label: "КАСКО",
    sheet: "CASCO LRF",
    start: re("TOTAL REVENUE CASCO"),
    model: "funnel",
    nouns: { units: "Лиды, всего", unitsB2c: "Лиды B2C", unitsB2b: "Лиды B2B", rpu: "Выручка на лид, руб." },
    find: {
      trafficWeb: { label: re("Web traffic (MAU)") },
      trafficApp: { label: re("App traffic (MAU)") },
      crWeb: { label: re("CR: Traffic -> Lead (%)"), after: re("Web traffic (MAU)") },
      crApp: { label: re("CR: Traffic -> Lead (%)"), after: re("App traffic (MAU)") },
      units: { label: re("Leads (units)") },
      unitsB2c: { label: /^b2c$/, after: re("Leads (units)") },
      unitsB2b: { label: /^b2b$/, after: re("Leads (units)") },
      rpu: { label: re("revenue per lead (rub)") },
      revenueCore: { label: /^REVENUE$/i, after: re("TOTAL REVENUE (RUB MLN)") },
      revenue: { label: re("TOTAL REVENUE CASCO") },
      promoMargin: { label: re("PROMO MARGIN (RUB MLN)") },
    },
    owners: ["fatyanov", "reva"],
  },
  {
    code: "red-mortgage",
    label: "Ипотечное страхование",
    group: "red",
    sheet: "RED_KEY METRICS",
    ...redSection("MORTGAGE INSURANCE"),
    model: "funnel",
    nouns: POLICY_NOUNS,
    find: RED_FIND,
    owners: RED_OWNERS,
  },
  {
    code: "red-travel",
    label: "ВЗР",
    group: "red",
    sheet: "RED_KEY METRICS",
    ...redSection("TRAVEL INSURANCE"),
    model: "funnel",
    nouns: POLICY_NOUNS,
    find: RED_FIND,
    owners: RED_OWNERS,
  },
  {
    code: "red-accident",
    label: "Несчастный случай",
    group: "red",
    sheet: "RED_KEY METRICS",
    ...redSection("ACCIDENT INSURANCE"),
    model: "funnel",
    nouns: POLICY_NOUNS,
    find: RED_FIND,
    owners: RED_OWNERS,
  },
  {
    code: "red-property",
    label: "Имущество",
    group: "red",
    sheet: "RED_KEY METRICS",
    ...redSection("PROPERTY INSURANCE"),
    model: "funnel",
    nouns: POLICY_NOUNS,
    find: RED_FIND,
    owners: RED_OWNERS,
  },
  {
    code: "red-tick",
    label: "Клещ",
    group: "red",
    sheet: "RED_KEY METRICS",
    ...redSection("TICK BITE INSURANCE"),
    model: "funnel",
    nouns: POLICY_NOUNS,
    find: RED_FIND,
    owners: RED_OWNERS,
  },
  {
    code: "deposits",
    label: "Вклады",
    sheet: "DEPOSITS_KEY METRICS",
    start: /^DEPOSITS$/i,
    end: [/^technical rows/i],
    model: "units",
    nouns: { units: "Клики, лидогенерация", unitsB2c: "Клики B2C", unitsB2b: "Клики B2B", rpu: "Выручка на клик, руб." },
    find: {
      units: { label: re("CLICKS (units)") },
      rpu: { label: re("REVENUE PER CLICK (RUB)") },
      revenueCore: { label: re("REVENUE (RUB MLN)"), after: /^LEADGEN$/i },
      revenue: { label: re("TOTAL REVENUE (RUB MLN)") },
      promoMargin: { label: re("PROMO MARGIN (RUB MLN)") },
      directMargin: { label: re("DIRECT MARGIN (RUB MLN)") },
    },
    owners: ["cheychenets", "reva"],
  },
];

export const GROUPS: GroupSpec[] = [
  {
    code: "red",
    label: "RED",
    sheet: "RED_KEY METRICS",
    start: /^TOTAL RED$/i,
    end: [redTraffic("MORTGAGE INSURANCE")],
    find: {
      units: { label: re("POLICIES (units)") },
      revenue: { label: re("TOTAL REVENUE") },
      promoMargin: { label: re("PROMO MARGIN") },
      directMargin: { label: re("DIRECT MARGIN") },
    },
  },
];

export const SHEETS = [...new Set([...PRODUCTS.map((p) => p.sheet), ...GROUPS.map((g) => g.sheet)])];

/** Драйверы модели: что команда может менять */
export const DRIVERS: Record<PlanModel, MetricKey[]> = {
  funnel: ["trafficWeb", "trafficApp", "crWeb", "crApp", "unitsB2b", "rpu", "otherRevenue", "promoCosts"],
  units: ["units", "rpu", "otherRevenue", "promoCosts"],
};

/** Результаты модели: что пересчитывается */
export const RESULTS: Record<PlanModel, MetricKey[]> = {
  funnel: ["unitsB2c", "units", "revenue", "promoMargin", "directMargin"],
  units: ["revenue", "promoMargin", "directMargin"],
};

export const UNITS: Record<MetricKey, PlanUnit> = {
  trafficWeb: "count",
  trafficApp: "count",
  crWeb: "pct",
  crApp: "pct",
  unitsB2c: "count",
  unitsB2b: "count",
  units: "count",
  rpu: "rub",
  revenueCore: "mln",
  otherRevenue: "mln",
  revenue: "mln",
  promoCosts: "mln",
  promoMargin: "mln",
  directMargin: "mln",
};

/** Название показателя для продукта */
export function metricLabel(p: Pick<ProductSpec, "nouns">, key: MetricKey): string {
  const labels: Record<MetricKey, string> = {
    trafficWeb: "Трафик сайта, MAU",
    trafficApp: "Трафик приложения, MAU",
    crWeb: "Конверсия сайта",
    crApp: "Конверсия приложения",
    unitsB2c: p.nouns.unitsB2c,
    unitsB2b: p.nouns.unitsB2b,
    units: p.nouns.units,
    rpu: p.nouns.rpu,
    revenueCore: "Выручка от продаж, млн",
    otherRevenue: "Прочая выручка, млн",
    revenue: "Выручка, млн",
    promoCosts: "Расходы на продвижение, млн",
    promoMargin: "Промо-маржа, млн",
    directMargin: "Прямая маржа, млн",
  };
  return labels[key];
}

/** Что значит драйвер и как он влияет: подсказка в карточке продукта */
export function driverHint(p: ProductSpec, key: MetricKey): string {
  const unit = p.nouns.units.split(",")[0]!.toLowerCase();
  switch (key) {
    case "trafficWeb":
    case "trafficApp":
      return `Трафик умножается на конверсию: получаются ${p.nouns.unitsB2c.charAt(0).toLowerCase()}${p.nouns.unitsB2c.slice(1)}`;
    case "crWeb":
    case "crApp":
      return "Доля посетителей, которые покупают. Вводится в процентах";
    case "unitsB2b":
      return "Продажи через партнёров и агентский кабинет";
    case "units":
      return `${p.nouns.units}: задаются числом`;
    case "rpu":
      return `Средний чек и комиссия: выручка от продаж меняется пропорционально (${unit} и выручка на продажу)`;
    case "otherRevenue":
      return "Ретро-бонусы, медиа, VAS и другая выручка, не связанная с продажами";
    case "promoCosts":
      return "Расходы на продвижение. Промо-маржа это выручка минус эти расходы";
    default:
      return "";
  }
}

export const productOf = (code: string) => PRODUCTS.find((p) => p.code === code);
export const groupOf = (code: string) => GROUPS.find((g) => g.code === code);
export const isDriver = (p: ProductSpec, key: string): key is MetricKey => (DRIVERS[p.model] as string[]).includes(key);

/** Продукты и группы верхнего уровня в порядке экрана: ОСАГО, КАСКО, RED, Вклады */
export function topLevel(): { kind: "product" | "group"; code: string; label: string }[] {
  const out: { kind: "product" | "group"; code: string; label: string }[] = [];
  for (const p of PRODUCTS) {
    if (!p.group) out.push({ kind: "product", code: p.code, label: p.label });
    else if (!out.some((o) => o.kind === "group" && o.code === p.group)) out.push({ kind: "group", code: p.group, label: groupOf(p.group)?.label ?? p.group });
  }
  return out;
}

/** Метка колонки LRF для месяца: «Oct_2026» */
export function lrfMonth(month: string): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${names[m - 1]}_${y}`;
}
