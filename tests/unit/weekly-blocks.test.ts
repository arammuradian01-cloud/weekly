import { describe, expect, it } from "vitest";
import {
  NUMBERS_HIDDEN_TEXT,
  STANDARD_BLOCKS,
  STANDARD_TEMPLATE,
  alignToTemplate,
  blocksForLevel,
  blocksText,
  blocksToLegacy,
  cleanBlocks,
  cleanTemplate,
  draftBlocksOf,
  fingerprint,
  hasBlocksText,
  keepLockedBlocks,
  legacyToBlocks,
  lockedFor,
  lineText,
  mergeBlocks,
  newCustomKey,
  productGroups,
  productOfText,
  restoreHiddenFigures,
  safeHref,
  sentBlocks,
  withLiveBlocks,
  type BlockLine,
  type FigureLevel,
  type ReportBlock,
} from "@/lib/weekly-blocks/types";
import { assembleBlocks, competitorLines, competitorMatches, competitorOf, entryBlockKey, figureProduct, fmtPct, growthText, monthBlock, wowBlock, type AssembleInput, type MonthInput, type NewsInput, type TaskInput } from "@/lib/weekly-blocks/assemble";
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
const l = (product: string | null, text: string, href: string | null = null, source: string | null = null): BlockLine => ({ product, text, href, source });
/** Строка с цифрами уровня доступа */
const fig = (line: BlockLine, figures: FigureLevel): BlockLine => ({ ...line, figures });

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

  it("«вклад» и «инвестиции» подписывают депозиты только в продуктовом смысле", () => {
    expect(productOfText("Вклад команды в запуск оценили на встрече", PRODUCTS).product).toBeNull();
    expect(productOfText("Инвестиции в маркетинг выросли", PRODUCTS).product).toBeNull();
    expect(productOfText("Ставки по вкладам выросли", PRODUCTS).product).toBe("deposits");
    expect(productOfText("Запустили новый оффер по вкладам", PRODUCTS).product).toBe("deposits");
    expect(productOfText("Открыли вклад на 6 месяцев", PRODUCTS).product).toBe("deposits");
    expect(productOfText("Пилот ИИС для клиентов", PRODUCTS).product).toBe("deposits");
    expect(productOfText("Инвестиционный продукт для новичков", PRODUCTS).product).toBe("deposits");
    expect(productOfText("Инвестиции: запустили подборку", PRODUCTS).product).toBe("deposits");
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

  it("заменить: написанные строки блоков черновика, цифры недели не трогаются", () => {
    const out = mergeBlocks(existing, draft, "replace");
    expect(byKey(out, "wow").lines).toEqual([l("osago", "Трафик +2%")]);
    expect(byKey(out, "products").lines).toEqual([l("osago", "конверсия 12 %"), l("kasko", "Пилот такси")]);
    expect(byKey(out, "risks")).toMatchObject({ hidden: false, lines: [l("kasko", "Риск Б")] });
  });

  it("заменить: пустой блок черновика ничего не стирает, собранные строки со ссылкой на источник остаются", () => {
    const base = [block("news", [l("osago", "Новость ЦБ", "https://cbr.ru/1", "Банк России"), l("department", "Написали руками")]), block("plan", [l("osago", "Задача 7, срок 28.10", "/tasks/7", "Задача 7")])];
    const out = mergeBlocks(base, [block("news", [l("kasko", "С встречи")]), block("plan", [])], "replace");
    expect(byKey(out, "news").lines).toEqual([l("osago", "Новость ЦБ", "https://cbr.ru/1", "Банк России"), l("kasko", "С встречи")]);
    expect(byKey(out, "plan").lines).toEqual([l("osago", "Задача 7, срок 28.10", "/tasks/7", "Задача 7")]);
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
    expect(w.lines).toEqual(
      [
        l("osago", "ОСАГО: продажи за неделю 9 800 полисов, падение на 200 (-2,0%) к прошлой неделе", "/forecast?month=2026-10", "Факт по дням"),
        l("osago", "Трафик ОСАГО: 512 000, рост на 7 663 (+1,5%) к прошлой неделе", "/forecast?tab=week&week=2026-10-12", "Цифры недели"),
        l("kasko", "CR КАСКО: 10%, падение на 2 п.п. к прошлой неделе", "/forecast?tab=week&week=2026-10-12", "Цифры недели"),
        l("department", "Выручка всего: 120 млн, прошлой недели в отчёте нет", "/forecast?tab=week&week=2026-10-12", "Цифры недели"),
      ].map((x) => fig(x, "summary")),
    );
    expect(wowBlock({ connected: false, ready: false, week: "2026-10-12", latestWeek: null, href: "/x", figures: [], sales: [] }, PRODUCTS, null, null).note).toBe("Нет данных: недельный отчёт не подключён");
    expect(wowBlock({ connected: true, ready: false, week: "2026-10-12", latestWeek: "2026-10-05", href: "/x", figures: [{ label: "a", unit: "count", value: null, prev: null }], sales: [] }, PRODUCTS, null, null).note).toBe(
      "Нет данных: за неделю с 12.10 цифр в недельном отчёте ещё нет, последняя неделя с 05.10",
    );
    expect(wowBlock({ closed: true, connected: true, ready: true, week: "", latestWeek: null, href: "", figures: [], sales: [] }, PRODUCTS, null, null).note).toMatch(/видят те, кому открыт прогноз/);
    // Команда смотрит только на свои продукты
    const kasko = wowBlock({ connected: true, ready: true, week: "2026-10-12", latestWeek: null, href: "/x", figures: [{ label: "Трафик ОСАГО", unit: "count", value: 1, prev: 1 }, { label: "Трафик КАСКО", unit: "count", value: 2, prev: 1 }], sales: [] }, PRODUCTS, ["kasko"], null);
    expect(kasko.lines.map((x) => x.product)).toEqual(["kasko"]);
    // У людей команды нет продуктового направления: ни одной чужой цифры, честная пометка
    const none = wowBlock({ connected: true, ready: true, week: "2026-10-12", latestWeek: null, href: "/x", figures: [{ label: "Выручка всего", unit: "mln", value: 1, prev: 1 }], sales: [] }, PRODUCTS, [], "department");
    expect(none).toEqual({ lines: [], note: "Цифр по продуктам команды нет: у людей команды не задано направление продукта" });
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
    // Подпись сравнения говорит, что сравнивается: продажи продукта, выручка в итоге, ранрейт хаба
    expect(m.lines).toEqual([
      fig(l("osago", "ОСАГО: продажи 41 200 полисов при плане 40 000, план выполняем (+3,0%); выручка 120,5 млн при бюджете 118 млн (+2,1%); продажи к прошлому месяцу +3,0%", MONTH.href, src), "summary"),
      fig(l("kasko", "КАСКО: продажи 900 лидов при плане 1 000, план не выполняем (-10,0%); выручка 30,0 млн при бюджете 33,0 млн (-9,1%)", MONTH.href, src), "summary"),
      fig(l("department", "Итого по продуктам: выручка 150,5 млн при бюджете 151 млн, план не выполняем (-0,3%); выручка к прошлому месяцу +7,5%", MONTH.href, src), "summary"),
      fig(l("osago", "ОСАГО по СК: факт с начала месяца 25 400 полисов по 21.10, ранрейт 41 000 при плане 40 000 (+2,5%), ранрейт к прошлому месяцу +5,1%", MONTH.href, "Хаб: ОСАГО по СК"), "full"),
      fig(l("department", "Продажи и выручка к прошлому году (октябрь 2025): нет данных, в LRF этого месяца нет"), "summary"),
    ]);
    expect(m.partners).toEqual([fig(l("partners", "Партнёрский канал: выручка 50,0 млн при бюджете 55,0 млн, план не выполняем (-9,1%)", "/forecast?tab=partners&month=2026-10", "Прогноз: партнёры, октябрь 2026"), "full")]);
    expect(monthBlock(null, null, null)).toMatchObject({ lines: [], note: "Нет данных: прогноз месяца ещё не загружен из LRF" });
    expect(monthBlock("closed", null, null).note).toMatch(/видят те, кому открыт прогноз/);
    const both = monthBlock({ ...MONTH, hasPrevMonth: false, hub: null }, null, null);
    expect(both.lines.at(-1)!.text).toBe("Продажи и выручка к прошлому месяцу (сентябрь 2026) и к прошлому году (октябрь 2025): нет данных, в LRF этих месяцев нет");
    const year = monthBlock({ ...MONTH, products: [{ ...MONTH.products[0]!, prevYear: { units: 38000, revenue: 100 } }], total: { ...MONTH.total, prevYear: 125 }, hasPrevYear: true, hub: null }, null, null);
    expect(year.lines[0]!.text).toMatch(/; продажи к прошлому году \+8,4%$/);
    expect(year.lines[1]!.text).toMatch(/; выручка к прошлому году \+20,4%$/);
    // Команда вне страхования (нет продуктового направления): ни продуктов, ни итога, ни хаба, ни партнёров
    expect(monthBlock(MONTH, [], "department")).toEqual({ lines: [], note: "Цифр по продуктам команды нет: у людей команды не задано направление продукта", partners: [] });
    // Команда КАСКО: только КАСКО, без итога департамента и без хаба ОСАГО
    expect(monthBlock(MONTH, ["kasko"], "department").lines.map((x) => x.text.split(":")[0])).toEqual(["КАСКО", "Продажи и выручка к прошлому году (октябрь 2025)"]);
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
    // Блоки цифр собирает ресурс: запись с блоком «Неделя к неделе» раскладывается по смыслу
    expect(entryBlockKey({ section: "wow", type: "result", block: "numbers", direction: "osago" }, ["wow", "month", "products"])).toBe("products");
    expect(entryBlockKey({ section: "month", type: "risk", block: "numbers", direction: "osago" }, ["month", "risks"])).toBe("risks");
    expect(entryBlockKey({ section: "wow", type: "result", block: "numbers", direction: "osago" }, ["wow", "c:abcd1234"])).toBe("c:abcd1234");
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

  it("правка строк помечает блок поправленным руками, «собрать заново» снимает пометку", () => {
    expect(patchLine(blocks, "risks", 0, { text: "x" })[2]!.edited).toBe(true);
    expect(addLine(blocks, "wow", "department")[1]!.edited).toBe(true);
    expect(removeLine(blocks, "risks", 0)[2]!.edited).toBe(true);
    expect(setHidden(blocks, "wow", true)[1]!.edited).toBeUndefined();
    const fresh = [block("wow", [l("osago", "свежая")], { basis: "abc" })];
    expect(rebuildBlock(patchLine(blocks, "risks", 0, { text: "x" }), fresh, "wow")[1]).toMatchObject({ edited: false, stale: false, basis: "abc" });
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
  it("слово по началу, пара «A + B» в одной фразе, минус-слово не считается", () => {
    const tbank = DEFAULT_COMPETITORS.find((c) => c.name.startsWith("Т-Банк"))!.keywords;
    expect(competitorMatches("Т-Банк запустил сервис сравнения полисов ОСАГО", tbank)).toBe(true);
    expect(competitorMatches("Т-Банк стал страховым агрегатором", tbank)).toBe(true);
    // Страховщик «Т-Страхование» не агрегатор Т-Банка, даже если рядом есть слово «сравнение»
    expect(competitorMatches("Т-Страхование повысило тарифы КАСКО", tbank)).toBe(false);
    expect(competitorMatches("Т-Страхование запустило сравнение тарифов", tbank)).toBe(false);
    expect(competitorMatches("Тинькофф Страхование вышло на рынок ДМС", tbank)).toBe(false);
    // Т-Банк и агрегатор в разных фразах: не пара
    expect(competitorMatches("Т-Банк снизил ставки по вкладам. Агрегатор Сравни обновил витрину", tbank)).toBe(false);
    expect(competitorMatches("Т-Банк снизил ставки по вкладам\nАгрегатор обновил витрину", tbank)).toBe(false);
    expect(competitorMatches("Пампаду запустил КАСКО", ["Пампаду"])).toBe(true);
    // Т-Банк как витрина страховок
    expect(competitorMatches("Т-Банк запустил витрину ОСАГО", tbank)).toBe(true);
    expect(competitorMatches("Тинькофф открыл витрину страховых продуктов", tbank)).toBe(true);
    // Неразрывный дефис, короткое и длинное тире как обычный дефис
    expect(competitorMatches("Т\u2011Банк запустил сравнение ОСАГО", tbank)).toBe(true);
    expect(competitorMatches("Т\u2013Банк запустил сравнение ОСАГО", tbank)).toBe(true);
    expect(competitorMatches("Т\u2011Страхование запустило сравнение тарифов", tbank)).toBe(false);
    expect(competitorMatches("Т\u2011Страхование повысило тарифы", ["Т\u2011Страхован"])).toBe(true);
  });

  it("имя самой ленты признаком не считается: новости ленты Банки.ру не про Банки.ру", () => {
    const item = { title: "Банки.ру: ставки по вкладам снизились", summary: "Обзор banki.ru", feed: { name: "Банки.ру: новости", url: "https://www.banki.ru/xml/news.rss" } };
    expect(competitorOf(item, DEFAULT_COMPETITORS)).toBeNull();
    expect(competitorOf({ ...item, feed: null }, DEFAULT_COMPETITORS)?.name).toBe("Банки.ру");
    // На ленте Банки.ру новость про Пампаду остаётся новостью про Пампаду
    expect(competitorOf({ ...item, title: "Пампаду привлёк инвестиции" }, DEFAULT_COMPETITORS)?.name).toBe("Пампаду");
    // В блок новостей рынка новость ленты Банки.ру попадает как обычная новость
    const out = assembleBlocks({ ...EMPTY, news: [{ title: "Банки.ру: ставки по вкладам снизились", url: "https://banki.ru/1", source: "Банки.ру: новости", directions: ["deposits"], summary: "", feed: item.feed }] });
    expect(byKey(out, "news").lines.map((x) => x.text)).toEqual(["Банки.ру: ставки по вкладам снизились"]);
    expect(byKey(out, "competitors").lines).toEqual([]);
  });

  it("отчёт команды: новости конкурентов только по продуктам команды", () => {
    const news: NewsInput[] = [
      { title: "Пампаду запустил КАСКО", url: "https://a.ru/1", source: "А", directions: ["kasko"], summary: "" },
      { title: "Пампаду и ОСАГО", url: "https://a.ru/2", source: "А", directions: ["osago"], summary: "" },
    ];
    expect(competitorLines(news, DEFAULT_COMPETITORS, PRODUCTS, "department", ["kasko"]).map((x) => x.product)).toEqual(["kasko"]);
    expect(competitorLines(news, DEFAULT_COMPETITORS, PRODUCTS, "department", [])).toEqual([]);
  });

  it("стартовый список, чистка списка с экрана", () => {
    expect(competitorsOf(null).map((c) => c.name)).toEqual(["Банки.ру", "Выберу.ру", "Пампаду", "Т-Банк (агрегатор страхования)", "Инсапп", "Cherehapa", "Финуслуги"]);
    expect(competitorsOf([])).toEqual([]);
    expect(cleanCompetitors([{ name: " Пампаду ", keywords: "Пампаду, Pampadu, Пампаду" }, { name: "пампаду", keywords: "x" }, { name: "Новый" }, { name: "", keywords: "y" }])).toEqual([
      { name: "Пампаду", keywords: ["Пампаду", "Pampadu"] },
      { name: "Новый", keywords: ["Новый"] },
    ]);
    // Одни минус-слова: конкурент ищется и по имени
    expect(cleanCompetitors([{ name: "Сравнитель", keywords: "-Сравнительно" }])).toEqual([{ name: "Сравнитель", keywords: ["Сравнитель", "-Сравнительно"] }]);
  });
});

describe("цифры по уровню доступа", () => {
  const stored = cleanBlocks(
    [
      { key: "wow", title: "Неделя к неделе", lines: [{ product: "osago", text: "Трафик ОСАГО: 512 000", href: "/forecast?tab=week", source: "Цифры недели" }, { product: "department", text: "Цифру написали руками" }] },
      {
        key: "month",
        title: "Месяц",
        lines: [
          { product: "osago", text: "ОСАГО: продажи 41 200", href: "/forecast?month=2026-10", source: "Прогноз, октябрь 2026" },
          { product: "osago", text: "ОСАГО по СК: факт 25 400", href: "/forecast?month=2026-10", source: "Хаб: ОСАГО по СК" },
        ],
      },
      {
        key: "partners",
        title: "Партнёрский канал",
        lines: [
          { product: "partners", text: "Подключили банк", href: null },
          { product: "partners", text: "Партнёрский канал: выручка 50 млн", href: "/forecast?tab=partners&month=2026-10", source: "Прогноз: партнёры, октябрь 2026" },
        ],
      },
    ],
    null,
  );

  it("строки с цифрами помечаются при чистке: блоки цифр целиком, хаб и партнёры только со всеми цифрами", () => {
    expect(stored.map((b) => b.lines.map((x) => x.figures ?? "-"))).toEqual([["summary", "summary"], ["summary", "full"], ["-", "full"]]);
    // Помеченную строку не понизить с экрана
    expect(cleanBlocks([{ key: "news", title: "x", lines: [{ product: null, text: "Хаб", href: "/forecast?month=1", source: "Хаб: ОСАГО по СК", figures: "summary" }] }], null)[0]!.lines[0]!.figures).toBe("full");
  });

  it("без доступа: цифры заменены одной строкой; с основными цифрами без хаба и партнёров; со всеми как есть", () => {
    const none = blocksForLevel(stored, "none");
    expect(none.map((b) => b.lines.map((x) => x.text))).toEqual([[NUMBERS_HIDDEN_TEXT], [NUMBERS_HIDDEN_TEXT], ["Подключили банк", NUMBERS_HIDDEN_TEXT]]);
    expect(JSON.stringify(none)).not.toMatch(/512|41 200|25 400|50 млн/);
    const summary = blocksForLevel(stored, "summary");
    expect(summary.map((b) => b.lines.map((x) => x.text))).toEqual([["Трафик ОСАГО: 512 000", "Цифру написали руками"], ["ОСАГО: продажи 41 200"], ["Подключили банк"]]);
    expect(blocksForLevel(stored, "full")).toEqual(stored);
  });

  it("строка «цифры видны только с доступом» не хранится, а сохранение без доступа возвращает чужие цифры на место", () => {
    const seen = blocksForLevel(stored, "none");
    expect(cleanBlocks(seen, null).map((b) => b.lines.length)).toEqual([0, 0, 1]);
    const edited = cleanBlocks(seen, null).map((b) => (b.key === "partners" ? { ...b, lines: [l("partners", "Подключили два банка")] } : b));
    const back = restoreHiddenFigures(edited, stored, "none");
    expect(byKey(back, "partners").lines.map((x) => x.text)).toEqual(["Подключили два банка", "Партнёрский канал: выручка 50 млн"]);
    // Блоки живых цифр без правок не трогаются: их строки пересоберутся сами
    expect(byKey(back, "wow").lines).toEqual([]);
    const fixed = restoreHiddenFigures(edited.map((b) => (b.key === "wow" ? { ...b, edited: true } : b)), stored, "none");
    expect(byKey(fixed, "wow").lines.map((x) => x.text)).toEqual(["Трафик ОСАГО: 512 000", "Цифру написали руками"]);
    expect(restoreHiddenFigures(edited, stored, "full")).toEqual(edited);
  });
});

describe("живые цифры", () => {
  const fresh = [block("wow", [l("osago", "Трафик 520 000")], { note: "Свежие", basis: fingerprint([l("osago", "Трафик 520 000")]) }), block("month", [l("osago", "Продажи 42 000")], { basis: fingerprint([l("osago", "Продажи 42 000")]) })];

  it("без правок руками блоки цифр берут свежую автосборку, поправленные остаются и помечаются, если цифры обновились", () => {
    const saved = [
      block("wow", [l("osago", "Трафик 512 000")], { basis: fingerprint([l("osago", "Трафик 512 000")]), hidden: true }),
      block("month", [l("osago", "Продажи около 42 тысяч")], { edited: true, basis: fingerprint([l("osago", "Продажи 41 000")]) }),
      block("products", [l("osago", "Запустили тест")]),
    ];
    const out = withLiveBlocks(saved, fresh);
    expect(byKey(out, "wow")).toMatchObject({ lines: [l("osago", "Трафик 520 000")], note: "Свежие", hidden: true, stale: false });
    expect(byKey(out, "month")).toMatchObject({ lines: [l("osago", "Продажи около 42 тысяч")], edited: true, stale: true });
    expect(byKey(out, "products")).toEqual(saved[2]);
    // Цифры с правки не менялись: пометки нет
    const same = withLiveBlocks([block("month", [l("osago", "Своими словами")], { edited: true, basis: fresh[1]!.basis })], fresh);
    expect(same[0]!.stale).toBe(false);
  });

  it("автосборка ставит отпечаток на блоки цифр, пометка stale не хранится", () => {
    const out = assembleBlocks({ ...EMPTY, wow: { connected: true, ready: true, week: "2026-10-12", latestWeek: null, href: "/x", figures: [{ label: "Трафик ОСАГО", unit: "count", value: 2, prev: 1 }], sales: [] } });
    expect(byKey(out, "wow").basis).toBe(fingerprint(byKey(out, "wow").lines));
    expect(byKey(out, "products").basis).toBeUndefined();
    expect(cleanBlocks([{ ...byKey(out, "wow"), edited: true, stale: true }], null)[0]).toMatchObject({ edited: true, basis: byKey(out, "wow").basis });
    expect(cleanBlocks([{ ...byKey(out, "wow"), stale: true }], null)[0]!.stale).toBeUndefined();
  });
});

describe("руководитель видит не все цифры (второй круг проверки)", () => {
  const P = [{ code: "osago", label: "ОСАГО" }, { code: "department", label: "Департамент" }];
  const T = [{ key: "wow", title: "Неделя к неделе" }];
  const base = { ...EMPTY, template: T, products: P, month: "closed" as const, competitors: [] };
  const week = (value: number, prev: number, w = "2026-10-12") => assembleBlocks({ ...base, wow: { connected: true, ready: true, week: w, latestWeek: null, href: "/f", figures: [{ label: "Трафик ОСАГО", unit: "count", value, prev }], sales: [] } });
  const autoOld = week(500000, 490000);
  const autoNew = week(520000, 500000, "2026-10-19");

  it("блок цифр, который зритель видит не целиком, только для чтения: без отпечатка и без ложной пометки «цифры обновились»", () => {
    // Рева со всеми цифрами поправил «Неделю к неделе» руками, цифры с тех пор обновились
    const stored = cleanBlocks([{ ...autoOld[0]!, edited: true, lines: [l("osago", "Трафик ОСАГО: 500 000, поправили руками")] }], null);
    const truth = withLiveBlocks(stored, autoNew);
    expect(truth[0]!.stale).toBe(true);
    const seen = blocksForLevel(truth, "none");
    expect(seen[0]).toMatchObject({ locked: true, lines: [{ text: NUMBERS_HIDDEN_TEXT }] });
    expect(seen[0]!.stale).toBeUndefined();
    expect(seen[0]!.basis).toBeUndefined();
    // Со всеми цифрами блок не закрыт и пометка настоящая
    expect(blocksForLevel(truth, "full")[0]).toMatchObject({ stale: true });
    expect(blocksForLevel(truth, "full")[0]!.locked).toBeUndefined();
    // С основными цифрами «Месяц» с хабом закрыт, «Неделя к неделе» нет
    const month = cleanBlocks([{ key: "month", title: "Месяц", lines: [{ product: "osago", text: "ОСАГО: продажи", href: "/forecast?month=1", source: "Прогноз" }, { product: "osago", text: "Хаб", href: "/forecast?month=1", source: "Хаб: ОСАГО по СК" }] }], null)[0]!;
    expect(lockedFor(month, "summary")).toBe(true);
    expect(lockedFor(truth[0]!, "summary")).toBe(false);
    expect(lockedFor({ key: "partners", lines: month.lines }, "none")).toBe(false);
  });

  it("сценарий А: руководитель без цифр жмёт «Собрать заново» и сохраняет, правка Ревы остаётся", () => {
    const stored = cleanBlocks([{ ...autoOld[0]!, edited: true, lines: [l("osago", "Трафик ОСАГО: 500 000, поправили руками")] }], null);
    const truth = withLiveBlocks(stored, autoNew);
    const seen = blocksForLevel(truth, "none");
    const rebuilt = rebuildBlock(seen, blocksForLevel(autoNew, "none"), "wow");
    const saved = keepLockedBlocks(cleanBlocks(rebuilt, null), truth, stored, "none");
    expect(saved[0]).toMatchObject({ edited: true, basis: stored[0]!.basis, lines: [{ text: "Трафик ОСАГО: 500 000, поправили руками", figures: "summary" }] });
  });

  it("сценарий Б: руководитель без цифр добавляет строку в блок цифр, цифры не замерзают", () => {
    const stored = cleanBlocks(withLiveBlocks([{ key: "wow", title: "Неделя к неделе", hidden: false, note: null, lines: [] }], autoOld), null);
    const seen = blocksForLevel(withLiveBlocks(stored, autoNew), "none");
    let edited = addLine(seen, "wow", "department");
    edited = patchLine(edited, "wow", edited[0]!.lines.length - 1, { text: "Комментарий руководителя" });
    const truth = withLiveBlocks(stored, autoNew);
    const saved = withLiveBlocks(keepLockedBlocks(cleanBlocks(edited, null), truth, stored, "none"), autoNew);
    expect(saved[0]!.edited).toBeUndefined();
    expect(saved[0]!.lines.map((x) => x.text)).toEqual([expect.stringMatching(/^Трафик ОСАГО: 520 000/)]);
    // Скрыть блок можно: раскладка от зрителя, строки из прежней версии
    expect(keepLockedBlocks(cleanBlocks(setHidden(seen, "wow", true), null), truth, stored, "none")[0]).toMatchObject({ hidden: true, lines: stored[0]!.lines });
    // Со всеми цифрами правки принимаются как есть
    expect(keepLockedBlocks(cleanBlocks(edited, null), truth, stored, "full")[0]!.lines.at(-1)!.text).toBe("Комментарий руководителя");
  });
});

describe("живой блок конкурентов и отправленная версия", () => {
  const news = (title: string): NewsInput => ({ title, url: "https://a.ru/1", source: "А", directions: ["kasko"], summary: "" });
  const T = [{ key: "competitors", title: "Конкуренты" }];
  const autoOf = (items: NewsInput[]) => assembleBlocks({ ...EMPTY, template: T, news: items });

  it("без правок руками пересобирается и появляется, когда появилась новость; скрытый руками со строками остаётся скрытым; поправленный помечается", () => {
    const empty = cleanBlocks(autoOf([]), null);
    expect(empty[0]).toMatchObject({ hidden: true, lines: [] });
    const fresh = autoOf([news("Пампаду запустил КАСКО по подписке")]);
    expect(withLiveBlocks(empty, fresh)[0]).toMatchObject({ hidden: false, lines: [{ text: "Пампаду: Пампаду запустил КАСКО по подписке" }] });
    const shown = cleanBlocks(withLiveBlocks(empty, fresh), null);
    expect(withLiveBlocks(setHidden(shown, "competitors", true), fresh)[0]!.hidden).toBe(true);
    // Новости кончились: блок снова скрыт сам
    expect(withLiveBlocks(shown, autoOf([]))[0]).toMatchObject({ hidden: true, lines: [] });
    const mine = patchLine(shown, "competitors", 0, { text: "Пампаду: подписка на КАСКО, следим" });
    const more = autoOf([news("Пампаду запустил КАСКО по подписке"), news("Инсапп снизил тарифы КАСКО")]);
    expect(withLiveBlocks(mine, more)[0]).toMatchObject({ edited: true, stale: true, lines: [{ text: "Пампаду: подписка на КАСКО, следим" }] });
  });

  it("в отправленную версию скрытые блоки не попадают", () => {
    const out = sentBlocks([block("news", [l("osago", "a")]), block("risks", [l("osago", "Скрытый риск")], { hidden: true }), block("plan", [], { stale: true, locked: true })]);
    expect(out.map((b) => b.key)).toEqual(["news", "plan"]);
    expect(out[1]).not.toHaveProperty("stale");
    expect(JSON.stringify(out)).not.toMatch(/Скрытый риск/);
  });
});

describe("шаблон команды и сохранённый отчёт", () => {
  it("новые блоки шаблона встают на место, убранные скрываются со строками, названия своих блоков из шаблона", () => {
    const saved = [block("products", [l("osago", "a")]), block("c:hire0001", [l("osago", "Найм")], { title: "Найм" }), block("risks", [l("osago", "Риск")])];
    const template = [
      { key: "news", title: "Новости рынка и команды" },
      { key: "products", title: "Продукты" },
      { key: "plan", title: "План на неделю" },
      { key: "c:hire0001", title: "Найм и адаптация" },
    ];
    const auto = [block("news", [l("osago", "Новость", "https://x.ru/1", "X")]), block("plan", [])];
    const out = alignToTemplate(saved, template, auto);
    expect(out.map((b) => [b.key, b.hidden])).toEqual([
      ["news", false],
      ["products", false],
      ["plan", false],
      ["c:hire0001", false],
      ["risks", true],
    ]);
    expect(byKey(out, "news").lines).toEqual([l("osago", "Новость", "https://x.ru/1", "X")]);
    expect(byKey(out, "c:hire0001").title).toBe("Найм и адаптация");
    expect(byKey(out, "risks")).toMatchObject({ lines: [l("osago", "Риск")], note: "Блока больше нет в шаблоне команды: скрыт" });
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
