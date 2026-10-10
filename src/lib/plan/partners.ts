// Партнёрский канал в прогнозе месяца (этап 35б): чистые функции без базы.
//
// LRF «b2b channel: 5Y_LRF (CURRENT)» ресурс читает через ту же таблицу-связку, листы там с префиксом «B2B. ». Читаются
// только листы страхования:
// - «CPA & WAYBACK OSAGO LRF» и «CPA & WAYBACK RED LRF»: партнёры и отказной трафик страховых по типам партнёров;
// - «AGENTS OSAGO LRF» и «AGENTS RED LRF»: агенты, в том числе по API;
// - «PnL_b2b»: бюджет и LBE канала по продуктам (выручка, расходы на партнёров, промо-маржа).
// У партнёров в LRF только факт и LBE, бюджета по партнёру нет: бюджет показывается по продукту и каналу из P&L.
//
// Блок партнёра в листе: строка с именем, под ней «TOTAL POLICIES» (ёмкость партнёра), затем строки показателей. В
// строках с суммами в колонках B, C и E ключи: продукт, тип партнёра, партнёр. Блоки без ключей это итоги по типу
// партнёров: они не читаются, сумма партнёров сверяется с итогом листа. Названия строк в колонке F, как в листе
// «Инструкция» LRF: ёмкость, полисы через Сравни, конверсия в кросс, комиссия партнёра

import { lrfMonth } from "./spec";
import { cellNumber, type Cell, type Grid } from "./lrf";
import { lcFirst } from "./format";

export type PartnerChannel = "cpa" | "agents";

export type PartnerMetric =
  | "capacity"
  | "policies"
  | "share"
  | "rpu"
  | "revenueCore"
  | "crUpsale"
  | "upsalePolicies"
  | "rpuUpsale"
  | "upsaleRevenue"
  | "revenue"
  | "commission"
  | "costs"
  | "margin";

export type PartnerValues = Partial<Record<PartnerMetric, number | null>>;
export type PartnerDrivers = Partial<Record<PartnerMetric, number>>;

export type PartnerUnit = "count" | "pct" | "rub" | "mln";

export const PARTNER_UNITS: Record<PartnerMetric, PartnerUnit> = {
  capacity: "count",
  policies: "count",
  share: "pct",
  rpu: "rub",
  revenueCore: "mln",
  crUpsale: "pct",
  upsalePolicies: "count",
  rpuUpsale: "rub",
  upsaleRevenue: "mln",
  revenue: "mln",
  commission: "pct",
  costs: "mln",
  margin: "mln",
};

/** Что команда канала меняет: ёмкость, полисы, выручку на полис, конверсию в кросс и комиссию. Остальное пересчитывается */
export const PARTNER_DRIVERS: PartnerMetric[] = ["capacity", "policies", "rpu", "crUpsale", "commission"];
export const PARTNER_RESULTS: PartnerMetric[] = ["share", "upsalePolicies", "revenue", "costs", "margin"];

export const PARTNER_CHANNELS: { code: PartnerChannel; label: string }[] = [
  { code: "cpa", label: "CPA и отказной" },
  { code: "agents", label: "Агенты" },
];

export const channelLabel = (c: string) => PARTNER_CHANNELS.find((x) => x.code === c)?.label ?? c;

/** Листы партнёрского канала в LRF b2b. В таблице-связке они с префиксом «B2B. » */
export const PARTNER_SHEETS: { name: string; channel: PartnerChannel }[] = [
  { name: "CPA & WAYBACK OSAGO LRF", channel: "cpa" },
  { name: "AGENTS OSAGO LRF", channel: "agents" },
  { name: "CPA & WAYBACK RED LRF", channel: "cpa" },
  { name: "AGENTS RED LRF", channel: "agents" },
];
export const PARTNER_PNL_SHEET = "PnL_b2b";
export const PARTNER_SHEET_PREFIX = "B2B. ";

/** Код канала в настройке «кто корректирует»: рядом с кодами продуктов */
export const PARTNER_OWNER_CODE = "b2b";
export const PARTNER_DEFAULT_OWNERS = ["sakhibullina", "afanasyev"];
export const PARTNER_LABEL = "Партнёрский канал";

/** Продукт LRF b2b в код продукта ресурса. Бронирование, прочее страхование и кросс (мини-КАСКО) отдельно не читаются */
const PRODUCT_CODES: Record<string, string> = {
  osago: "osago",
  "mortgage insurance": "red-mortgage",
  "travel insurance": "red-travel",
  "accident insurance": "red-accident",
  "property insurance": "red-property",
  "tick bite insurance": "red-tick",
};
export const partnerProductCode = (raw: string): string | null => PRODUCT_CODES[raw.trim().toLowerCase()] ?? null;
export const PARTNER_PRODUCTS = ["osago", "red-mortgage", "red-travel", "red-accident", "red-property", "red-tick"];

const KINDS: Record<string, string> = {
  financialorganization: "Финансовые организации",
  retail: "Ритейл и связь",
  industryspecific: "Отраслевые партнёры",
  cpanetwork: "CPA-сети",
  web: "Веб",
  "agents (partnership)": "Агенты API",
  agents: "Агенты",
};
export const kindLabel = (raw: string) => KINDS[raw.trim().toLowerCase()] ?? (raw.trim() || "Без типа");

export type PartnerLine = {
  /** Код партнёра: одинаковый от загрузки к загрузке, пока в LRF не поменяли продукт, тип или ключ партнёра */
  code: string;
  label: string;
  product: string;
  channel: PartnerChannel;
  /** Тип партнёра как в LRF: FinancialOrganization, Retail, CpaNetwork, Agents (partnership) */
  kind: string;
  position: number;
  lbe: PartnerValues;
};

const text = (c: Cell) => (c === null || c === undefined ? "" : String(c).replace(/ /g, " ").replace(/\s+/g, " ").trim());

const LABEL_COL = 5;
const KEY_COLS = { product: 1, kind: 2, partner: 4 };

/** Колонка месяца нужной версии: «LBE» над «Oct_2026» или над «Oct'26» (P&L b2b). Первая подходящая слева */
export function monthColumn(grid: Grid, month: string, version: "LBE" | "BUD"): number | undefined {
  const long = lrfMonth(month).toLowerCase();
  const short = `${long.slice(0, 3)}'${month.slice(2, 4)}`;
  const head = grid.slice(0, 8);
  const width = Math.max(0, ...head.map((r) => r?.length ?? 0));
  for (let j = 0; j < width; j++) {
    const cells = head.map((r) => text(r?.[j]).toLowerCase());
    if (!cells.some((c) => c === long || c === short)) continue;
    if (cells.some((c) => c === version.toLowerCase())) return j;
  }
  return undefined;
}

const labelOf = (row: Cell[] | undefined) => text(row?.[LABEL_COL]);
const keyOf = (row: Cell[] | undefined, col: number) => text(row?.[col]);

const FIND: { metric: PartnerMetric; label: RegExp }[] = [
  { metric: "capacity", label: /^TOTAL POLICIES$/i },
  { metric: "share", label: /^share Sravni of total policies/i },
  { metric: "policies", label: /^Sravni (OSAGO )?policies$/i },
  { metric: "rpu", label: /^revenue per policy/i },
  { metric: "revenueCore", label: /^Sravni revenue w\/o UpSale/i },
  { metric: "crUpsale", label: /^CR: .*UpSale/i },
  { metric: "upsalePolicies", label: /^Sravni cross-sale policies$/i },
  { metric: "rpuUpsale", label: /^revenue per UpSale policy/i },
  { metric: "upsaleRevenue", label: /^Sravni UpSale revenue/i },
  { metric: "revenue", label: /^Sravni TOTAL REVENUE/i },
  { metric: "costs", label: /^(Partners costs|Payments to agents)/i },
  { metric: "commission", label: /^(Partners|Agents) commission/i },
];

const POLICIES_ROW = /^Sravni (\w+ )?(policies|deals)$/i;
/** Заголовок раздела: латиница прописными («FINANCIAL ORGANIZATION», «MORTGAGE INSURANCE»), кроме строк «TOTAL ...» */
const HEADER = /^[A-Z][A-Z &/()-]+$/;

/** Короткий стабильный код из строки: латиница и цифры */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36).padStart(7, "0") + h2.toString(36).padStart(7, "0");
}

/**
 * Имя партнёра на экране: заголовок «AGENTS» по-русски; «Прочие» с типом партнёров, иначе шесть «Прочих» ОСАГО не
 * отличить в журнале и сводке; остальное как в LRF
 */
function displayName(label: string, kind: string): string {
  if (/^AGENTS$/i.test(label)) return "Агенты";
  if (/^Прочие$/i.test(label)) return `Прочие (${lcFirst(kindLabel(kind))})`;
  return label;
}

export type SheetRead = { lines: PartnerLine[]; totals: { policies: number | null; revenue: number | null; costs: number | null }; skipped: string[] };

/** Партнёры одного листа со значениями LBE месяца. col: колонка LBE месяца */
export function readPartnerSheet(grid: Grid, channel: PartnerChannel, col: number, used = new Map<string, number>()): SheetRead {
  const labeled: number[] = [];
  for (let i = 0; i < grid.length; i++) if (labelOf(grid[i])) labeled.push(i);
  type Block = { name: string; row: number; values: PartnerValues; seen: Set<string>; keys: { product: string; kind: string; partner: string } | null };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (let k = 0; k < labeled.length; k++) {
    const i = labeled[k]!;
    const row = grid[i];
    const label = labelOf(row);
    const next = k + 1 < labeled.length ? labelOf(grid[labeled[k + 1]!]) : "";
    const keyed = !!keyOf(row, KEY_COLS.product);
    // Начало блока: имя партнёра над ёмкостью или заголовок «AGENTS» над полисами (у агентов RED ёмкости нет)
    if (!keyed && !POLICIES_ROW.test(label) && label !== "TOTAL POLICIES" && (next === "TOTAL POLICIES" || (POLICIES_ROW.test(next) && HEADER.test(label)))) {
      cur = { name: label, row: i, values: {}, seen: new Set(), keys: null };
      blocks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (!keyed && HEADER.test(label) && !label.startsWith("TOTAL")) {
      cur = null;
      continue;
    }
    if (keyed && !cur.keys) {
      const product = keyOf(row, KEY_COLS.product);
      const kind = keyOf(row, KEY_COLS.kind);
      // У обычных агентов ключ партнёра в строках разбивки («Agents», «Manager Agency»): код по имени блока, чтобы он не
      // зависел от порядка этих строк
      if (partnerProductCode(product)) cur.keys = { product, kind, partner: /^agents$/i.test(kind) ? "" : keyOf(row, KEY_COLS.partner) };
    }
    const find = FIND.find((f) => f.label.test(label));
    if (!find || cur.seen.has(find.metric)) continue;
    cur.seen.add(find.metric);
    cur.values[find.metric] = cellNumber(row?.[col]);
  }
  const lines: PartnerLine[] = [];
  const skipped = new Set<string>();
  for (const b of blocks) {
    if (!b.keys) {
      // Блок с ключами неизвестного продукта (бронирование): отмечаем, если в нём есть деньги
      const raw = keyOf(grid.slice(b.row).find((r) => keyOf(r, KEY_COLS.product)), KEY_COLS.product);
      if (raw && !partnerProductCode(raw) && (b.values.revenue ?? 0) !== 0) skipped.add(raw);
      continue;
    }
    const product = partnerProductCode(b.keys.product)!;
    const base = `${channel}|${product}|${b.keys.kind.toLowerCase()}|${(b.keys.partner || b.name).toLowerCase()}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    lines.push({
      code: `p${hash(n > 1 ? `${base}|${n}` : base)}`,
      label: displayName(b.name, b.keys.kind),
      product,
      channel,
      kind: b.keys.kind,
      position: lines.length,
      lbe: b.values,
    });
  }
  // Итог листа для сверки: первая строка полисов Сравни и первая строка выручки и расходов
  const first = (re: RegExp) => {
    const i = grid.findIndex((r) => re.test(labelOf(r)));
    return i < 0 ? null : cellNumber(grid[i]?.[col]);
  };
  return {
    lines,
    totals: { policies: first(/^SRAVNI TOTAL \w+ POLICIES$/i), revenue: first(/^Sravni TOTAL REVENUE/i), costs: first(/^(Partners costs|Payments to agents)/i) },
    skipped: [...skipped],
  };
}

export type ChannelTotals = { revenue: number | null; costs: number | null; margin: number | null };
export type PnlRead = Record<string, Partial<Record<PartnerChannel, Record<"LBE" | "BUD", ChannelTotals>>>>;

/**
 * Бюджет и LBE канала по продуктам из «PnL_b2b»: раздел «SPLIT BY CHANNEL», в нём PARTNERS, WAYBACK и AGENTS (в LRF с
 * опечаткой «AGETNS»). Выручка в строках «Revenue», расходы в строках «Marketing expenses», промо-маржа в первых строках
 * продуктов после заголовка «PROMO MARGIN». CPA и отказной это PARTNERS плюс WAYBACK
 */
export function readPnl(grid: Grid, cols: Partial<Record<"LBE" | "BUD", number>>): PnlRead {
  const out: PnlRead = {};
  const e = (r: Cell[] | undefined) => text(r?.[4]);
  const d = (r: Cell[] | undefined) => text(r?.[3]);
  const split = grid.findIndex((r) => /^SPLIT BY CHANNEL/i.test(e(r)));
  const from = split < 0 ? 0 : split;
  const sections: { channel: PartnerChannel; from: number; to: number }[] = [];
  for (let i = from; i < grid.length; i++) {
    const label = e(grid[i]).toUpperCase();
    const channel: PartnerChannel | null = label === "PARTNERS" || label === "WAYBACK" ? "cpa" : label === "AGENTS" || label === "AGETNS" ? "agents" : null;
    if (!channel) continue;
    if (sections.length) sections[sections.length - 1]!.to = i;
    sections.push({ channel, from: i, to: grid.length });
  }
  for (const s of sections) {
    const seen = new Set<string>();
    let margin = false;
    for (let i = s.from + 1; i < s.to; i++) {
      const row = grid[i];
      const label = e(row);
      if (/^PROMO MARGIN$/i.test(label)) {
        margin = true;
        continue;
      }
      const product = partnerProductCode(label);
      if (!product) continue;
      const kind = /^Revenue$/i.test(d(row)) ? "revenue" : /^Marketing expenses$/i.test(d(row)) ? "costs" : margin && !d(row) ? "margin" : null;
      if (!kind || seen.has(`${product}:${kind}`)) continue;
      seen.add(`${product}:${kind}`);
      for (const v of ["LBE", "BUD"] as const) {
        const col = cols[v];
        if (col === undefined) continue;
        const value = cellNumber(row?.[col]);
        const byChannel = (out[product] ??= {});
        const t = (byChannel[s.channel] ??= { LBE: { revenue: null, costs: null, margin: null }, BUD: { revenue: null, costs: null, margin: null } });
        // PARTNERS и WAYBACK складываются в CPA и отказной
        if (value !== null) t[v][kind] = (t[v][kind] ?? 0) + value;
      }
    }
  }
  // Маржи нет в P&L: выручка минус расходы
  for (const byChannel of Object.values(out)) {
    for (const t of Object.values(byChannel)) {
      for (const v of ["LBE", "BUD"] as const) {
        const x = t![v];
        if (x.margin === null && x.revenue !== null && x.costs !== null) x.margin = x.revenue - x.costs;
      }
    }
  }
  return out;
}

export type PartnerPull = {
  lines: PartnerLine[];
  totals: { product: string; channel: PartnerChannel; version: "LBE" | "BUD"; revenue: number | null; costs: number | null; margin: number | null }[];
  /** Листы партнёрского канала есть в источнике: без них загрузка продуктов идёт как раньше */
  found: boolean;
  problems: string[];
  warnings: string[];
};

const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1e-9) + 1e-9;

/** Лист по имени: как в LRF или с префиксом таблицы-связки */
export function partnerSheet(sheets: Record<string, Grid | undefined>, name: string): Grid | undefined {
  return sheets[`${PARTNER_SHEET_PREFIX}${name}`] ?? sheets[name];
}

/** Все листы партнёрского канала: партнёры с LBE месяца, бюджет и LBE канала, сверки сумм */
export function readPartners(sheets: Record<string, Grid | undefined>, month: string): PartnerPull {
  const problems: string[] = [];
  const warnings: string[] = [];
  const present = PARTNER_SHEETS.filter((s) => partnerSheet(sheets, s.name));
  const pnlGrid = partnerSheet(sheets, PARTNER_PNL_SHEET);
  if (!present.length && !pnlGrid) return { lines: [], totals: [], found: false, problems, warnings };
  const lines: PartnerLine[] = [];
  // Повторы ключей разводятся по всем листам сразу: одинаковый код у двух партнёров уронил бы всю загрузку месяца
  const used = new Map<string, number>();
  const title = (name: string) => `«${PARTNER_SHEET_PREFIX}${name}»`;
  for (const s of PARTNER_SHEETS) {
    const grid = partnerSheet(sheets, s.name);
    if (!grid) {
      problems.push(`Нет листа ${title(s.name)}`);
      continue;
    }
    const col = monthColumn(grid, month, "LBE");
    if (col === undefined) {
      problems.push(`Лист ${title(s.name)}: нет колонки LBE ${lrfMonth(month)}`);
      continue;
    }
    const read = readPartnerSheet(grid, s.channel, col, used);
    if (!read.lines.length) problems.push(`Лист ${title(s.name)}: не найдены партнёры`);
    for (const raw of read.skipped) warnings.push(`Лист ${title(s.name)}: продукт «${raw}» не входит в прогноз, его партнёры не загружены`);
    const sum = (m: PartnerMetric) => read.lines.reduce((acc, l) => acc + (l.lbe[m] ?? 0), 0);
    // Сумма партнёров не сходится с итогом листа: какой-то блок не распознан. Неполный набор партнёров не загружается,
    // иначе пропавшие партнёры потеряли бы корректировки команды
    const check = (what: string, total: number | null, m: PartnerMetric) => {
      if (total !== null && !near(sum(m), total, 0.005)) problems.push(`Лист ${title(s.name)}: ${what} с итогом листа: часть партнёров не распознана`);
    };
    check("полисы партнёров не сходятся", read.totals.policies, "policies");
    check("выручка партнёров не сходится", read.totals.revenue, "revenue");
    check("расходы партнёров не сходятся", read.totals.costs, "costs");
    for (const l of read.lines) lines.push({ ...l, position: lines.length });
  }
  const totals: PartnerPull["totals"] = [];
  // Без бюджета канала партнёры загружаются: LBE партнёров есть, а бюджет в P&L b2b появляется на год вперёд не сразу
  if (!pnlGrid) warnings.push(`Нет листа ${title(PARTNER_PNL_SHEET)}: бюджета канала не будет`);
  else {
    const cols = { LBE: monthColumn(pnlGrid, month, "LBE"), BUD: monthColumn(pnlGrid, month, "BUD") };
    if (cols.BUD === undefined) warnings.push(`Лист ${title(PARTNER_PNL_SHEET)}: нет колонки BUD ${lrfMonth(month)}, бюджета канала не будет`);
    const pnl = readPnl(pnlGrid, cols);
    for (const product of PARTNER_PRODUCTS) {
      for (const ch of PARTNER_CHANNELS) {
        const t = pnl[product]?.[ch.code];
        if (!t) continue;
        for (const v of ["LBE", "BUD"] as const) totals.push({ product, channel: ch.code, version: v, ...t[v] });
        // LBE канала в P&L и сумма партнёров: если не сходятся, партнёры прочитаны не все
        const lbe = t.LBE.revenue;
        const mine = lines.filter((l) => l.product === product && l.channel === ch.code);
        if (lbe !== null && mine.length && !near(mine.reduce((a, l) => a + (l.lbe.revenue ?? 0), 0), lbe, 0.01)) {
          problems.push(`${ch.label}, ${productName(product)}: выручка партнёров не сходится с LBE в P&L b2b`);
        }
      }
    }
  }
  return { lines, totals, found: true, problems, warnings };
}

const PRODUCT_NAMES: Record<string, string> = {
  osago: "ОСАГО",
  "red-mortgage": "Ипотечное страхование",
  "red-travel": "ВЗР",
  "red-accident": "Несчастный случай",
  "red-property": "Имущество",
  "red-tick": "Клещ",
};
export const productName = (code: string) => PRODUCT_NAMES[code] ?? code;

const num = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : x);

/** Достроить производные: выручку без кросса, выручку на полис, долю Сравни, комиссию и маржу */
export function derivePartner(v: PartnerValues): PartnerValues {
  const out: PartnerValues = { ...v };
  const revenue = num(v.revenue);
  const up = num(v.upsaleRevenue);
  out.revenueCore = num(v.revenueCore) ?? (revenue !== null ? revenue - (up ?? 0) : null);
  const pol = num(v.policies);
  if (num(out.rpu) === null && pol !== null && pol > 0 && out.revenueCore !== null) out.rpu = (out.revenueCore * 1e6) / pol;
  const cap = num(v.capacity);
  out.share = cap !== null && cap > 0 && pol !== null ? pol / cap : num(v.share);
  if (num(out.commission) === null && revenue !== null && revenue > 0 && num(v.costs) !== null) out.commission = v.costs! / revenue;
  if (num(out.rpuUpsale) === null && num(v.upsalePolicies) && up !== null) out.rpuUpsale = (up * 1e6) / v.upsalePolicies!;
  // Пустая конверсия в кросс у продающего партнёра: из кросс-полисов (обычно 0), иначе корректировка ни на что не влияет
  if (num(out.crUpsale) === null && pol !== null && pol > 0 && num(v.upsalePolicies) !== null) out.crUpsale = v.upsalePolicies! / pol;
  out.margin = revenue !== null && num(v.costs) !== null ? revenue - v.costs! : null;
  return out;
}

/** Есть ли у партнёра кросс-продажи: строки конверсии в кросс в LBE */
export const hasUpsale = (lbe: PartnerValues) => num(lbe.crUpsale) !== null || num(lbe.upsalePolicies) !== null;

/**
 * Драйверы партнёра на экране: только те, от которых считается результат. Ёмкость, если она есть в LRF (у агентов её
 * нет); конверсия в кросс, если известна выручка на кросс-полис; выручка на полис, если её можно посчитать
 */
export function partnerDrivers(lbe: PartnerValues): PartnerMetric[] {
  const L = derivePartner(lbe);
  const selling = (num(L.policies) ?? 0) > 0;
  return PARTNER_DRIVERS.filter((k) => {
    if (k === "capacity") return num(lbe.capacity) !== null;
    if (k === "crUpsale") return hasUpsale(lbe) && num(L.rpuUpsale) !== null;
    if (k === "rpu") return !selling || num(L.rpu) !== null;
    return true;
  });
}

export function partnerResults(lbe: PartnerValues): PartnerMetric[] {
  return PARTNER_RESULTS.filter((k) => (k !== "upsalePolicies" || hasUpsale(lbe)) && (k !== "share" || num(lbe.capacity) !== null));
}

/**
 * Значения партнёра после корректировок. Как у продуктов, пересчёт от LBE через отношения: без корректировок прогноз
 * совпадает с LBE до копейки.
 * - доля Сравни = полисы / ёмкость (ёмкость меняет только долю: так в LRF);
 * - выручка без кросса = по LBE × (полисы / по LBE) × (выручка на полис / по LBE);
 * - кросс-полисы = по LBE × (полисы / по LBE) × (конверсия в кросс / по LBE), выручка кросса пропорционально;
 * - выручка = по LBE + изменение выручки без кросса + изменение выручки кросса;
 * - расходы на партнёра = по LBE × (выручка / по LBE) × (комиссия / по LBE);
 * - маржа = выручка - расходы.
 * Ноль в LBE (партнёр ещё не продаёт): через разницу произведений, а не отношение
 */
export function computePartner(lbe: PartnerValues, drivers: PartnerDrivers): PartnerValues {
  const L = derivePartner(lbe);
  const d = (k: PartnerMetric) => (drivers[k] !== undefined && Number.isFinite(drivers[k]) ? drivers[k]! : num(L[k]));
  const out: PartnerValues = { ...L };
  for (const k of partnerDrivers(lbe)) out[k] = d(k);
  const pol = d("policies");
  const polL = num(L.policies);
  const cap = d("capacity");
  out.share = cap !== null && cap > 0 && pol !== null ? pol / cap : num(L.share);
  // Отношение, когда в LBE обе величины больше нуля; иначе разница произведений. Пустая ячейка LBE при нуле полисов значит
  // ноль: партнёр, который ещё не продаёт, начинает с выручки на полис и комиссии, которые укажет команда
  const scale = (base: number | null, a: number | null, aL: number | null, b: number | null, bL: number | null, unit: number) => {
    if (a === null || b === null) return base;
    if (base !== null && aL !== null && bL !== null && aL > 0 && bL > 0) return base * (a / aL) * (b / bL);
    if (aL && bL === null) return base;
    const before = !aL || !bL ? 0 : aL * bL;
    return (base ?? 0) + (a * b - before) / unit;
  };
  const coreL = num(L.revenueCore);
  const core = scale(coreL, pol, polL, d("rpu"), num(L.rpu), 1e6);
  out.revenueCore = core;
  let up = num(L.upsaleRevenue);
  if (hasUpsale(lbe)) {
    const crossL = num(L.upsalePolicies);
    const cross = scale(crossL, pol, polL, d("crUpsale"), num(L.crUpsale), 1);
    out.upsalePolicies = cross;
    if (up !== null && cross !== null && crossL !== null) up = crossL > 0 ? up * (cross / crossL) : up + ((cross - crossL) * (num(L.rpuUpsale) ?? 0)) / 1e6;
    out.upsaleRevenue = up;
  }
  // Выручка: LBE плюс изменения выручки без кросса и выручки кросса. Без корректировок ровно LBE, без ошибок округления
  const revenueL = num(L.revenue);
  const change = (core !== null && coreL !== null ? core - coreL : 0) + (up !== null ? up - (num(L.upsaleRevenue) ?? 0) : 0);
  const revenue = revenueL !== null ? revenueL + change : core !== null ? core + (up ?? 0) : null;
  out.revenue = revenue;
  const costs = scale(num(L.costs), revenue, revenueL, d("commission"), num(L.commission), 1);
  out.costs = costs;
  out.margin = revenue !== null && costs !== null ? revenue - costs : null;
  // Остаток плавающей точки после корректировки (полисы 0 дают -1e-9) показывается нулём; значения LBE не трогаются
  for (const k of ["revenueCore", "upsalePolicies", "upsaleRevenue", "revenue", "costs", "margin"] as const) {
    const x = out[k];
    if (x != null && x !== L[k] && Math.abs(x) < 1e-9) out[k] = 0;
  }
  return out;
}

/** Корректировка действует, если отличается от LBE */
export function activePartnerDrivers(lbe: PartnerValues, drivers: PartnerDrivers): PartnerDrivers {
  const L = derivePartner(lbe);
  const out: PartnerDrivers = {};
  for (const [k, v] of Object.entries(drivers) as [PartnerMetric, number][]) {
    const base = num(L[k]);
    if (base === null || Math.abs(v - base) > 1e-9 * Math.max(1, Math.abs(base))) out[k] = v;
  }
  return out;
}

export type PartnerTriple = { budget: number | null; lbe: number | null; forecast: number | null };
export type PartnerSum = { policies: PartnerTriple; revenue: PartnerTriple; costs: PartnerTriple; margin: PartnerTriple; partners: number; adjusted: number };

export type PartnerTotalInput = { product: string; channel: PartnerChannel; version: "LBE" | "BUD"; revenue: number | null; costs: number | null; margin: number | null };

/**
 * Итоги канала: по продукту и каналу, по продукту, по каналу и всего. Полисы, выручка, расходы и маржа: LBE и прогноз
 * суммой партнёров, бюджет из P&L b2b (полисов в бюджете P&L нет)
 */
export function partnerTotals(lines: { product: string; channel: PartnerChannel; lbe: PartnerValues; drivers: PartnerDrivers }[], budget: PartnerTotalInput[]) {
  const empty = (): PartnerSum => ({
    policies: { budget: null, lbe: null, forecast: null },
    revenue: { budget: null, lbe: null, forecast: null },
    costs: { budget: null, lbe: null, forecast: null },
    margin: { budget: null, lbe: null, forecast: null },
    partners: 0,
    adjusted: 0,
  });
  const add = (t: PartnerTriple, key: "lbe" | "forecast" | "budget", v: number | null | undefined) => {
    const x = num(v);
    if (x !== null) t[key] = (t[key] ?? 0) + x;
  };
  const byPair = new Map<string, PartnerSum>();
  const byProduct = new Map<string, PartnerSum>();
  const byChannel = new Map<string, PartnerSum>();
  const total = empty();
  const buckets = (product: string, channel: string) => {
    const pair = `${product}:${channel}`;
    if (!byPair.has(pair)) byPair.set(pair, empty());
    if (!byProduct.has(product)) byProduct.set(product, empty());
    if (!byChannel.has(channel)) byChannel.set(channel, empty());
    return [byPair.get(pair)!, byProduct.get(product)!, byChannel.get(channel)!, total];
  };
  for (const l of lines) {
    const L = derivePartner(l.lbe);
    const cur = computePartner(l.lbe, l.drivers);
    const adjusted = Object.keys(activePartnerDrivers(l.lbe, l.drivers)).length > 0;
    for (const s of buckets(l.product, l.channel)) {
      s.partners += 1;
      if (adjusted) s.adjusted += 1;
      for (const m of ["policies", "revenue", "costs", "margin"] as const) {
        add(s[m], "lbe", L[m]);
        add(s[m], "forecast", cur[m]);
      }
    }
  }
  for (const b of budget) {
    if (b.version !== "BUD") continue;
    for (const s of buckets(b.product, b.channel)) {
      add(s.revenue, "budget", b.revenue);
      add(s.costs, "budget", b.costs);
      add(s.margin, "budget", b.margin);
    }
  }
  return { byPair, byProduct, byChannel, total };
}

/** Изменение полисов партнёров продукта к LBE: для предложения «учесть в полисах B2B продукта» */
export function policiesDelta(lines: { product: string; lbe: PartnerValues; drivers: PartnerDrivers }[], product: string): number {
  let delta = 0;
  for (const l of lines) {
    if (l.product !== product) continue;
    const a = num(computePartner(l.lbe, l.drivers).policies);
    const b = num(derivePartner(l.lbe).policies);
    if (a !== null && b !== null) delta += a - b;
  }
  return delta;
}

/** Название показателя партнёра: у агентов комиссия и расходы называются выплатами агентам */
export function partnerMetricLabel(key: PartnerMetric, channel: PartnerChannel): string {
  const agents = channel === "agents";
  const labels: Record<PartnerMetric, string> = {
    capacity: "Ёмкость партнёра, полисы",
    policies: "Полисы через Сравни",
    share: "Доля Сравни в ёмкости",
    rpu: "Выручка на полис, руб.",
    revenueCore: "Выручка без кросса, млн",
    crUpsale: "Конверсия в кросс-продажу",
    upsalePolicies: "Кросс-полисы",
    rpuUpsale: "Выручка на кросс-полис, руб.",
    upsaleRevenue: "Выручка кросса, млн",
    revenue: "Выручка, млн",
    commission: agents ? "Комиссия агента, доля выручки" : "Комиссия партнёра, доля выручки",
    costs: agents ? "Выплаты агентам, млн" : "Расходы на партнёра, млн",
    margin: "Маржа, млн",
  };
  return labels[key];
}

/** Подсказка к драйверу партнёра */
export function partnerHint(key: PartnerMetric): string {
  switch (key) {
    case "capacity":
      return "Сколько полисов продаёт партнёр всего. Меняет только долю Сравни";
    case "policies":
      return "Сколько полисов партнёр продаст через Сравни";
    case "rpu":
      return "Выручка Сравни с полиса без кросса: выручка меняется пропорционально полисам и выручке на полис";
    case "crUpsale":
      return "Доля полисов, к которым продаётся кросс (мини-КАСКО). Вводится в процентах";
    case "commission":
      return "Какую долю выручки Сравни платит партнёру. Вводится в процентах";
    default:
      return "";
  }
}

export const isPartnerDriver = (lbe: PartnerValues, key: string): key is PartnerMetric => (partnerDrivers(lbe) as string[]).includes(key);
