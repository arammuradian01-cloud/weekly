"use client";

// Вкладки «Обзор» КАСКО и ОСАГО в новой версии раздела «Рынок» (этап 79). Модель считает сервер (lib/market/native),
// здесь раскладка блоков в том же порядке, что в дашборде из пакета, и переключатели вида в адресе страницы.

import { Module } from "@/components/ui/data";
import { dayShort, monthAxis, monthLong, monthShort, n0, n1, n2, p2, pct, pp, yearAgo } from "@/lib/market/native/format";
import { KASKO_METRICS, OSAGO_METRICS } from "@/lib/market/native/metrics";
import { GEO_LABELS, KASKO_SEASON_UNITS, OSAGO_SEASON_UNITS, WEEK_LABELS, type KaskoOverview, type OsagoOverview } from "@/lib/market/native/overview";
import type { Geo } from "@/lib/market/native/rows";
import { Columns, Figure, Lines, Stacks, type Column } from "./charts";
import { Insights, MixSection, MonthCompare, MonthlyBlock, SeasonSection, StructureSection, Tiles, type TableCol } from "./blocks";
import { Seg, useMarketNav, useUrlChoice } from "./state";

type Params = Record<string, string>;

const KASKO_CHART = [
  { value: "fl_cnt", label: "Договоры полного КАСКО ФЛ" },
  { value: "fl_prem", label: "Премии полного КАСКО ФЛ" },
  { value: "fl_avg", label: "Средняя премия" },
  { value: "core_cnt", label: "Машины от 1 года" },
  { value: "new_share", label: "Доля новых машин" },
  { value: "top4_share", label: "Доля топ-4 регионов" },
  { value: "mini_share", label: "Доля мини-КАСКО" },
  { value: "sravni_deals", label: "Сделки Сравни" },
  { value: "sravni_share", label: "Доля Сравни" },
  { value: "sravni_reach", label: "Охват лидами" },
];
const KASKO_TABLE: TableCol[] = [
  { field: "fl_cnt", label: "Договоры ФЛ, тыс." },
  { field: "fl_cnt", label: "", delta: true },
  { field: "fl_prem", label: "Премии ФЛ, млн" },
  { field: "fl_prem", label: "", delta: true },
  { field: "fl_avg", label: "Ср. премия, тыс. руб" },
  { field: "fl_avg", label: "", delta: true },
  { field: "core_cnt", label: "От 1 года, тыс." },
  { field: "core_cnt", label: "", delta: true },
  { field: "new_share", label: "Доля новых", narrow: true },
  { field: "top4_share", label: "Доля топ-4", narrow: true },
  { field: "mini_share", label: "Доля мини", narrow: true },
  { field: "sravni_deals", label: "Сделки Сравни" },
  { field: "sravni_deals", label: "", delta: true },
  { field: "sravni_share", label: "Доля Сравни" },
  { field: "sravni_share", label: "", delta: true },
];

const OSAGO_CHART = [
  { value: "wo_short", label: "Рынок без коротких полисов" },
  { value: "relevant", label: "Доступный рынок (A и B)" },
  { value: "total", label: "Весь рынок с короткими" },
  { value: "taxi_short", label: "Короткие полисы такси" },
  { value: "gmv", label: "Премии без коротких" },
  { value: "avg_check", label: "Средний чек" },
  { value: "pool_share", label: "Доля пула" },
  { value: "eosago_share", label: "Доля е-ОСАГО" },
  { value: "agg_share", label: "Доля агрегаторов" },
  { value: "sravni_policies", label: "Полисы Сравни" },
  { value: "sravni_share_rel", label: "Доля Сравни в доступном рынке" },
];
const OSAGO_TABLE: TableCol[] = [
  { field: "wo_short", label: "Без коротких, тыс." },
  { field: "wo_short", label: "", delta: true },
  { field: "relevant", label: "Доступный, тыс." },
  { field: "relevant", label: "", delta: true },
  { field: "taxi_short", label: "Короткие, тыс.", narrow: true },
  { field: "taxi_short", label: "", delta: true, narrow: true },
  { field: "avg_check", label: "Ср. чек, руб" },
  { field: "avg_check", label: "", delta: true },
  { field: "gmv", label: "Премии, млрд", narrow: true },
  { field: "pool_share", label: "Доля пула" },
  { field: "pool_share", label: "", delta: true },
  { field: "agg_share", label: "Доля агрегаторов", narrow: true },
  { field: "sravni_policies", label: "Сравни, тыс." },
  { field: "sravni_policies", label: "", delta: true },
  { field: "sravni_share_rel", label: "Доля Сравни" },
  { field: "sravni_share_rel", label: "", delta: true },
];

/** Срез регионов: вся Россия, топ-4, остальные. Меняет ответ сервера, остальные параметры адреса остаются */
export function GeoSwitch({ geo }: { geo: Geo }) {
  const { go, pending } = useMarketNav();
  return (
    <Seg
      label="Регионы"
      value={geo}
      testId="mk-geo"
      onChange={(g) => {
        if (g !== geo && !pending) go({ geo: g === "all" ? null : g });
      }}
      options={(["all", "top4", "rest"] as Geo[]).map((g) => ({ value: g, label: GEO_LABELS[g] }))}
    />
  );
}

function Head({ title, period, note, children }: { title: string; period: string | null; note?: string | null; children?: React.ReactNode }) {
  return (
    <div className="mk-switch">
      <div className="mk-head">
        <h2 data-testid="mk-title">{title}</h2>
        {period ? <p className="mk-note">{period}</p> : null}
        {note ? (
          <p className="mk-note" data-testid="mk-geo-note">
            {note}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

// ---------- КАСКО ----------

export function KaskoOverviewView({ model, params }: { model: KaskoOverview; params: Params }) {
  const m = model;
  const period = m.period ? `С начала года: ${m.period.long} против тех же месяцев ${m.period.year - 1} года.` : null;
  const chart = m.geo === "all" ? KASKO_CHART : KASKO_CHART.filter((o) => o.value !== "top4_share" && !o.value.startsWith("sravni"));
  return (
    <>
      <Head title={m.title} period={period} note={m.geoNote}>
        <GeoSwitch geo={m.geo} />
      </Head>
      <Tiles tiles={m.tiles} label="Ключевые цифры КАСКО с начала года" />
      <Insights items={m.insights} />
      <MonthCompare months={m.months} metrics={m.compare} defs={KASKO_METRICS} keys={{ a: "kca", b: "kcb" }} initial={params} />
      <MonthlyBlock months={m.months} matrix={m.matrix} defs={KASKO_METRICS} chartMetrics={chart} table={KASKO_TABLE} keys={{ view: "kmv", cmp: "cmp", metric: "gm" }} initial={params} fallbackMetric="fl_cnt" />
      <SeasonSection seasons={m.seasons} units={KASKO_SEASON_UNITS} keys={{ metric: "ksm", view: "ksv" }} initial={params} fallback="full_fl" />
      <div className="mk-grid2">
        <WeeksSection weeks={m.weeks} params={params} />
        <DriversSection drivers={m.drivers} params={params} />
      </div>
      <MixSection
        title="Структура рынка по месяцам"
        months={m.mix.map((r) => r.month)}
        unitWord="Договоры"
        keys={{ view: "kmix" }}
        initial={params}
        parts={[
          { key: "full_fl", label: "Полное ФЛ", color: "var(--mk-1)", share: (i) => m.mix[i]!.shares.full_fl ?? null, abs: (i) => m.mix[i]!.parts.full_fl ?? 0 },
          { key: "full_jl", label: "Полное ЮЛ", color: "var(--mk-2)", share: (i) => m.mix[i]!.shares.full_jl ?? null, abs: (i) => m.mix[i]!.parts.full_jl ?? 0 },
          { key: "mini_fl", label: "Мини ФЛ", color: "var(--mk-3)", share: (i) => m.mix[i]!.shares.mini_fl ?? null, abs: (i) => m.mix[i]!.parts.mini_fl ?? 0 },
          { key: "mini_jl", label: "Мини ЮЛ", color: "var(--mk-4)", share: (i) => m.mix[i]!.shares.mini_jl ?? null, abs: (i) => m.mix[i]!.parts.mini_jl ?? 0 },
        ]}
      />
      <div className="mk-grid2">
        <StructureSection id="mk-structure" title="Из чего состоит рынок" rows={m.structure} accent={(k) => k === "full_fl" || k === "core"} digits={0} shareWord="всего КАСКО" />
        <StructureSection id="mk-ages" title="Полное КАСКО ФЛ по возрасту машины" rows={m.ages} accent={(k) => k !== "age_new"} digits={1} shareWord="договоров ФЛ" colorChange />
      </div>
    </>
  );
}

type WeekSeg = "full_fl" | "mini_fl" | "full_jl" | "dsago";

function WeeksSection({ weeks, params }: { weeks: KaskoOverview["weeks"]; params: Params }) {
  const [seg, setSeg] = useUrlChoice<WeekSeg>("wseg", params.wseg, ["full_fl", "mini_fl", "full_jl", "dsago"], "full_fl");
  const rows = weeks.rows;
  const items: Column[] = rows.map((w) => {
    const s = w.seg[seg];
    return {
      key: w.key,
      axis: dayShort(w.start),
      title: `Неделя с ${dayShort(w.start)}${w.partial ? ", неполная" : ""}`,
      value: s.value,
      prev: s.py,
      partial: w.partial,
      tip: s.yoy === null ? [] : [`к той же неделе прошлого года: ${pct(s.yoy)}`],
    };
  });
  return (
    <Module
      title="Свежие недели"
      id="mk-weeks"
      actions={<Seg label="Сегмент" value={seg} onChange={setSeg} testId="mk-weeks-seg" options={(Object.keys(WEEK_LABELS) as WeekSeg[]).map((k) => ({ value: k, label: WEEK_LABELS[k] }))} />}
    >
      {rows.length ? (
        <Figure
          label={`${WEEK_LABELS[seg]}: договоры по неделям, тыс.; линия: та же неделя прошлого года`}
          legend={[
            { label: "Тыс. договоров", color: "var(--mk-1)" },
            { label: "Та же неделя год назад", color: "var(--mk-ref)", kind: "line" },
            ...(rows.some((w) => w.partial) ? [{ label: "Неполная неделя", color: "var(--mk-1)", kind: "partial" as const }] : []),
          ]}
          table={{
            caption: `${WEEK_LABELS[seg]} по неделям, тыс. договоров`,
            head: ["Неделя с", "Тыс. договоров", "Год назад", "Изменение"],
            rows: rows
              .map((w) => ({ key: w.key, cells: [`${dayShort(w.start)}${w.partial ? ", неполная" : ""}`, n1(w.seg[seg].value), n1(w.seg[seg].py), pct(w.seg[seg].yoy)] }))
              .reverse(),
          }}
          note={weeks.notes[seg]}
          testId="mk-weeks-chart"
        >
          <Columns items={items} format={(v) => n1(v)} label={`${WEEK_LABELS[seg]}: договоры по неделям, тыс.`} />
        </Figure>
      ) : (
        <p className="mk-note">Нет данных по неделям.</p>
      )}
    </Module>
  );
}

type DrvView = "decomp" | "rate" | "avg_ss" | "avg";

function DriversSection({ drivers, params }: { drivers: KaskoOverview["drivers"]; params: Params }) {
  const [view, setView] = useUrlChoice<DrvView>("drv", params.drv, ["decomp", "rate", "avg_ss", "avg"], "decomp");
  const rows = drivers.rows;
  const PARTS = [
    { key: "c_vol", label: "Договоры", color: "var(--mk-1)" },
    { key: "c_ss", label: "Стоимость машин", color: "var(--mk-2)" },
    { key: "c_rate", label: "Тариф", color: "var(--mk-3)" },
    { key: "c_other", label: "Прочее", color: "var(--mk-muted)" },
  ] as const;
  let body: React.ReactNode;
  if (!rows.length) body = <p className="mk-note">Нет данных.</p>;
  else if (view === "decomp") {
    const d = rows.filter((r) => r.g_prem !== null);
    body = d.length ? (
      <Figure
        label="Рост премий полного КАСКО ФЛ к тому же месяцу прошлого года и его разложение: договоры, стоимость машин, тариф, прочее"
        legend={[...PARTS.map((p) => ({ label: p.label, color: p.color })), { label: "Рост премий", color: "var(--color-text)" }]}
        table={{
          caption: "Разложение роста премий к прошлому году",
          head: ["Месяц", "Рост премий", ...PARTS.map((p) => p.label)],
          rows: d.map((r) => ({ key: r.month, cells: [monthShort(r.month), pct(r.g_prem), ...PARTS.map((p) => pct(r[p.key]))] })).reverse(),
        }}
        testId="mk-drivers-chart"
      >
        <Stacks
          x={d.map((r) => ({ axis: monthAxis(r.month), title: monthLong(r.month) }))}
          parts={[...PARTS]}
          values={d.map((r) => PARTS.map((p) => r[p.key]))}
          dot={{ label: "Рост премий к прошлому году", values: d.map((r) => r.g_prem) }}
          format={(v) => pct(v).replace(",0%", "%")}
          tipFormat={(v) => pct(v)}
          label="Разложение роста премий"
          height={220}
        />
      </Figure>
    ) : (
      <p className="mk-note">Нет периода для сравнения с прошлым годом.</p>
    );
  } else {
    const by = new Map(rows.map((r) => [r.month, r[view]]));
    const name = view === "rate" ? "Тариф" : view === "avg_ss" ? "Средняя страховая сумма, млн руб" : "Средняя премия, руб";
    const f = view === "rate" ? p2 : view === "avg_ss" ? n2 : n0;
    const chg = (r: (typeof rows)[number]) => (view === "rate" ? pp(r.rate_yoy, true) : pct(view === "avg_ss" ? r.avg_ss_yoy : r.avg_yoy));
    body = (
      <Figure
        label={`${name} по месяцам; вторая линия: тот же месяц год назад`}
        legend={[
          { label: name, color: "var(--mk-1)", kind: "line" },
          { label: "Год назад", color: "var(--mk-ref)", kind: "line" },
        ]}
        table={{
          caption: name,
          head: ["Месяц", name, "Год назад", "Изменение к прошлому году"],
          rows: rows.map((r) => ({ key: r.month, cells: [monthShort(r.month), f(r[view]), f(by.get(yearAgo(r.month)) ?? null), chg(r)] })).reverse(),
        }}
        testId="mk-drivers-chart"
      >
        <Lines
          x={rows.map((r) => ({ axis: monthAxis(r.month), title: monthLong(r.month) }))}
          series={[
            { key: "v", name, values: rows.map((r) => r[view]), color: "var(--mk-1)", label: true },
            { key: "p", name: "Год назад", values: rows.map((r) => by.get(yearAgo(r.month)) ?? null), color: "var(--mk-ref)", width: 1.5 },
          ]}
          format={(v) => f(v)}
          extraTip={(i) => [`к прошлому году: ${chg(rows[i]!)}`]}
          label={name}
          height={200}
        />
      </Figure>
    );
  }
  return (
    <Module
      title="Откуда рост премий"
      id="mk-drivers"
      actions={
        <Seg
          label="Вид"
          value={view}
          onChange={setView}
          testId="mk-drivers-view"
          options={[
            { value: "decomp", label: "Разложение" },
            { value: "rate", label: "Тариф" },
            { value: "avg_ss", label: "Страх. сумма" },
            { value: "avg", label: "Ср. премия" },
          ]}
        />
      }
    >
      <div className="flex flex-col gap-3">
        {body}
        {drivers.note ? (
          <p className="mk-note" data-testid="mk-drivers-note">
            {drivers.note}
          </p>
        ) : null}
      </div>
    </Module>
  );
}

// ---------- ОСАГО ----------

export function OsagoOverviewView({ model, params }: { model: OsagoOverview; params: Params }) {
  const m = model;
  const period = m.period ? `С начала года: ${m.period.long} против тех же месяцев ${m.period.year - 1} года. Только по всей России.` : null;
  return (
    <>
      <Head title="Рынок ОСАГО" period={period} />
      <Tiles tiles={m.tiles} label="Ключевые цифры ОСАГО с начала года" />
      <Insights items={m.insights} />
      <MonthCompare months={m.months} metrics={m.compare} defs={OSAGO_METRICS} keys={{ a: "oca", b: "ocb" }} initial={params} />
      <MonthlyBlock months={m.months} matrix={m.matrix} defs={OSAGO_METRICS} chartMetrics={OSAGO_CHART} table={OSAGO_TABLE} keys={{ view: "omv", cmp: "ocmp", metric: "ogm" }} initial={params} fallbackMetric="wo_short" />
      <SeasonSection seasons={m.seasons} units={OSAGO_SEASON_UNITS} keys={{ metric: "osm", view: "osv" }} initial={params} fallback="wo_short" />
      <MixSection
        title="Структура рынка по месяцам"
        months={m.months.map((r) => r.month)}
        unitWord="Полисы"
        keys={{ view: "omix" }}
        initial={params}
        parts={[
          { key: "wo", label: "Без коротких", color: "var(--mk-1)", share: (i) => m.months[i]!.wo_share, abs: (i) => m.months[i]!.wo_short ?? 0 },
          { key: "short", label: "Короткие такси", color: "var(--mk-2)", share: (i) => m.months[i]!.short_share, abs: (i) => m.months[i]!.taxi_short ?? 0 },
        ]}
      />
      <StructureSection id="mk-structure" title="Из чего состоит рынок" rows={m.structure} accent={(k) => k === "wo_short" || k === "sravni_policies"} digits={0} shareWord="всего рынка" />
    </>
  );
}

