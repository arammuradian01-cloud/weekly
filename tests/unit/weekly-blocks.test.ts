import { describe, expect, it } from "vitest";
import {
  STANDARD_BLOCKS,
  STANDARD_TEMPLATE,
  blocksText,
  blocksToLegacy,
  cleanBlocks,
  cleanTemplate,
  draftBlocksOf,
  hasBlocksText,
  legacyToBlocks,
  lineText,
  mergeBlocks,
  newCustomKey,
  productGroups,
  productOfText,
  safeHref,
  type ReportBlock,
} from "@/lib/weekly-blocks/types";
import { assembleBlocks, entryBlockKey, figureProduct, fmtPct, growthText, monthBlock, wowBlock, type AssembleInput, type MonthInput, type NewsInput, type TaskInput } from "@/lib/weekly-blocks/assemble";
import { addLine, defaultProduct, fromLegacy, moveBlock, patchLine, rebuildBlock, removeLine, setHidden, withoutEmptyLines } from "@/lib/weekly-blocks/edit";
import { DEFAULT_COMPETITORS, cleanCompetitors, competitorsOf } from "@/lib/weekly-blocks/competitors";
import { ceoBlocksText } from "@/lib/ceo/text";

// Этап 66: weekly по смысловым блокам. Шаблон блоков, продукт строки, сборка блоков из фикстур (цифры недели с ростом и
// падением, месяц с планом продаж и честным «нет данных», новости и конкуренты, записи weekly, задачи, цели, разбор
// встречи), правки редактора, слияние черновика с отчётом недели, текст для копирования

const PRODUCTS = [
  { code: "osago", label: "ОСАГО" },
  { code: "kasko", label: "КАСКО" },
  { code: "red", label: "RED" },
  { code: "deposits", label: "Депозиты и инвестиции" },
  { code: "partners", label: "Партнёрка" },
  { code: "product", label: "Продукт и CJM" },
  { code: "insurance", label: "Страхование в целом" },
  { code: "department", label: "Департамент" },
];
const LABELS = Object.fromEntries(PRODUCTS.map((p) => [p.code, p.label]));
const ORDER = PRODUCTS.map((p) => p.code);

const block = (key: string, lines: ReportBlock["lines"], extra: Partial<ReportBlock> = {}): ReportBlock => ({
  key,
  title: STANDARD_BLOCKS.find((b) => b.key === key)?.title ?? key,
  hidden: false,
  lines,
  note: null,
  ...extra,
});
const l = (product: string | null, text: string, href: string | null = null, source: string | null = null) => ({ product, text, href, source });

const EMPTY: AssembleInput = {
  template: STANDARD_TEMPLATE,
  products: PRODUCTS,
  wow: null,
  month: null,
  news: [],
  competitors: DEFAULT_COMPETITORS,
  entries: [],
  done: [],
  atRisk: [],
  next: [],
  goals: [],
  notion: null,
  focus: null,
};

const byKey = (blocks: ReportBlock[], key: string) => blocks.find((b) => b.key === key)!;

describe("стандартный шаблон", () => {
  it("восемь блоков в порядке отчёта CEO", () => {
    expect(STANDARD_BLOCKS.map((b) => b.title)).toEqual([
      "Новости рынка и команды",
      "Неделя к неделе",
      "Месяц: к прошлому году, к прошлому месяцу, план продаж",
      "Конкуренты",
      "Продукты",
      "Партнёрский канал",
      "Риски",
      "План на неделю",
    ]);
    // Видимые тексты без длинного тире и стрелок
    expect(JSON.stringify(STANDARD_BLOCKS)).not.toMatch(/[—–→·]/);
  });

  it("шаблон команды: стандартные блоки со своим названием, свои блоки по ключу c:, повторы и мусор отбрасываются", () => {
    const key = newCustomKey(() => 0.5);
    expect(key).toMatch(/^c:[a-z0-9]{8}$/);
    expect(
      cleanTemplate([
        { key: "products", title: "Мои продукты" },
        { key: key, title: "  Найм — и онбординг " },
        { key: "products" },
        { key: "c:bad key", title: "x" },
        { key: "c:abcd", title: "" },
        "строка",
        { key: "risks" },
      ]),
    ).toEqual([
      { key: "products", title: "Продукты" },
      { key, title: "Найм - и онбординг" },
      { key: "risks", title: "Риски" },
    ]);
    expect(cleanTemplate(null)).toEqual([]);
  });
});

describe("продукт строки", () => {
  it("название продукта в начале строки снимается, признак внутри строки остаётся в тексте", () => {
    expect(productOfText("ОСАГО. Конверсия 12%", PRODUCTS)).toEqual({ product: "osago", rest: "Конверсия 12%" });
    expect(productOfText("Партнёры: два новых агрегатора", PRODUCTS)).toEqual({ product: "partners", rest: "два новых агрегатора" });
    expect(productOfText("Депозиты и инвестиции - ставки снизились", PRODUCTS)).toEqual({ product: "deposits", rest: "ставки снизились" });
    expect(productOfText("Конверсия ОСАГО выросла до 12%", PRODUCTS)).toEqual({ product: "osago", rest: "Конверсия ОСАГО выросла до 12%" });
    expect(productOfText("ВЗР: тариф не поднимаем", PRODUCTS).product).toBe("red");
    expect(productOfText("Партнёрский канал отстаёт от плана на 8%", PRODUCTS).product).toBe("partners");
    // «взрыв» не ВЗР, «осаговский» по началу слова тоже ОСАГО
    expect(productOfText("Взрыв спроса на кофе", PRODUCTS).product).toBeNull();
    expect(productOfText("Задержка данных от СК", PRODUCTS)).toEqual({ product: null, rest: "Задержка данных от СК" });
  });

  it("продукт цифры недели по её названию", () => {
    expect(figureProduct("TRAFFIC / TOTAL / OSAGO", PRODUCTS)).toBe("osago");
    expect(figureProduct("Трафик КАСКО", PRODUCTS)).toBe("kasko");
    expect(figureProduct("Клики по вкладам", PRODUCTS)).toBe("deposits");
    expect(figureProduct("Выручка всего", PRODUCTS)).toBeNull();
  });

  it("строка текстом подписана продуктом, но название второй раз не пишется", () => {
    expect(lineText(l("osago", "Конверсия 12%"), LABELS)).toBe("ОСАГО. Конверсия 12%");
    expect(lineText(l("osago", "ОСАГО: конверсия 12%"), LABELS)).toBe("ОСАГО: конверсия 12%");
    expect(lineText(l(null, "Общая строка"), LABELS)).toBe("Общая строка");
  });
});

describe("проверка блоков с экрана и из базы", () => {
  it("неизвестные ключи, повторы, пустые строки и чужие ссылки отбрасываются, тексты чистятся", () => {
    const out = cleanBlocks(
      [
        { key: "products", title: "", hidden: false, lines: [{ product: "osago", text: " Рост — 5%  → дальше ", href: "javascript:alert(1)", source: "x" }, { product: "nope", text: "без продукта" }, { text: "   " }] },
        { key: "products", lines: [] },
        { key: "hack", lines: [{ text: "x" }] },
        { key: "wow", hidden: true, note: "Нет данных · вообще", lines: [{ product: "kasko", text: "Трафик", href: "/forecast?tab=week", source: "Цифры недели" }] },
        { key: "news", lines: [{ product: "osago", text: "Новость", href: "https://cbr.ru/press/1", source: "Банк России" }, { product: "osago", text: "Двойной слэш", href: "//evil.example" }] },
      ],
      new Set(ORDER),
    );
    expect(out.map((b) => b.key)).toEqual(["products", "wow", "news"]);
    expect(out[0]).toMatchObject({ title: "Продукты", lines: [l("osago", "Рост - 5% - дальше"), l(null, "без продукта")] });
    expect(out[1]).toMatchObject({ hidden: true, note: "Нет данных, вообще", lines: [l("kasko", "Трафик", "/forecast?tab=week", "Цифры недели")] });
    expect(out[2]!.lines).toEqual([l("osago", "Новость", "https://cbr.ru/press/1", "Банк России"), l("osago", "Двойной слэш")]);
    expect(cleanBlocks("не список", null)).toEqual([]);
    expect(safeHref("/tasks/12")).toBe("/tasks/12");
    expect(safeHref("ftp://x")).toBeNull();
  });
});

describe("прежние разделы и блоки", () => {
  it("старый отчёт раскладывается по блокам: продукты, партнёрка, новости, риски, план; строка без продукта подписана департаментом", () => {
    const blocks = legacyToBlocks({ main: "- ОСАГО. Конверсия 12%\n- Партнёры: два агрегатора\n- Бюджет 2027 защищён", risks: "- Задержка данных от СК", next: "- КАСКО. Пилот в ноябре" }, PRODUCTS);
    expect(blocks.map((b) => b.key)).toEqual(STANDARD_BLOCKS.map((b) => b.key));
    expect(byKey(blocks, "products").lines).toEqual([l("osago", "Конверсия 12%")]);
    expect(byKey(blocks, "partners").lines).toEqual([l("partners", "два агрегатора")]);
    expect(byKey(blocks, "news").lines).toEqual([l("department", "Бюджет 2027 защищён")]);
    expect(byKey(blocks, "risks").lines).toEqual([l("department", "Задержка данных от СК")]);
    expect(byKey(blocks, "plan").lines).toEqual([l("kasko", "Пилот в ноябре")]);
  });

  it("разделы из блоков для выгрузки: видимые блоки с заголовком в главном, риски и план отдельно, скрытое не попадает", () => {
    const blocks = [
      block("news", [l("department", "Бюджет защищён")]),
      block("competitors", [l("osago", "Пампаду: новость")], { hidden: true }),
      block("products", [l("kasko", "Пилот такси"), l("osago", "Конверсия 12%")]),
      block("risks", [l("osago", "Задержка выгрузки")]),
      block("plan", [l("kasko", "Итоги пилота")]),
    ];
    expect(blocksToLegacy(blocks, LABELS, ORDER)).toEqual({
      main: "Новости рынка и команды:\n- Департамент. Бюджет защищён\nПродукты:\n- ОСАГО. Конверсия 12%\n- КАСКО. Пилот такси",
      risks: "- ОСАГО. Задержка выгрузки",
      next: "- КАСКО. Итоги пилота",
    });
    expect(blocksText(blocks, LABELS, ORDER)).toEqual([
      "Новости рынка и команды",
      "- Департамент. Бюджет защищён",
      "",
      "Продукты",
      "- ОСАГО. Конверсия 12%",
      "- КАСКО. Пилот такси",
      "",
      "Риски",
      "- ОСАГО. Задержка выгрузки",
      "",
      "План на неделю",
      "- КАСКО. Итоги пилота",
      "",
    ]);
    expect(hasBlocksText(blocks)).toBe(true);
    expect(hasBlocksText([block("news", [l(null, "x")], { hidden: true })])).toBe(false);
  });

  it("продукты подразделами в порядке справочника", () => {
    const groups = productGroups([l("kasko", "a"), l("osago", "b"), l(null, "c"), l("kasko", "d")], ORDER);
    expect(groups.map((g) => [g.product, g.items.map((i) => i.index)])).toEqual([
      ["osago", [1]],
      ["kasko", [0, 3]],
      [null, [2]],
    ]);
  });

  it("черновик разбора встречи: новый вид и прежний", () => {
    expect(draftBlocksOf([block("risks", [l("osago", "Риск")])], PRODUCTS)).toEqual([block("risks", [l("osago", "Риск")])]);
    const old = draftBlocksOf({ main: "- ОСАГО: рост", risks: "", next: "" }, PRODUCTS);
    expect(byKey(old, "products").lines).toEqual([l("osago", "рост")]);
    expect(draftBlocksOf(null, PRODUCTS)).toEqual([]);
  });
});

describe("слияние черновика с отчётом недели", () => {
  const existing = [block("wow", [l("osago", "Трафик +2%")]), block("products", [l("osago", "Конверсия 12%")]), block("competitors", [], { hidden: true }), block("risks", [l("osago", "Риск А")], { hidden: true })];
  const draft = [block("products", [l("osago", "конверсия 12 %"), l("kasko", "Пилот такси")]), block("competitors", [l("osago", "Пампаду: тариф")]), block("risks", [l("kasko", "Риск Б")])];

  it("дописать: новые строки в конец, повтор не попадает, пустой скрытый блок открывается, скрытый со строками остаётся скрытым", () => {
    const out = mergeBlocks(existing, draft, "merge");
    expect(byKey(out, "wow").lines).toEqual([l("osago", "Трафик +2%")]);
    expect(byKey(out, "products").lines).toEqual([l("osago", "Конверсия 12%"), l("kasko", "Пилот такси")]);
    expect(byKey(out, "competitors")).toMatchObject({ hidden: false, lines: [l("osago", "Пампаду: тариф")] });
    expect(byKey(out, "risks")).toMatchObject({ hidden: true, lines: [l("osago", "Риск А"), l("kasko", "Риск Б")] });
  });

  it("заменить: блоки черновика целиком, цифры недели не трогаются", () => {
    const out = mergeBlocks(existing, draft, "replace");
    expect(byKey(out, "wow").lines).toEqual([l("osago", "Трафик +2%")]);
    expect(byKey(out, "products").lines).toEqual([l("osago", "конверсия 12 %"), l("kasko", "Пилот такси")]);
    expect(byKey(out, "risks")).toMatchObject({ hidden: false, lines: [l("kasko", "Риск Б")] });
  });
});

describe("неделя к неделе", () => {
  it("рост и падение в абсолютных и процентах, доли в пунктах, без изменений", () => {
    expect(growthText(512000, 504337, "count")).toBe("рост на 7 663 (+1,5%)");
    expect(growthText(95, 100, "count")).toBe("падение на 5 (-5,0%)");
    expect(growthText(12.5, 10, "mln")).toBe("рост на 2,5 млн (+25,0%)");
    expect(growthText(0.121, 0.117, "pct")).toBe("рост на 0,4 п.п.");
    expect(growthText(0.1, 0.12, "pct")).toBe("падение на 2 п.п.");
    expect(growthText(100, 100, "count")).toBe("без изменений");
    expect(fmtPct(-2.44)).toBe("-2,4%");
  });

  it("цифры недели строками с продуктом и ссылкой на «Прогноз»; нет отчёта или цифр: честно «нет данных»", () => {
    const w = wowBlock(
      {
        connected: true,
        ready: true,
        week: "2026-10-12",
        latestWeek: "2026-10-12",
        href: "/forecast?tab=week&week=2026-10-12",
        figures: [
          { label: "Трафик ОСАГО", unit: "count", value: 512000, prev: 504337 },
          { label: "CR КАСКО", unit: "pct", value: 0.1, prev: 0.12 },
          { label: "Выручка всего", unit: "mln", value: 120, prev: null },
        ],
        sales: [{ product: "osago", label: "ОСАГО", forms: ["полис", "полиса", "полисов"], value: 9800, prev: 10000, href: "/forecast?month=2026-10" }],
      },
      PRODUCTS,
      null,
      "department",
    );
    expect(w.note).toBeNull();
    expect(w.lines).toEqual([
      l("osago", "ОСАГО: продажи за неделю 9 800 полисов, падение на 200 (-2,0%) к прошлой неделе", "/forecast?month=2026-10", "Факт по дням"),
      l("osago", "Трафик ОСАГО: 512 000, рост на 7 663 (+1,5%) к прошлой неделе", "/forecast?tab=week&week=2026-10-12", "Цифры недели"),
      l("kasko", "CR КАСКО: 10%, падение на 2 п.п. к прошлой неделе", "/forecast?tab=week&week=2026-10-12", "Цифры недели"),
      l("department", "Выручка всего: 120 млн, прошлой недели в отчёте нет", "/forecast?tab=week&week=2026-10-12", "Цифры недели"),
    ]);
    expect(wowBlock({ connected: false, ready: false, week: "2026-10-12", latestWeek: null, href: "/x", figures: [], sales: [] }, PRODUCTS, null, null).note).toBe("Нет данных: недельный отчёт не подключён");
    expect(wowBlock({ connected: true, ready: false, week: "2026-10-12", latestWeek: "2026-10-05", href: "/x", figures: [{ label: "a", unit: "count", value: null, prev: null }], sales: [] }, PRODUCTS, null, null).note).toBe(
      "Нет данных: за неделю с 12.10 цифр в недельном отчёте ещё нет, последняя неделя с 05.10",
    );
    expect(wowBlock({ closed: true, connected: true, ready: true, week: "", latestWeek: null, href: "", figures: [], sales: [] }, PRODUCTS, null, null).note).toMatch(/видят те, кому открыт прогноз/);
    // Команда смотрит только на свои продукты
    const kasko = wowBlock({ connected: true, ready: true, week: "2026-10-12", latestWeek: null, href: "/x", figures: [{ label: "Трафик ОСАГО", unit: "count", value: 1, prev: 1 }, { label: "Трафик КАСКО", unit: "count", value: 2, prev: 1 }], sales: [] }, PRODUCTS, ["kasko"], null);
    expect(kasko.lines.map((x) => x.product)).toEqual(["kasko"]);
  });
});

const MONTH: MonthInput = {
  month: "2026-10",
  monthLabel: "октябрь 2026",
  href: "/forecast?month=2026-10",
  asOf: null,
  products: [
    { product: "osago", label: "ОСАГО", forms: ["полис", "полиса", "полисов"], units: { forecast: 41200, budget: 40000 }, revenue: { forecast: 120.5, budget: 118 }, prevMonth: { units: 40000, revenue: 110 }, prevYear: null },
    { product: "kasko", label: "КАСКО", forms: ["лид", "лида", "лидов"], units: { forecast: 900, budget: 1000 }, revenue: { forecast: 30, budget: 33 }, prevMonth: null, prevYear: null },
  ],
  total: { revenue: { forecast: 150.5, budget: 151 }, prevMonth: 140, prevYear: null },
  prevMonthLabel: "сентябрь 2026",
  prevYearLabel: "октябрь 2025",
  hasPrevMonth: true,
  hasPrevYear: false,
  hub: { mtd: 25400, plan: 40000, forecast: 41000, day: "2026-10-21", prevTotal: 39000, href: "/forecast?month=2026-10" },
  partners: { revenue: { forecast: 50, budget: 55 }, href: "/forecast?tab=partners&month=2026-10" },
};

describe("месяц", () => {
  it("план продаж по продуктам и итог, прошлый месяц только где есть, прошлого года нет: «нет данных»; хаб и партнёры", () => {
    const m = monthBlock(MONTH, null, "department");
    const src = "Прогноз, октябрь 2026";
    expect(m.lines).toEqual([
      l("osago", "ОСАГО: продажи 41 200 полисов при плане 40 000, план выполняем (+3,0%); выручка 120,5 млн при бюджете 118 млн (+2,1%); продажи к прошлому месяцу +3,0%", MONTH.href, src),
      l("kasko", "КАСКО: продажи 900 лидов при плане 1 000, план не выполняем (-10,0%); выручка 30,0 млн при бюджете 33,0 млн (-9,1%)", MONTH.href, src),
      l("department", "Итого по продуктам: выручка 150,5 млн при бюджете 151 млн, план не выполняем (-0,3%); к прошлому месяцу +7,5%", MONTH.href, src),
      l("osago", "ОСАГО по СК: факт с начала месяца 25 400 полисов по 21.10, ранрейт 41 000 при плане 40 000 (+2,5%), к прошлому месяцу +5,1%", MONTH.href, "Хаб: ОСАГО по СК"),
      l("department", "К прошлому году (октябрь 2025): нет данных, в LRF этого месяца нет"),
    ]);
    expect(m.partners).toEqual([l("partners", "Партнёрский канал: выручка 50,0 млн при бюджете 55,0 млн, план не выполняем (-9,1%)", "/forecast?tab=partners&month=2026-10", "Прогноз: партнёры, октябрь 2026")]);
    expect(monthBlock(null, null, null)).toMatchObject({ lines: [], note: "Нет данных: прогноз месяца ещё не загружен из LRF" });
    expect(monthBlock("closed", null, null).note).toMatch(/видят те, кому открыт прогноз/);
    const both = monthBlock({ ...MONTH, hasPrevMonth: false, hub: null }, null, null);
    expect(both.lines.at(-1)!.text).toBe("К прошлому месяцу (сентябрь 2026) и к прошлому году (октябрь 2025): нет данных, в LRF этих месяцев нет");
  });
});

const NEWS: NewsInput[] = [
  { title: "ЦБ изменил тарифный коридор ОСАГО", url: "https://cbr.ru/1", source: "Банк России", directions: ["osago"], summary: "" },
  { title: "Пампаду запустил КАСКО по подписке", url: "https://asn-news.ru/2", source: "АСН", directions: ["kasko"], summary: "" },
  { title: "Ставки по вкладам снизились", url: "https://banki.ru/3", source: "Банки.ру: новости", directions: ["deposits"], summary: "" },
  { title: "Ещё про ОСАГО", url: "https://cbr.ru/4", source: "Банк России", directions: ["osago"], summary: "" },
  { title: "И снова ОСАГО", url: "https://cbr.ru/5", source: "Банк России", directions: ["osago"], summary: "" },
];

const task = (number: number, direction: string, extra: Partial<TaskInput> = {}): TaskInput => ({ number, title: `Задача про ${direction} ${number}`, direction, due: "2026-10-28", blocked: false, note: null, rank: 2, ...extra });

describe("сборка блоков", () => {
  it("новости рынка без конкурентов, не больше двух на продукт; конкуренты своим блоком; нет новостей по конкурентам: блок скрыт", () => {
    const out = assembleBlocks({ ...EMPTY, news: NEWS });
    expect(byKey(out, "news").lines).toEqual([
      l("osago", "ЦБ изменил тарифный коридор ОСАГО", "https://cbr.ru/1", "Банк России"),
      l("deposits", "Ставки по вкладам снизились", "https://banki.ru/3", "Банки.ру: новости"),
      l("osago", "Ещё про ОСАГО", "https://cbr.ru/4", "Банк России"),
    ]);
    expect(byKey(out, "competitors")).toMatchObject({ hidden: false, lines: [l("kasko", "Пампаду: Пампаду запустил КАСКО по подписке", "https://asn-news.ru/2", "АСН")] });
    const none = assembleBlocks({ ...EMPTY, news: [NEWS[0]!] });
    expect(byKey(none, "competitors")).toMatchObject({ hidden: true, lines: [], note: "Новостей по конкурентам за неделю нет: блок скрыт" });
  });

  it("записи weekly по смыслу и по блоку шаблона, «что дальше» в план, ссылка на артефакт, каждая строка с продуктом", () => {
    const entry = (extra: Partial<AssembleInput["entries"][number]>) => ({ direction: "osago", block: "key-changes", type: "result", section: null, what: "Запустили тест.", fact: null, impact: null, next: null, link: null, ...extra });
    const out = assembleBlocks({
      ...EMPTY,
      entries: [
        entry({ what: "Конверсия выросла до 12%.", fact: "+2 п.п.", next: "Раскатить на всех", link: { url: "https://docs.example/1", title: "Дашборд" } }),
        entry({ direction: "kasko", type: "risk", what: "Срыв интеграции" }),
        entry({ direction: "partners", what: "Подключили агрегатор" }),
        entry({ direction: "department", block: "team", type: "event", what: "Вышел новый аналитик" }),
        entry({ direction: "red", type: "plan", what: "Пилот", next: "Запуск пилота ипотеки" }),
        entry({ direction: "deposits", section: "risks", what: "Сдано в блок рисков" }),
      ],
    });
    expect(byKey(out, "products").lines).toEqual([l("osago", "Конверсия выросла до 12%. +2 п.п", "https://docs.example/1", "Дашборд")]);
    expect(byKey(out, "risks").lines).toEqual([l("kasko", "Срыв интеграции"), l("deposits", "Сдано в блок рисков")]);
    expect(byKey(out, "partners").lines).toEqual([l("partners", "Подключили агрегатор")]);
    expect(byKey(out, "news").lines).toEqual([l("department", "Вышел новый аналитик")]);
    expect(byKey(out, "plan").lines).toEqual([l("osago", "Раскатить на всех"), l("red", "Запуск пилота ипотеки")]);
    for (const b of out) for (const x of b.lines) expect(x.product).not.toBeNull();
    expect(entryBlockKey({ section: "c:abcd1234", type: "result", block: "x", direction: "osago" }, ["c:abcd1234", "risks"])).toBe("c:abcd1234");
    expect(entryBlockKey({ section: null, type: "result", block: "x", direction: "osago" }, ["risks", "c:abcd1234"])).toBe("risks");
  });

  it("задачи: выполненные в продукты и партнёрку, под риском и заблокированные в риски, со сроком на неделе в план; не больше трёх на продукт", () => {
    const out = assembleBlocks({
      ...EMPTY,
      done: [task(101, "osago"), task(102, "partners"), task(103, "osago"), task(104, "osago"), task(105, "osago", { rank: 0 })],
      atRisk: [task(201, "kasko", { blocked: true, note: "Ждём СК" }), task(202, "red", { note: "Нет данных." })],
      next: [task(301, "deposits", { due: "2026-10-27" })],
      goals: [{ code: "D1", title: "Маржа департамента", product: null, note: "Отстаём" }],
    });
    expect(byKey(out, "products").lines.map((x) => x.text)).toEqual(["Задача 105 выполнена: Задача про osago 105", "Задача 101 выполнена: Задача про osago 101", "Задача 103 выполнена: Задача про osago 103"]);
    expect(byKey(out, "products").lines[0]).toMatchObject({ href: "/tasks/105", source: "Задача 105" });
    expect(byKey(out, "partners").lines.map((x) => x.text)).toEqual(["Задача 102 выполнена: Задача про partners 102"]);
    expect(byKey(out, "risks").lines).toEqual([
      l("kasko", "Задача 201 заблокирована: Задача про kasko 201. Ждём СК", "/tasks/201", "Задача 201"),
      l("red", "Задача 202 под риском: Задача про red 202. Нет данных", "/tasks/202", "Задача 202"),
      l("department", "Цель D1 в риске: Маржа департамента. Отстаём", "/goals", "Цели"),
    ]);
    expect(byKey(out, "plan").lines).toEqual([l("deposits", "Задача про deposits 301, срок 27.10", "/tasks/301", "Задача 301")]);
  });

  it("разбор встречи дописывается в свои блоки без повторов; цифры недели и месяца из разбора не берутся; пустые блоки честно пустые", () => {
    const out = assembleBlocks({
      ...EMPTY,
      entries: [{ direction: "osago", block: "x", type: "result", section: null, what: "Конверсия 12%", fact: null, impact: null, next: null, link: null }],
      notion: [block("products", [l("osago", "конверсия 12%"), l("kasko", "Пилот такси")]), block("wow", [l("osago", "Выдуманная цифра")]), block("risks", [l("zzz", "Чужой продукт")])],
    });
    expect(byKey(out, "products").lines).toEqual([l("osago", "Конверсия 12%"), l("kasko", "Пилот такси")]);
    expect(byKey(out, "wow")).toMatchObject({ lines: [], note: "Нет данных: цифры недели не собирались" });
    expect(byKey(out, "risks").lines).toEqual([l("department", "Чужой продукт")]);
    expect(byKey(out, "plan")).toMatchObject({ lines: [], note: "За неделю ничего нет", hidden: false });
  });

  it("шаблон команды: только её блоки, свой блок из записей, сданных по нему", () => {
    const out = assembleBlocks({
      ...EMPTY,
      template: [{ key: "products", title: "Продукты" }, { key: "c:hire0001", title: "Найм" }],
      entries: [
        { direction: "osago", block: "x", type: "result", section: "c:hire0001", what: "Закрыли вакансию аналитика", fact: null, impact: null, next: null, link: null },
        { direction: "osago", block: "x", type: "risk", section: null, what: "Риск без блока рисков", fact: null, impact: null, next: null, link: null },
      ],
    });
    expect(out.map((b) => b.key)).toEqual(["products", "c:hire0001"]);
    expect(byKey(out, "c:hire0001").lines).toEqual([l("osago", "Закрыли вакансию аналитика")]);
    expect(byKey(out, "products").lines).toEqual([l("osago", "Риск без блока рисков")]);
  });
});

describe("правки редактора", () => {
  const blocks = [block("news", [l("osago", "a")]), block("wow", []), block("risks", [l("kasko", "b"), l("kasko", "c")])];

  it("поднять, опустить, скрыть, поправить, добавить и убрать строку", () => {
    expect(moveBlock(blocks, "wow", -1).map((b) => b.key)).toEqual(["wow", "news", "risks"]);
    expect(moveBlock(blocks, "news", -1).map((b) => b.key)).toEqual(["news", "wow", "risks"]);
    expect(moveBlock(blocks, "risks", 1).map((b) => b.key)).toEqual(["news", "wow", "risks"]);
    expect(setHidden(blocks, "wow", true)[1]!.hidden).toBe(true);
    const patched = patchLine(blocks, "risks", 1, { text: "Срыв — сроков → снова", product: "osago" });
    expect(patched[2]!.lines[1]).toEqual(l("osago", "Срыв - сроков - снова"));
    expect(patchLine([block("news", [l("osago", "x", "/forecast", "Прогноз")])], "news", 0, { href: null })[0]!.lines[0]).toEqual(l("osago", "x"));
    const added = addLine(setHidden(blocks, "wow", true), "wow", "department");
    expect(added[1]).toMatchObject({ hidden: false, lines: [l("department", "")] });
    expect(removeLine(blocks, "risks", 0)[2]!.lines).toEqual([l("kasko", "c")]);
    expect(withoutEmptyLines(added)[1]!.lines).toEqual([]);
    // Исходный список не меняется
    expect(blocks[2]!.lines).toHaveLength(2);
  });

  it("собрать блок заново, продукт новой строки, старый отчёт с живыми цифрами", () => {
    const fresh = [block("wow", [l("osago", "свежая цифра")], { note: "Прогноз на сейчас" })];
    expect(rebuildBlock(blocks, fresh, "wow")[1]).toMatchObject({ lines: [l("osago", "свежая цифра")], note: "Прогноз на сейчас" });
    expect(defaultProduct("partners", PRODUCTS)).toBe("partners");
    expect(defaultProduct("products", PRODUCTS)).toBe("osago");
    expect(defaultProduct("risks", PRODUCTS)).toBe("department");
    const mixed = fromLegacy({ main: "- ОСАГО. Рост", risks: "", next: "" }, [block("wow", [l("osago", "Трафик +1%")]), block("products", [l("kasko", "не из автосборки")])], PRODUCTS);
    expect(byKey(mixed, "wow").lines).toEqual([l("osago", "Трафик +1%")]);
    expect(byKey(mixed, "products").lines).toEqual([l("osago", "Рост")]);
  });
});

describe("конкуренты", () => {
  it("стартовый список, чистка списка с экрана", () => {
    expect(competitorsOf(null).map((c) => c.name)).toEqual(["Банки.ру", "Выберу.ру", "Пампаду", "Т-Банк (агрегатор страхования)", "Инсапп", "Cherehapa", "Финуслуги"]);
    expect(competitorsOf([])).toEqual([]);
    expect(cleanCompetitors([{ name: " Пампаду ", keywords: "Пампаду, Pampadu, Пампаду" }, { name: "пампаду", keywords: "x" }, { name: "Новый" }, { name: "", keywords: "y" }])).toEqual([
      { name: "Пампаду", keywords: ["Пампаду", "Pampadu"] },
      { name: "Новый", keywords: ["Новый"] },
    ]);
  });
});

describe("текст отчёта по блокам", () => {
  it("видимые блоки по порядку, потом обещания, решения, благодарности и встречи", () => {
    const text = ceoBlocksText({
      weekNumber: 43,
      blocks: [block("news", [l("osago", "Новость")]), block("competitors", [], { hidden: true }), block("risks", [l("kasko", "Риск")])],
      labels: LABELS,
      order: ORDER,
      promises: "Сделано 2 из 3",
      decisions: [{ text: "Пилот в ноябре", owner: "Мурадян Арам" }],
      thanks: [{ name: "Тарас Р.", text: "За сверку" }],
      meetings: [{ title: "Встреча с ВСК", text: "Договорились о планах." }],
    });
    expect(text).toBe(
      [
        "Отчёт за неделю 43",
        "",
        "Новости рынка и команды",
        "- ОСАГО. Новость",
        "",
        "Риски",
        "- КАСКО. Риск",
        "",
        "Обещания недели",
        "Сделано 2 из 3",
        "",
        "Решения недели",
        "- Пилот в ноябре. Владелец: Мурадян Арам",
        "",
        "Благодарности",
        "- Тарас Р.: За сверку",
        "",
        "Мои встречи недели",
        "Встреча с ВСК",
        "Договорились о планах.",
      ].join("\n"),
    );
    expect(text).not.toMatch(/Конкуренты/);
  });
});
