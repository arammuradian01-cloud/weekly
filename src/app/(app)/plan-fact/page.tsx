import type { Metadata } from "next";
import Link from "next/link";
import { requireContext } from "@/lib/auth";
import { currentActor } from "@/lib/action-runner";
import { moscowToday } from "@/lib/tasks/dates";
import { PageHeader } from "@/components/page-header";
import { Module, PageTabs, Stats } from "@/components/ui/data";
import { planData, weekFix, weekPlanStatus } from "@/lib/weekplan/service";
import { VERSION_LABEL, addDays, type PlanLine, type Version } from "@/lib/weekplan/contract";
import { dmy, monthName, pct, weekLabel } from "@/lib/weekplan/format";
import {
  codeOf,
  cutLines,
  defaultWeek,
  figure,
  incomplete,
  itemTable,
  metricOf,
  mkey,
  monthOfWeek,
  other,
  partnerChecks,
  products,
  series,
  totalId,
  type ItemRow,
  type PlanData,
} from "@/lib/weekplan/view";
import { FigureTile, ItemTable, LinkSegment, MonthOnlyTable, ProductsTable } from "@/components/weekplan/week-plan";
import { WeekPlanChart } from "@/components/weekplan/week-plan-chart";
import { WeekPlanAdmin } from "@/components/weekplan/week-plan-admin";

export const metadata: Metadata = { title: "Неделя к плану" };

type Tab = "total" | "product" | "partners";
type Params = { tab?: string; week?: string; base?: string; p?: string; m?: string };

const one = (v: unknown) => (Array.isArray(v) ? (v[0] as string | undefined) : (v as string | undefined));

/**
 * Неделя к плану (этап 81): факт недели против бюджета и LRF по неделям. Вкладки «Итог», «Продукт» (у ОСАГО внутри
 * страховые, каналы, типы продаж, регионы), «Партнёрка». План из таблицы недель, факт пока из Weekly Sravni, потом из
 * BI. Видят все (решение Арама 26.10), правка прогноза в разделе «Прогноз»
 */
export default async function PlanFactPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireContext();
  const params = await searchParams;
  const actor = await currentActor();
  const status = await weekPlanStatus(actor);
  const tabParam = one(params.tab);
  const tab: Tab = tabParam === "product" || tabParam === "partners" ? tabParam : "total";
  const base: Version = one(params.base) === "lrf" ? "LRF" : "BUD";
  const metric = one(params.m) === "S" ? "S" : "R";
  const code = one(params.p);
  const today = moscowToday();

  const pick = (lines: PlanLine[]): string[] => {
    if (tab === "total") return lines.filter((l) => l.cut === "итог").map((l) => l.id);
    if (tab === "product") {
      const c = code && lines.some((l) => codeOf(l.id) === code) ? code : codeOf(lines[0]!.id);
      return lines.filter((l) => codeOf(l.id) === c && l.cut !== "партнёр").map((l) => l.id);
    }
    const c = partnerCode(lines, code);
    return lines.filter((l) => codeOf(l.id) === c && (l.cut === "партнёр" || l.id.startsWith(`${c}.PART.`))).map((l) => l.id);
  };
  const data = await planData(pick);

  const admin = status.canLoad ? <WeekPlanAdmin status={status} /> : null;
  if (!data) {
    return (
      <>
        <PageHeader title="Неделя к плану" description="Факт недели против бюджета и LRF">
          {admin}
        </PageHeader>
        <div data-testid="weekplan-empty">
          <Module title="План по неделям ещё не загружен" description="План и факт появятся после загрузки из таблицы недель: кнопка «План и факт» у владельца и администраторов в режиме управления." />
        </div>
      </>
    );
  }

  const weekParam = one(params.week);
  const week = weekParam && data.weeks.includes(weekParam) ? weekParam : defaultWeek(data, today)!;
  const fix = await weekFix(week);
  const idx = data.weeks.indexOf(week);
  const href = (over: Partial<Record<keyof Params, string | null>>) => {
    const q = new URLSearchParams();
    const cur: Record<string, string | undefined> = { tab: tab === "total" ? undefined : tab, week: weekParam ? week : undefined, base: base === "LRF" ? "lrf" : undefined, p: code, m: metric === "S" ? "S" : undefined };
    for (const [k, v] of Object.entries({ ...cur, ...over })) if (v) q.set(k, v);
    const s = q.toString();
    return `/plan-fact${s ? `?${s}` : ""}`;
  };

  const tabs = (
    <PageTabs
      label="Разделы недели к плану"
      tabs={[
        { href: href({ tab: null, p: null }), label: "Итог", active: tab === "total", testId: "weekplan-tab-total" },
        { href: href({ tab: "product" }), label: "Продукт", active: tab === "product", testId: "weekplan-tab-product" },
        { href: href({ tab: "partners", p: null }), label: "Партнёрка", active: tab === "partners", testId: "weekplan-tab-partners" },
      ]}
    />
  );

  const end = addDays(week, 6);
  const partial = incomplete(data, week);
  const factSource = status.sources.factTab;
  const bar = (
    <div className="flex flex-col gap-3" data-testid="weekplan-bar">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Неделя" className="flex items-center gap-2">
          {idx > 0 ? (
            <Link href={href({ week: data.weeks[idx - 1]! })} className="sv-segment__item" aria-label="Прошлая неделя" data-testid="weekplan-prev">
              ←
            </Link>
          ) : null}
          <span className="text-body font-semibold text-ink" data-testid="weekplan-week">
            Неделя {weekLabel(week, end)}
          </span>
          {idx < data.weeks.length - 1 ? (
            <Link href={href({ week: data.weeks[idx + 1]! })} className="sv-segment__item" aria-label="Следующая неделя" data-testid="weekplan-next">
              →
            </Link>
          ) : null}
        </nav>
        <LinkSegment
          label="Версия плана"
          testId="weekplan-base"
          items={[
            { href: href({ base: null }), label: "К бюджету", active: base === "BUD", testId: "weekplan-base-bud" },
            { href: href({ base: "lrf" }), label: "К LRF", active: base === "LRF", testId: "weekplan-base-lrf" },
          ]}
        />
      </div>
      <p className="text-caption text-text-secondary" data-testid="weekplan-status">
        Факт: {factSource === "Факт Weekly для приложения" ? "Weekly Sravni" : `вкладка «${factSource}»`}
        {status.fact.lastOkAt ? `, прочитан ${dmy(status.fact.lastOkAt.slice(0, 10))}` : ", ещё не прочитан"}. Неделя{" "}
        {fix.status === "до фиксации" ? "ещё не зафиксирована (фиксация в понедельник в 18:00 по Москве)" : fix.status === "предварительно" ? `зафиксирована ${dmy(fix.fixedAt!.slice(0, 10))}, предварительно` : `уточнена после фиксации: строк ${fix.refined.length}`}.
        {status.fact.ok === false ? ` Последнее чтение факта не прошло: ${status.fact.error}` : ""}
      </p>
      {partial ? (
        <p className="sv-alert sv-alert--info" data-testid="weekplan-partial">
          План есть не за все дни недели (план начинается {dmy(data.first)}, кончается {dmy(data.last)}): процент к плану по ней не показывается.
        </p>
      ) : null}
    </div>
  );

  const forecastLink = (
    <Link href="/forecast" className="text-small font-medium text-link hover:underline" data-testid="weekplan-forecast-link">
      Поправить прогноз месяца
    </Link>
  );

  let body: React.ReactNode;
  if (tab === "total") body = totalTab(data, week, base, metric, today, href);
  else if (tab === "product") body = productTab(data, week, base, code, today, href);
  else body = partnersTab(data, week, base, code, href);

  return (
    <>
      <PageHeader title="Неделя к плану" description="Факт недели против бюджета и LRF по продуктам, страховым, каналам и партнёрам" tabs={tabs}>
        {admin}
      </PageHeader>
      <div className="flex flex-col gap-6">
        {bar}
        {body}
        <p className="text-caption text-text-secondary">
          План недели: бюджет и LRF из таблицы недель. Месяц к дате: недели, которые начинаются в {monthName(monthOfWeek(week))}, по выбранную; прогноз месяца по темпу этих недель. {forecastLink}
        </p>
      </div>
    </>
  );
}

type Href = (over: Partial<Record<keyof Params, string | null>>) => string;

/** Продукт партнёрки: заданный, иначе первый с партнёрами */
function partnerCode(lines: PlanLine[], code: string | undefined): string {
  const with_ = [...new Set(lines.filter((l) => l.cut === "партнёр").map((l) => codeOf(l.id)))];
  return code && with_.includes(code) ? code : (with_[0] ?? codeOf(lines[0]!.id));
}

function totalTab(data: PlanData, week: string, base: Version, metric: "S" | "R", today: string, href: Href) {
  const revenue = data.lines.filter((l) => l.cut === "итог" && l.unit === "млн ₽").map((l) => l.id);
  const has = (id: string) => data.lines.some((l) => l.id === id);
  const rest = revenue.filter((id) => codeOf(id) !== "OS");
  const s = series(data, revenue, base);
  const rows = products(data.lines).map((p) => {
    const id = totalId(p.code, metric);
    const line = data.lines.find((l) => l.id === id);
    return { code: p.code, name: p.name, href: href({ tab: "product", p: p.code }), unit: line?.unit ?? "млн ₽", figure: line ? figure(data, [id], week, base) : null };
  });
  return (
    <>
      <Stats label="Итоги недели">
        <FigureTile label="Выручка от продаж, все продукты" figure={figure(data, revenue, week, base)} unit="млн ₽" base={base} testId="weekplan-tile-all" />
        {has("OS.TOT.R") ? <FigureTile label="ОСАГО: выручка" figure={figure(data, ["OS.TOT.R"], week, base)} unit="млн ₽" base={base} testId="weekplan-tile-os-r" /> : null}
        {has("OS.TOT.S") ? <FigureTile label="ОСАГО: полисы" figure={figure(data, ["OS.TOT.S"], week, base)} unit="шт" base={base} testId="weekplan-tile-os-s" /> : null}
        {rest.length ? <FigureTile label="Остальные продукты: выручка" figure={figure(data, rest, week, base)} unit="млн ₽" base={base} testId="weekplan-tile-rest" /> : null}
      </Stats>
      <section className="sv-card px-5 py-4">
        <WeekPlanChart title="Выручка от продаж всех продуктов по неделям, млн ₽" weeks={s.weeks} fact={s.fact} plan={s.plan} planLabel={VERSION_LABEL[base]} unit="млн ₽" today={today} />
      </section>
      <Module
        title="Продукты"
        description={`Факт недели против плана «${VERSION_LABEL[base]}», рядом «${VERSION_LABEL[other(base)]}». Клик по продукту открывает его экран.`}
        actions={
          <LinkSegment
            label="Показатель"
            items={[
              { href: href({ m: null }), label: "Выручка", active: metric === "R" },
              { href: href({ m: "S" }), label: "Продажи", active: metric === "S" },
            ]}
          />
        }
        flush
      >
        <ProductsTable rows={rows} base={base} metricLabel={metric === "R" ? "Выручка" : "Продажи"} />
      </Module>
    </>
  );
}

function productTab(data: PlanData, week: string, base: Version, codeParam: string | undefined, today: string, href: Href) {
  const list = products(data.lines);
  const code = codeParam && list.some((p) => p.code === codeParam) ? codeParam : list[0]!.code;
  const name = list.find((p) => p.code === code)!.name;
  const has = (id: string) => data.lines.some((l) => l.id === id);
  const salesId = ["S", "L", "K"].map((m) => totalId(code, m as "S")).find(has) ?? null;
  const revId = has(totalId(code, "R")) ? totalId(code, "R") : null;
  const s = revId ? series(data, [revId], base) : null;
  const block = (title: string, cut: "канал" | "страховая" | "тип продажи" | "регион", head: string, testId: string, shareOf?: string) => {
    const lines = cutLines(data.lines, code, cut);
    if (!lines.length) return null;
    const t = itemTable(data, lines, week, base);
    return (
      <Module key={cut} title={title} flush>
        <ItemTable caption={`${name}: ${title.toLowerCase()}, неделя к плану`} head={head} metrics={t.metrics} rows={t.rows} shareOf={shareOf} testId={testId} />
      </Module>
    );
  };
  const month = monthOfWeek(week);
  const monthly = cutLines(data.lines, code, "только месяц").map((l) => ({ id: l.id, label: l.label, unit: l.unit, bud: data.month.get(mkey(l.id, "BUD", month)) ?? null, lrf: data.month.get(mkey(l.id, "LRF", month)) ?? null }));
  return (
    <>
      <LinkSegment label="Продукт" testId="weekplan-products-pick" items={list.map((p) => ({ href: href({ tab: "product", p: p.code }), label: p.name, active: p.code === code, testId: `weekplan-product-${p.code}` }))} />
      <Stats label={`${name}: итоги недели`}>
        {revId ? <FigureTile label={`${name}: выручка`} figure={figure(data, [revId], week, base)} unit="млн ₽" base={base} testId="weekplan-tile-r" /> : null}
        {salesId ? <FigureTile label={`${name}: ${data.lines.find((l) => l.id === salesId)!.metric.toLowerCase()}`} figure={figure(data, [salesId], week, base)} unit="шт" base={base} testId="weekplan-tile-s" /> : null}
      </Stats>
      {s ? (
        <section className="sv-card px-5 py-4">
          <WeekPlanChart title={`${name}: выручка от продаж по неделям, млн ₽`} weeks={s.weeks} fact={s.fact} plan={s.plan} planLabel={VERSION_LABEL[base]} unit="млн ₽" today={today} />
        </section>
      ) : null}
      {block("Каналы", "канал", "Канал", "weekplan-channels")}
      {block("Страховые", "страховая", "Страховая", "weekplan-sk", "S")}
      {block("Типы продаж", "тип продажи", "Тип продажи", "weekplan-types")}
      {block("Регионы", "регион", "Регион", "weekplan-regions")}
      {monthly.length ? (
        <Module title={`Только по месяцам: ${monthName(month)}`} description="Ретро-бонус, EV, медиа и VAS по неделям не делятся: здесь план месяца." flush>
          <MonthOnlyTable rows={monthly} monthLabel={monthName(month)} />
        </Module>
      ) : null}
    </>
  );
}

function partnersTab(data: PlanData, week: string, base: Version, codeParam: string | undefined, href: Href) {
  const code = partnerCode(data.lines, codeParam);
  const groups = products(data.lines).filter((p) => data.lines.some((l) => l.cut === "партнёр" && codeOf(l.id) === p.code));
  if (!groups.length) return <Module title="Партнёров в плане нет" description="В справочнике строк нет среза «партнёр»." />;
  const name = groups.find((g) => g.code === code)?.name ?? code;
  const lines = cutLines(data.lines, code, "партнёр");
  const t = itemTable(data, lines, week, base);
  // Итог: сумма партнёров по каждому показателю
  const total: ItemRow = { key: "total", name: "Все партнёры", cells: {} };
  for (const m of t.metrics) {
    const ids = lines.filter((l) => metricOf(l.id) === m).map((l) => l.id);
    total.cells[m] = { id: `${code}.PARTNERS.${m}`, unit: lines.find((l) => metricOf(l.id) === m)!.unit, figure: figure(data, ids, week, base) };
  }
  const checks = partnerChecks(data, code, week);
  const bad = checks.filter((c) => !c.ok);
  return (
    <>
      <LinkSegment label="Продукт партнёрки" testId="weekplan-partner-groups" items={groups.map((g) => ({ href: href({ tab: "partners", p: g.code }), label: g.name, active: g.code === code, testId: `weekplan-group-${g.code}` }))} />
      <Module
        title={`${name}: партнёры`}
        description={
          checks.length
            ? bad.length
              ? `Сумма плана партнёров не сходится с каналом партнёров: ${bad.map((c) => `${c.metric === "S" ? "продажи" : "выручка"} ${VERSION_LABEL[c.version]} ${pct(c.channel ? c.partners / c.channel - 1 : null)}`).join(", ")}`
              : "Сумма плана партнёров равна каналу партнёров продукта (бюджет и LRF)."
            : "Партнёры ОСАГО внутри канала b2b: отдельной строки канала партнёров нет, сверки нет."
        }
        flush
      >
        <ItemTable caption={`${name}: партнёры, неделя к плану`} head="Партнёр" metrics={t.metrics} rows={t.rows} total={total} testId="weekplan-partners" />
      </Module>
    </>
  );
}
