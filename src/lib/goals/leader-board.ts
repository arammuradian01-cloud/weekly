// Цели квартала из бордов лидеров (этап 31): чистые функции без базы.
//
// Борд лидера: у каждого лидера своя вкладка «Цели …» (в борде Depo это «Цели бизнес»). В первых строках владелец
// («CPO - Рева Тарас» или просто «Логинова Светлана»), ниже разделы по кварталам с шапкой «№, Направление,
// Запланировано на 4Q, Артефакт/описание, Целевые, Start». Берётся только раздел нужного квартала.
//
// Вкладки с зарплатами, мотивацией, грейдами и оценками не читаются совсем: имя вкладки должно начинаться с «Цели»,
// а «мотивация», «калибровка», «old» и копии пропускаются. Из раздела квартала берутся только цель, направление,
// описание, база и целевое значение.

export type Grid = string[][];
export type Tab = { name: string; grid: Grid };

export type LeaderGoal = {
  /** Номер из колонки «№», без номера: следующий по порядку */
  number: number;
  direction: string;
  title: string;
  description: string;
  base: string;
  target: string;
};

export type LeaderTab = {
  tab: string;
  /** Имя владельца, как написано в шапке вкладки. null: не указан */
  owner: string | null;
  goals: LeaderGoal[];
  /** Почему вкладку не взять: нет владельца, нет раздела квартала, раздел пустой */
  skip: string | null;
};

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 2000;

const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\t/g, " ")
    .replace(/[\u2014\u2013]/g, "-")
    .trim()
    // Ячейка, вставленная из другой таблицы, бывает в кавычках целиком
    .replace(/^"([\s\S]*)"$/, "$1")
    .trim();
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const low = (s: string) => flat(s).toLowerCase().replace(/ё/g, "е");

/** Вкладки целей: имя начинается с «Цели». Мотивация, калибровка, старые и копии не читаются */
export function isGoalsTab(name: string): boolean {
  const n = low(name);
  return /^цели/.test(n) && !/мотивац|калибровк|\bold\b|копия|архив/.test(n);
}

/** Владелец из шапки вкладки: «CPO - Рева Тарас», «Логинова Светлана». «На кого???»: null */
export function ownerOf(grid: Grid): string | null {
  for (const row of grid.slice(0, 3)) {
    const first = row.map(clean).find(Boolean);
    if (!first) continue;
    if (/\?\?|не утверд|в поиск|вакан/i.test(first)) return null;
    const name = flat(first.includes(" - ") ? first.slice(first.lastIndexOf(" - ") + 3) : first);
    // Имя из двух-трёх слов, без цифр и ссылок
    if (!name || /\d|https?:/i.test(name) || name.split(" ").length > 4) return null;
    return name;
  }
  return null;
}

const QUARTER_TITLE = (q: number) => new RegExp(`^запланировано на\\s*(${q}\\s*q|q\\s*${q}|${["", "i", "ii", "iii", "iv"][q]}\\s*кв|${q}\\s*кв)`, "i");
const QUARTER_LABEL = (q: number) => new RegExp(`^(${q}\\s*q|q\\s*${q})(\\s*\\d{4})?$`, "i");

type Header = { at: number; title: number; number: number; direction: number; description: number; target: number; base: number };

/** Шапка раздела квартала: «Запланировано на 4Q» или «4 Q 2026» рядом с «Запланировано» */
function findHeader(grid: Grid, quarter: number): Header | null {
  for (let i = 0; i < grid.length; i++) {
    const cells = grid[i]!.map((c) => low(clean(c)));
    let title = cells.findIndex((c) => QUARTER_TITLE(quarter).test(c));
    let label = -1;
    if (title < 0) {
      label = cells.findIndex((c) => QUARTER_LABEL(quarter).test(c));
      if (label < 0) continue;
      title = cells.findIndex((c) => c === "запланировано");
      if (title < 0) continue;
    }
    const at = (re: RegExp) => cells.findIndex((c) => re.test(c));
    const numberCol = at(/^№$/);
    const directionCol = at(/^направление$/);
    return {
      at: i,
      title,
      number: numberCol >= 0 ? numberCol : 0,
      // В шапке вида «4 Q 2026, Запланировано» над направлением стоит подпись квартала
      direction: directionCol >= 0 ? directionCol : label >= 0 ? label : -1,
      description: at(/артефакт|описание/),
      target: at(/^целев/),
      base: at(/^(start|старт|as is|база)$/),
    };
  }
  return null;
}

/** Конец раздела: следующая шапка, договорённости, бэклог, свалка */
function endsSection(row: string[]): boolean {
  const cells = row.map((c) => low(clean(c))).filter(Boolean);
  if (!cells.length) return false;
  if (cells[0] === "№") return true;
  return cells.some((c) => /^запланировано( на|$)/.test(c) || /^договор[её]нност/.test(c) || /^(свалка|бэклог|backlog)/.test(c));
}

/** Длинное название: первая фраза до 300 знаков, остальное уходит в начало описания */
export function splitTitle(text: string): { title: string; rest: string } {
  const t = flat(text);
  if (t.length <= TITLE_MAX) return { title: t, rest: "" };
  const cut = t.slice(0, TITLE_MAX);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  const at = stop > 80 ? stop + 1 : cut.lastIndexOf(" ") > 80 ? cut.lastIndexOf(" ") : TITLE_MAX;
  return { title: t.slice(0, at).trim(), rest: t.slice(at).trim() };
}

/** Цели нужного квартала из одной вкладки */
export function readLeaderTab(tab: Tab, quarter: number): LeaderTab {
  const owner = ownerOf(tab.grid);
  const header = findHeader(tab.grid, quarter);
  const out: LeaderTab = { tab: tab.name.trim(), owner, goals: [], skip: null };
  if (!header) {
    out.skip = `Нет раздела «Запланировано на ${quarter}Q»`;
    return out;
  }
  let next = 1;
  for (let i = header.at + 1; i < tab.grid.length; i++) {
    const row = tab.grid[i]!;
    if (endsSection(row)) break;
    const get = (col: number) => (col >= 0 ? clean(row[col]) : "");
    const raw = get(header.title);
    if (!raw) continue;
    const n = Number.parseInt(get(header.number), 10);
    const number = Number.isFinite(n) && n > 0 && !out.goals.some((g) => g.number === n) ? n : next;
    next = Math.max(next, number) + 1;
    const { title, rest } = splitTitle(raw);
    const direction = header.direction === header.title ? "" : flat(get(header.direction));
    const description = [direction ? `Направление: ${direction}.` : "", rest, get(header.description)].filter(Boolean).join("\n").slice(0, DESCRIPTION_MAX);
    out.goals.push({ number, direction, title, description, base: flat(get(header.base)).slice(0, 120), target: flat(get(header.target)).slice(0, 300) });
  }
  if (!out.goals.length) out.skip = `Раздел «Запланировано на ${quarter}Q» пустой`;
  else if (!owner) out.skip = "В шапке вкладки не указан владелец";
  return out;
}

/** Все вкладки целей файла. Одинаковый владелец в двух вкладках: вторая пропускается, шапку стоит проверить */
export function readLeaderBoard(tabs: Tab[], quarter: number): LeaderTab[] {
  const out = tabs.filter((t) => isGoalsTab(t.name)).map((t) => readLeaderTab(t, quarter));
  const seen = new Map<string, string>();
  for (const t of out) {
    if (t.skip || !t.owner) continue;
    const key = low(t.owner).split(" ").sort().join(" ");
    const first = seen.get(key);
    if (first) t.skip = `Владелец «${t.owner}» уже есть во вкладке «${first}»: проверьте шапку вкладки`;
    else seen.set(key, t.tab);
  }
  return out;
}

/** Код цели человека: инициалы и номер, «РТ-1». Номера у разных людей одной команды не пересекаются */
export function personCode(fullName: string, number: number): string {
  const letters = flat(fullName)
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return `${letters || "Ц"}-${number}`;
}
