// Этап 74: выбор команды поиском вместо системного списка. Правила поиска, разделы окна и «Недавние» без браузера
import { describe, expect, it } from "vitest";
import { clearRecentTeams, filterTeams, matchTeam, pushRecent, readRecent, rememberRecent, RECENT_MAX, RECENT_PREFIX, teamHint, teamSections, type TeamPick } from "@/domain/team-picker";

const team = (patch: Partial<TeamPick>): TeamPick => ({
  id: "t",
  name: "Команда",
  depth: 0,
  relation: "below",
  leader: null,
  parent: null,
  ...patch,
});

/** Хранилище в памяти вместо localStorage: правила проверяются без браузера */
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** Хранилище, которое всё запрещает: приватное окно, запрет на данные сайта */
const forbidden = {
  get length(): number {
    throw new Error("нет доступа");
  },
  key: (): string | null => {
    throw new Error("нет доступа");
  },
  getItem: (): string | null => {
    throw new Error("нет доступа");
  },
  setItem: (): void => {
    throw new Error("нет доступа");
  },
  removeItem: (): void => {
    throw new Error("нет доступа");
  },
};

describe("поиск команды", () => {
  const teams = [
    team({ id: "top", name: "Команда страхования и инвестиций", leader: "Мурадян Арам", relation: "leader" }),
    team({ id: "osago", name: "ОСАГО", depth: 1, leader: "Головкин Владислав", relation: "member", parent: "Команда страхования и инвестиций" }),
    team({ id: "kasko", name: "КАСКО", depth: 1, leader: "Фатьянов Евгений" }),
    team({ id: "prod-1", name: "Продукт", depth: 2, leader: "Рева Тарас", parent: "ОСАГО" }),
    team({ id: "prod-2", name: "Продукт", depth: 2, leader: "Логинова Светлана", parent: "КАСКО" }),
  ];

  it("ищет по названию и по руководителю, регистр и «ё» не важны", () => {
    expect(matchTeam(teams[2]!, "каско")).toBe(true);
    expect(matchTeam(teams[2]!, "КАСКО")).toBe(true);
    // «Фатьянов Евгений» находится по фамилии и по имени, в любом порядке
    expect(matchTeam(teams[2]!, "фатьянов")).toBe(true);
    expect(matchTeam(teams[2]!, "евгений фатьянов")).toBe(true);
    // «ё» приводится: «Рева Тарас» и «Фёдоров» ищутся без оглядки на написание
    expect(matchTeam(team({ id: "x", name: "Выплаты", leader: "Фёдоров Пётр" }), "федоров петр")).toBe(true);
    // Пустой запрос подходит всем: окно открылось и показывает всё
    expect(matchTeam(teams[0]!, "   ")).toBe(true);
    // Чужое слово не подходит
    expect(matchTeam(teams[2]!, "осаго")).toBe(false);
  });

  it("по команде выше не ищет: иначе запрос про одну команду тащил бы все команды под ней", () => {
    // У «Продукт» команда выше «ОСАГО», но по запросу «осаго» он не находится
    expect(matchTeam(teams[3]!, "осаго")).toBe(false);
    expect(filterTeams(teams, "осаго").map((t) => t.id)).toEqual(["osago"]);
  });

  it("найденные по названию идут раньше найденных по руководителю, внутри порядок дерева", () => {
    // «Продукт» двух руководителей: оба по названию, в порядке дерева
    expect(filterTeams(teams, "продукт").map((t) => t.id)).toEqual(["prod-1", "prod-2"]);
    // «рева» это только руководитель: название ни у кого не подходит
    expect(filterTeams(teams, "рева").map((t) => t.id)).toEqual(["prod-1"]);
    // Запрос подходит одной по названию и другой по руководителю: сначала по названию
    const mixed = [team({ id: "a", name: "Выплаты", leader: "Каскова Инна" }), team({ id: "b", name: "КАСКО", leader: "Иванов Иван" })];
    expect(filterTeams(mixed, "каско").map((t) => t.id)).toEqual(["b", "a"]);
    // Пустой запрос ничего не отбирает и не переставляет
    expect(filterTeams(teams, "").map((t) => t.id)).toEqual(teams.map((t) => t.id));
  });

  it("вторая строка различает одноимённые команды: руководитель, а при совпадении и команда выше", () => {
    // Слова те же, что у подсказки «Команда выше» (этап 70)
    expect(teamHint("Рева Тарас", null)).toBe("Руководитель: Рева Тарас");
    expect(teamHint("Рева Тарас", "ОСАГО")).toBe("Руководитель: Рева Тарас, команда выше «ОСАГО»");
    expect(teamHint(null, null)).toBe("Руководитель не назначен");
    // Одноимённые «Продукт» различаются второй строкой
    expect(teamHint(teams[3]!.leader, teams[3]!.parent)).not.toBe(teamHint(teams[4]!.leader, teams[4]!.parent));
  });

  it("разделы: свои, недавние и все; с запросом один раздел «Найдено»", () => {
    const sections = teamSections(teams, ["kasko", "top"], "");
    expect(sections.map((s) => s.key)).toEqual(["mine", "recent", "all"]);
    // Свои: где человек руководитель или участник
    expect(sections[0]!.items.map((t) => t.id)).toEqual(["top", "osago"]);
    // Недавние: без своих, они и так сверху. «top» свой, поэтому в недавних его нет
    expect(sections[1]!.items.map((t) => t.id)).toEqual(["kasko"]);
    // Все команды: весь список по дереву
    expect(sections[2]!.items.map((t) => t.id)).toEqual(teams.map((t) => t.id));
    // Пустые разделы не показываются: без недавних их два
    expect(teamSections(teams, [], "").map((s) => s.key)).toEqual(["mine", "all"]);
    // С запросом один раздел
    const found = teamSections(teams, ["kasko"], "продукт");
    expect(found.map((s) => s.key)).toEqual(["found"]);
    expect(found[0]!.items.map((t) => t.id)).toEqual(["prod-1", "prod-2"]);
  });

  it("в недавних не остаётся команд, которых в списке больше нет", () => {
    // Команду закрыли или человека из неё убрали: id просто пропадает, окно не падает и пустых строк не рисует
    const sections = teamSections(teams, ["ушла", "kasko"], "");
    expect(sections.find((s) => s.key === "recent")!.items.map((t) => t.id)).toEqual(["kasko"]);
    // Все недавние пропали: раздела нет
    expect(teamSections(teams, ["ушла"], "").map((s) => s.key)).toEqual(["mine", "all"]);
  });

  it("поиск и разделы не добавляют команд к тому, что пришло: найти чужую команду нельзя", () => {
    // На вход приходят только видимые команды. Что бы ни набрали, из окна нельзя достать команду вне этого списка
    const visible = [teams[1]!, teams[2]!];
    const ids = new Set(visible.map((t) => t.id));
    for (const q of ["", "продукт", "мурадян", "страхования", "prod-1"]) {
      const out = teamSections(visible, ["prod-1", "top"], q).flatMap((s) => s.items.map((t) => t.id));
      expect(out.every((id) => ids.has(id))).toBe(true);
    }
  });
});

describe("недавние команды на устройстве", () => {
  it("выбранная встаёт первой, повтор не дублируется, хвост сверх пяти отпадает", () => {
    expect(pushRecent([], "a")).toEqual(["a"]);
    expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toHaveLength(RECENT_MAX);
  });

  it("у каждого человека на устройстве свои недавние, выход стирает все", () => {
    const kv = memory();
    rememberRecent("reva", "osago", kv);
    rememberRecent("reva", "kasko", kv);
    rememberRecent("loginova", "red", kv);
    expect(readRecent("reva", kv)).toEqual(["kasko", "osago"]);
    // Чужие недавние на общем устройстве не видны
    expect(readRecent("loginova", kv)).toEqual(["red"]);
    expect(readRecent("golovkin", kv)).toEqual([]);
    expect(kv.getItem(`${RECENT_PREFIX}reva`)).toBe(JSON.stringify(["kasko", "osago"]));
    // Выход стирает недавние всех людей, а чужое в хранилище не трогает
    kv.setItem("weekly-draft:reva", "черновик");
    clearRecentTeams(kv);
    expect(readRecent("reva", kv)).toEqual([]);
    expect(readRecent("loginova", kv)).toEqual([]);
    expect(kv.getItem("weekly-draft:reva")).toBe("черновик");
  });

  it("мусор в хранилище и запрет на хранилище не ломают выбор команды", () => {
    // Не тот тип, не массив, не строки внутри: пустой список вместо падения
    expect(readRecent("reva", memory({ [`${RECENT_PREFIX}reva`]: "не json" }))).toEqual([]);
    expect(readRecent("reva", memory({ [`${RECENT_PREFIX}reva`]: '{"a":1}' }))).toEqual([]);
    expect(readRecent("reva", memory({ [`${RECENT_PREFIX}reva`]: '["osago",7,null,""]' }))).toEqual(["osago"]);
    // Длиннее предела: лишнее отрезается при чтении
    expect(readRecent("reva", memory({ [`${RECENT_PREFIX}reva`]: JSON.stringify(["a", "b", "c", "d", "e", "f", "g"]) }))).toHaveLength(RECENT_MAX);
    // Хранилище запрещено: чтение даёт пусто, запись не бросает, список возвращается как есть
    expect(readRecent("reva", forbidden)).toEqual([]);
    expect(() => rememberRecent("reva", "osago", forbidden)).not.toThrow();
    expect(rememberRecent("reva", "osago", forbidden)).toEqual(["osago"]);
    expect(() => clearRecentTeams(forbidden)).not.toThrow();
    // Хранилища нет вовсе (сервер): тоже без падения
    expect(readRecent("reva", null)).toEqual([]);
    expect(rememberRecent("reva", "osago", null)).toEqual(["osago"]);
    expect(() => clearRecentTeams(null)).not.toThrow();
  });
});
