import { describe, expect, it } from "vitest";
import {
  DETAILS_OFTEN,
  DETAILS_RARE,
  cutPart,
  detailsVerdict,
  fieldShares,
  fillsPart,
  moveTo,
  movePart,
  multiTeamPart,
  reportLine,
  survey,
  templatesPart,
  type MeasureAuthor,
  type MeasureEntry,
  type MeasureInput,
  type MeasureTeam,
  type MeasureWeek,
} from "@/lib/weekly-measure/survey";
import { surveyText } from "@/lib/weekly-measure/text";
import { BLOCK_LIMITS, STANDARD_BLOCKS } from "@/lib/weekly-blocks/types";

// Этап 87: замер живых данных перед пересборкой экрана «Сдать weekly». Доли заполненных полей и среднее за неделю,
// шаблоны блоков команд, обрезка строки отчёта на 600 знаках, человек в нескольких командах и выборка миграции по
// правилу entryBlockKey. Главный случай: запись переезжает в блок, которого нет в шаблоне её команды

const WEEKS: MeasureWeek[] = [
  { key: "2026-10-26", number: 44, year: 2026, current: true },
  { key: "2026-10-19", number: 43, year: 2026, current: false },
  { key: "2026-10-12", number: 42, year: 2026, current: false },
  { key: "2026-10-05", number: 41, year: 2026, current: false },
];

let n = 0;
const entry = (over: Partial<MeasureEntry> = {}): MeasureEntry => ({
  id: `e${++n}`,
  weekKey: "2026-10-19",
  authorId: "p1",
  authorName: "Иванов Иван",
  direction: "osago",
  block: "key-changes",
  blockLabel: "Ключевые изменения",
  type: "result",
  section: null,
  what: "Запустили новый тариф",
  fact: null,
  impact: null,
  next: null,
  help: null,
  links: 0,
  ...over,
});

const team = (id: string, name: string, template: MeasureTeam["template"]): MeasureTeam => ({ id, name, template });
/** Блоки шаблона с настоящими названиями стандартных блоков: свой блок один, «Найм и команда» */
const tpl = (...keys: string[]) => keys.map((key) => ({ key, title: STANDARD_BLOCKS.find((b) => b.key === key)?.title ?? "Найм и команда" }));

const author = (over: Partial<MeasureAuthor> = {}): MeasureAuthor => ({
  personId: "p1",
  name: "Иванов Иван",
  order: ["t1"],
  showing: ["t1"],
  templateTeamId: "t1",
  ...over,
});

const input = (over: Partial<MeasureInput> = {}): MeasureInput => ({
  weeks: WEEKS,
  recent: 4,
  entries: [],
  teams: [],
  authors: [],
  teamsTotal: 0,
  ...over,
});

describe("1. записи за неделю и заполненные поля", () => {
  it("среднее считается по завершённым неделям, текущая отчётная в него не идёт; доли по полям и по каждой из последних недель", () => {
    const entries = [
      entry({ weekKey: "2026-10-26" }),
      entry({ weekKey: "2026-10-26" }),
      entry({ weekKey: "2026-10-19", impact: "Выручка вырастет", fact: "120 заявок", links: 1 }),
      entry({ weekKey: "2026-10-19", help: "Нужен аналитик" }),
      entry({ weekKey: "2026-10-12", next: "Выкатим на всех" }),
      entry({ weekKey: "2026-10-05" }),
    ];
    const part = fillsPart(input({ entries }));
    expect(part.entries).toBe(6);
    // Четыре записи за три завершённые недели: текущая неделя с двумя записями в среднее не идёт
    expect(part.countedWeeks).toBe(3);
    expect(part.perWeek).toBeCloseTo(4 / 3);
    const share = (key: string) => part.fields.find((f) => f.key === key)!;
    expect(share("impact")).toMatchObject({ filled: 1, title: "Влияние на бизнес" });
    expect(share("impact").share).toBeCloseTo(1 / 6);
    expect(share("fact").filled).toBe(1);
    expect(share("next").filled).toBe(1);
    expect(share("help").filled).toBe(1);
    expect(share("link").filled).toBe(1);
    expect(part.byWeek.map((w) => w.entries)).toEqual([2, 2, 1, 1]);
    expect(part.recent[1]!.fields.find((f) => f.key === "impact")!.share).toBeCloseTo(0.5);
    // Пустая строка полем не считается
    expect(fieldShares([entry({ impact: "   " })])[0]!.filled).toBe(0);
  });

  it("вывод по решению 14: до 15% прятать дёшево, от 15 до 40 обсудить, выше 40 пересматривать", () => {
    expect(detailsVerdict([0.1, 0.05])).toBe("cheap");
    expect(detailsVerdict([DETAILS_RARE, 0])).toBe("discuss");
    expect(detailsVerdict([DETAILS_OFTEN, 0.2])).toBe("discuss");
    expect(detailsVerdict([0.5, 0.1])).toBe("revisit");
    expect(detailsVerdict([])).toBe("cheap");
  });
});

describe("2. шаблоны блоков команд", () => {
  it("считает команды с шаблоном и свои блоки, помечает шаблон без «Продуктов» и шаблон из одних блоков цифр", () => {
    const part = templatesPart(
      input({
        teamsTotal: 4,
        teams: [
          team("t1", "Вклады", tpl("products", "c:hire0001", "risks")),
          team("t2", "Партнёрка", tpl("news", "partners")),
          team("t3", "Цифры", tpl("wow", "month")),
          team("t4", "Без шаблона", null),
        ],
      }),
    );
    expect(part).toMatchObject({ teamsTotal: 4, withTemplate: 3, customTotal: 1 });
    expect(part.rows[0]).toMatchObject({ team: "Вклады", blocks: 3, custom: ["Найм и команда"], noProducts: false, onlyFigures: false });
    expect(part.rows[1]).toMatchObject({ team: "Партнёрка", custom: [], noProducts: true, onlyFigures: false });
    expect(part.rows[2]).toMatchObject({ team: "Цифры", noProducts: true, onlyFigures: true });
  });
});

describe("3. обрезка строки отчёта", () => {
  it("считает записи, которые не влезают в предел, и показывает длину до и после", () => {
    const long = `${"Очень длинная запись про тариф ".repeat(30)}конец`;
    const part = cutPart(input({ entries: [entry({ what: long, id: "long" }), entry({ what: "Коротко" })] }), 3);
    expect(part.limit).toBe(BLOCK_LIMITS.text);
    expect(part.checked).toBe(2);
    expect(part.cut).toBe(1);
    expect(part.share).toBeCloseTo(0.5);
    expect(part.examples).toHaveLength(1);
    expect(part.examples[0]!.before).toBeGreaterThan(BLOCK_LIMITS.text);
    expect(part.examples[0]!.after).toBeLessThanOrEqual(BLOCK_LIMITS.text);
    expect(part.examples[0]!.cut.length).toBe(part.examples[0]!.after);
    // Строка отчёта считается так же, как в автосборке: «Цифра или факт» дописывается к фразе
    expect(reportLine(entry({ what: "Запустили тариф", fact: "120 заявок" })).full).toBe("Запустили тариф. 120 заявок");
    expect(part.longest).toBe(reportLine(entry({ what: long })).full.length);
  });
});

describe("4. человек в нескольких командах", () => {
  it("показывает, чей шаблон человек получает, и расхождение с «шаблоном первой команды»", () => {
    const part = multiTeamPart(
      input({
        teams: [team("t1", "Первая", null), team("t2", "Вторая", tpl("products", "risks")), team("t3", "Третья", tpl("products", "risks"))],
        authors: [
          author({ personId: "p1", name: "Иванов Иван", order: ["t1", "t2"], templateTeamId: "t2" }),
          author({ personId: "p2", name: "Петров Пётр", order: ["t2", "t3"], templateTeamId: "t2" }),
          author({ personId: "p3", name: "Сидоров Сидор", order: ["t2"], templateTeamId: "t2" }),
        ],
      }),
    );
    // Петров в двух командах, но шаблоны одинаковые: вопроса нет. Сидоров в одной команде
    expect(part.people.map((p) => p.name)).toEqual(["Иванов Иван"]);
    expect(part.notFirst).toBe(1);
    expect(part.people[0]).toMatchObject({ winner: "Вторая", notFirst: true });
    expect(part.people[0]!.teams).toEqual([
      { name: "Первая", blocks: null },
      { name: "Вторая", blocks: 2 },
    ]);
  });
});

describe("5. выборка миграции по правилу entryBlockKey", () => {
  it("блок шаблона, по которому запись сдали, сохраняется; забытый блок теряется", () => {
    const own = tpl("products", "c:hire0001", "risks");
    expect(moveTo(entry({ section: "c:hire0001" }), own)).toMatchObject({ to: "c:hire0001", reason: "section", stale: false });
    // Тот же блок убрали из шаблона: запись едет по смыслу, и это видно
    expect(moveTo(entry({ section: "c:hire0001" }), tpl("products", "risks"))).toMatchObject({ to: "products", reason: "sense", stale: true });
  });

  it("по смыслу: риск в «Риски», план в «План», команда в новости, партнёрка в «Партнёрский канал», остальное в «Продукты»", () => {
    const all = tpl("news", "products", "partners", "risks", "plan");
    expect(moveTo(entry({ type: "risk" }), all).to).toBe("risks");
    expect(moveTo(entry({ type: "plan" }), all).to).toBe("plan");
    expect(moveTo(entry({ block: "team" }), all).to).toBe("news");
    expect(moveTo(entry({ direction: "partners" }), all).to).toBe("partners");
    expect(moveTo(entry(), all)).toMatchObject({ to: "products", reason: "sense" });
  });

  it("блока по смыслу в шаблоне нет: запись уходит в «Продукты», а без них в первый блок шаблона", () => {
    expect(moveTo(entry({ type: "risk" }), tpl("products", "plan"))).toMatchObject({ to: "products", reason: "products" });
    expect(moveTo(entry({ type: "risk" }), tpl("news", "plan"))).toMatchObject({ to: "news", reason: "first" });
    // Шаблон из одних блоков цифр: запись попадёт в блок, который ресурс собирает сам
    expect(moveTo(entry(), tpl("wow", "month"))).toMatchObject({ to: "wow", figures: true, reason: "first" });
  });

  it("шаблона у команды нет: считаем по стандартному набору из восьми блоков и помечаем это", () => {
    expect(moveTo(entry(), null)).toMatchObject({ to: "products", assumed: true });
    expect(moveTo(entry(), [])).toMatchObject({ assumed: true });
    expect(moveTo(entry(), tpl("products")).assumed).toBe(false);
  });

  it("запись переезжает в блок, которого нет в шаблоне её команды: случай попадает в спорные", () => {
    const part = movePart(
      input({
        teams: [team("t1", "Вклады", null)],
        authors: [author({ order: ["t1"], showing: ["t1"], templateTeamId: null })],
        entries: [entry({ id: "e-no-template" })],
      }),
    );
    expect(part.entries).toBe(1);
    const problem = part.problems[0]!;
    expect(problem).toMatchObject({ entryId: "e-no-template", to: "products", team: null });
    expect(problem.flags).toContain("outside-template");
    // Блока «Продукты» в шаблоне команды нет: шаблона у неё нет совсем
    expect(problem.perTeam).toEqual([{ team: "Вклады", toTitle: "Продукты", inTemplate: false }]);
    expect(part.problems).toHaveLength(1);
  });

  it("человек в двух командах с разными шаблонами: в их отчётах запись попадёт в разные блоки", () => {
    const part = movePart(
      input({
        teams: [team("t1", "Вклады", tpl("products", "c:hire0001")), team("t2", "Партнёрка", tpl("products", "risks"))],
        authors: [author({ order: ["t1", "t2"], showing: ["t1", "t2"], templateTeamId: "t1" })],
        entries: [entry({ section: "c:hire0001", id: "e-split" })],
      }),
    );
    const problem = part.problems[0]!;
    expect(problem.flags).toContain("split-teams");
    expect(problem.perTeam).toEqual([
      { team: "Вклады", toTitle: "Найм и команда", inTemplate: true },
      { team: "Партнёрка", toTitle: "Продукты", inTemplate: true },
    ]);
  });

  it("группирует выборку по блокам и берёт только последние недели", () => {
    const part = movePart(
      input({
        recent: 2,
        teams: [team("t1", "Вклады", tpl("products", "risks"))],
        authors: [author()],
        entries: [
          entry({ weekKey: "2026-10-26" }),
          entry({ weekKey: "2026-10-19", type: "risk", block: "risks", blockLabel: "Риски и решения" }),
          entry({ weekKey: "2026-10-05" }),
        ],
      }),
    );
    expect(part.weeks).toEqual(["2026-10-26", "2026-10-19"]);
    expect(part.entries).toBe(2);
    expect(part.byReason).toMatchObject({ section: 0, sense: 2, products: 0, first: 0 });
    expect(part.targets).toEqual([
      { toTitle: "Продукты", count: 1 },
      { toTitle: "Риски", count: 1 },
    ]);
    expect(part.pairs).toEqual([
      { fromLabel: "Ключевые изменения", toTitle: "Продукты", count: 1 },
      { fromLabel: "Риски и решения", toTitle: "Риски", count: 1 },
    ]);
    expect(part.problems).toHaveLength(0);
  });
});

describe("вывод замера текстом", () => {
  it("печатает пять ответов, вывод по решению 14 и спорные случаи, без пустых обещаний", () => {
    const s = survey(
      input({
        teamsTotal: 3,
        teams: [team("t1", "Вклады", tpl("products", "risks")), team("t2", "Без шаблона", null), team("t3", "Партнёрка", tpl("news", "risks"))],
        authors: [author({ order: ["t2", "t1"], showing: ["t1", "t3"], templateTeamId: "t1" })],
        entries: [entry({ weekKey: "2026-10-19", impact: "Выручка вырастет" }), entry({ weekKey: "2026-10-12" })],
      }),
    );
    const text = surveyText(s, new Date("2026-11-02T09:00:00Z"));
    expect(text).toContain("Замер живых данных перед пересборкой экрана «Сдать weekly» (этап 87)");
    expect(text).toContain("Только чтение: в базу ничего не записано.");
    expect(text).toContain("1. Сколько записей сдают за неделю и какие поля заполняют");
    expect(text).toContain("Влияние на бизнес: 1 из 2, 50%");
    expect(text).toContain("решение 14 надо пересматривать");
    expect(text).toContain("Шаблон есть у 2 команд из 3");
    expect(text).toContain(`3. Обрезка строки отчёта на ${BLOCK_LIMITS.text} знаках`);
    expect(text).toContain("Ни одна запись за период в предел не упирается");
    expect(text).toContain("4. Люди в двух и более командах с разными шаблонами");
    expect(text).toContain("правило взяло следующую");
    expect(text).toContain("5. Выборка миграции");
    expect(text).toContain("Спорные случаи: 2 из 2");
    expect(text).toContain("в их отчётах запись попадёт в разные блоки");
  });
});
