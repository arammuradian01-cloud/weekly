// Цели квартала из бордов лидеров (этап 31): чистые функции без базы.
//
// Борд лидера: у каждого лидера своя вкладка «Цели» (в борде Depo это «Цели бизнес»). В первых строках владелец
// («CPO - Рева Тарас» или просто «Логинова Светлана»), ниже разделы по кварталам с шапкой «№, Направление,
// Запланировано на 4Q, Артефакт/описание, Целевые, Start». Берётся только раздел нужного квартала.
//
// Вкладки с зарплатами, мотивацией, грейдами и оценками не читаются совсем: имя вкладки должно начинаться с «Цели»,
// а вкладки с мотивацией, калибровкой, оценками, премиями, старые и копии пропускаются. Раздел квартала, в шапке
// которого есть колонки об оплате или грейде, тоже не читается. Из раздела берутся только цель, направление,
// описание, база и целевое значение.

export type Grid = string[][];
export type Tab = { name: string; grid: Grid };

export type LeaderGoal = {
  /** Номер из колонки «№», без номера: следующий по порядку */
  number: number;
  /** Номер стоит в колонке «№» (иначе выдан по порядку и при загрузке может замениться номером цели с тем же названием) */
  numbered: boolean;
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

// Слово целиком: «зп», «old». \b в JavaScript не видит границ русских слов
const word = (w: string) => new RegExp(`(^|[^а-яёa-z0-9])(${w})([^а-яёa-z0-9]|$)`);
// Вкладка с личными данными по имени. «Бонус», «KPI» и «Performance» в имени не повод: так называют и продукты,
// колонки об оплате ловит проверка шапки раздела
const PRIVATE_TAB = /мотивац|калибровк|оценк|грейд|зарплат|оклад|прем(ия|ии|ий|иальн)|компенсац|review|ревью|salary|grade/;
const MONEY = /зарплат|оклад|прем(ия|ии|ий|иальн)|бонус|компенсац|грейд|salary|bonus|grade/;
// Колонки оценки человека: не читаются никогда, даже если в названии есть «описание» или «целевые»
const REVIEW = /оценк|калибр|review|ревью/;

/** Вкладка борда: цели, личные данные (мотивация, оценки, оплата), старая или копия, прочее */
export type TabKind = "goals" | "private" | "old" | "other";

export function tabKind(name: string): TabKind {
  const n = low(name);
  if (!/^цели/.test(n)) return "other";
  if (PRIVATE_TAB.test(n) || word("зп").test(n)) return "private";
  if (word("old").test(n) || /копия|архив|copy/.test(n)) return "old";
  return "goals";
}

/** Вкладки целей: имя начинается с «Цели». Мотивация, оценки, оплата, старые и копии не читаются */
export function isGoalsTab(name: string): boolean {
  return tabKind(name) === "goals";
}

/** Владелец из шапки вкладки: «CPO - Рева Тарас», «Логинова Светлана». «На кого???»: null */
export function ownerOf(grid: Grid): string | null {
  for (const row of grid.slice(0, 3)) {
    const first = row.map(clean).find(Boolean);
    if (!first) continue;
    if (/\?\?|не утверд|в поиск|вакан/i.test(first)) return null;
    const name = flat(first.includes(" - ") ? first.slice(first.lastIndexOf(" - ") + 3) : first);
    // Имя из двух-четырёх слов, без цифр и ссылок. Заголовок вроде «Борд 2026» или «Цели команды»: смотрим строку ниже
    if (!name || /\d|https?:/i.test(name) || name.split(" ").length > 4 || name.split(" ").length < 2) continue;
    if (/^(цел[ьи]|борд|board|goals|запланировано|№)(\s|$)/i.test(name)) continue;
    return name;
  }
  return null;
}

const QUARTER_TITLE = (q: number) =>
  new RegExp(`^запланировано на\\s*(${q}\\s*q|q\\s*${q}|${["", "i", "ii", "iii", "iv"][q]}\\s*кв|${q}\\s*-?\\s*(й|ый)?\\s*кв)`, "i");
const QUARTER_LABEL = (q: number) => new RegExp(`^(${q}\\s*q|q\\s*${q}|${q}\\s*-?\\s*(й|ый)?\\s*кв[а-я.]*)(\\s*'?\\d{2,4}( год)?)?$`, "i");
const YEAR_TITLE = /^запланировано на\s*(20\d{2})\s*(г|год)/i;

/** Год в шапке раздела: «4 Q 2026», «4Q 2025», «4Q26». Нет года: null */
function yearIn(cell: string): number | null {
  const full = cell.match(/(20\d{2})/);
  if (full) return Number(full[1]);
  const short = cell.match(/q\s*'?(\d{2})\b/i);
  return short ? 2000 + Number(short[1]) : null;
}

type Header = { at: number; year: number | null; label: string; title: number; number: number; direction: number; description: number; target: number; base: number; money: boolean };

/**
 * Шапка раздела квартала: «Запланировано на 4Q» или «4 Q 2026» рядом с «Запланировано». Год берётся из шапки, иначе
 * из раздела «Запланировано на 2026 год» выше. Разделов одного квартала несколько: раздел нужного года, без года
 * последний (борды растут вниз)
 */
function findHeader(grid: Grid, quarter: number, year?: number): Header | null {
  const found: Header[] = [];
  let context: number | null = null;
  for (let i = 0; i < grid.length; i++) {
    const cells = grid[i]!.map((c) => low(clean(c)));
    const yearTitle = cells.map((c) => c.match(YEAR_TITLE)).find(Boolean);
    if (yearTitle) context = Number(yearTitle[1]);
    let title = cells.findIndex((c) => QUARTER_TITLE(quarter).test(c));
    let label = -1;
    if (title < 0) {
      label = cells.findIndex((c) => QUARTER_LABEL(quarter).test(c));
      if (label < 0) continue;
      title = cells.findIndex((c) => c === "запланировано");
      if (title < 0) continue;
    }
    const at = (re: RegExp) => cells.findIndex((c) => re.test(c) && !MONEY.test(c) && !REVIEW.test(c));
    const numberCol = cells.findIndex((c) => c === "№");
    const directionCol = at(/^направление$/);
    found.push({
      at: i,
      year: yearIn(cells[title]!) ?? (label >= 0 ? yearIn(cells[label]!) : null) ?? context,
      label: label >= 0 ? cells[label]! : "",
      title,
      // Нет колонки «№»: номер в первой колонке, если она не колонка цели. Номером считается только число до 999
      number: numberCol >= 0 ? numberCol : title !== 0 ? 0 : -1,
      // В шапке вида «4 Q 2026, Запланировано» над направлением стоит подпись квартала
      direction: directionCol >= 0 ? directionCol : label >= 0 ? label : -1,
      description: at(/артефакт|описание/),
      target: at(/^целев(ые|ое|ой|ая)?( значени[ея]| показател[ьи])?$/),
      base: at(/^(start|старт|as is|база)$/),
      // Колонка об оплате или грейде в шапке раздела: раздел не читается
      money: cells.some((c) => MONEY.test(c) || word("зп").test(c)),
    });
  }
  if (year) {
    const exact = found.filter((h) => h.year === year);
    if (exact.length) return exact[exact.length - 1]!;
  }
  const open = found.filter((h) => h.year === null);
  return open[open.length - 1] ?? (year ? null : (found[found.length - 1] ?? null));
}

/** Конец раздела: следующая шапка, договорённости, бэклог, свалка. Смотрим только колонки номера, направления и цели:
 *  описание, которое начинается со слова «Договорённость», раздел не обрывает */
function endsSection(row: string[], h: Header): boolean {
  const at = (col: number) => (col >= 0 ? low(clean(row[col])) : "");
  const number = at(h.number);
  if (number === "№") return true;
  // Строка с номером: это цель, даже если её название начинается со слова «Договорённости»
  if (/^\d{1,3}\.?$/.test(number)) return false;
  // Шапка следующего раздела в любой колонке: «Запланировано на 1Q», «Запланировано на 2027 год» или «Запланировано»
  // рядом с подписью квартала
  const header = row.some((c) => {
    const v = low(clean(c));
    return v === "запланировано" || YEAR_TITLE.test(v) || [1, 2, 3, 4].some((q) => QUARTER_TITLE(q).test(v));
  });
  if (header) return true;
  const cells = [number, at(h.direction), at(h.title)].filter(Boolean);
  return cells.some((c) => /^договор[её]нност/.test(c) || /^(свалка|бэклог|backlog)/.test(c));
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

/** Цели нужного квартала из одной вкладки. year: год квартала, разделы другого года не берутся */
export function readLeaderTab(tab: Tab, quarter: number, year?: number): LeaderTab {
  const owner = ownerOf(tab.grid);
  const header = findHeader(tab.grid, quarter, year);
  const out: LeaderTab = { tab: tab.name.trim(), owner, goals: [], skip: null };
  if (!header) {
    out.skip = `Нет раздела «Запланировано на ${quarter}Q»${year ? ` ${year} года` : ""}`;
    return out;
  }
  if (header.money) {
    out.skip = "В шапке раздела есть колонки об оплате или грейде: вкладка не читается";
    return out;
  }
  let next = 1;
  for (let i = header.at + 1; i < tab.grid.length; i++) {
    const row = tab.grid[i]!;
    if (endsSection(row, header)) break;
    const get = (col: number) => (col >= 0 ? clean(row[col]) : "");
    const raw = get(header.title);
    if (!raw) continue;
    const cell = get(header.number).replace(/\.$/, "");
    const n = /^\d{1,3}$/.test(cell) ? Number(cell) : NaN;
    const { title, rest } = splitTitle(raw);
    const prev = out.goals[out.goals.length - 1];
    // Объединённая по строкам ячейка цели повторяет текст в каждой строке: это та же цель
    if (prev && prev.title === title && (!Number.isFinite(n) || n === prev.number)) continue;
    const numbered = Number.isFinite(n) && n > 0 && !out.goals.some((g) => g.number === n);
    const number = numbered ? n : next;
    next = Math.max(next, number) + 1;
    // Подпись квартала «4 Q 2026», объединённая вниз по колонке, направлением не считается
    const cellDirection = header.direction === header.title ? "" : flat(get(header.direction));
    const direction = header.label && low(cellDirection) === header.label ? "" : cellDirection;
    const description = [direction ? `Направление: ${direction}.` : "", rest, get(header.description)].filter(Boolean).join("\n").slice(0, DESCRIPTION_MAX);
    out.goals.push({ number, numbered, direction, title, description, base: flat(get(header.base)).slice(0, 120), target: flat(get(header.target)).slice(0, 300) });
  }
  if (!out.goals.length) out.skip = `Раздел «Запланировано на ${quarter}Q» пустой`;
  else if (!owner) out.skip = "В шапке вкладки не указан владелец";
  return out;
}

const KIND_SKIP: Record<TabKind, string> = {
  goals: "",
  other: "",
  private: "Вкладка с мотивацией, оценками или оплатой: не читается",
  old: "Старая вкладка или копия: не читается",
};

/** Все вкладки целей файла. Одинаковый владелец в двух вкладках: вторая пропускается, шапку стоит проверить.
 *  Вкладки «Цели» с личными данными и старые попадают в список с причиной, их ячейки не читаются */
export function readLeaderBoard(tabs: Tab[], quarter: number, year?: number): LeaderTab[] {
  const out = tabs
    .map((t) => ({ t, kind: tabKind(t.name) }))
    .filter(({ kind }) => kind !== "other")
    .map(({ t, kind }) => (kind === "goals" ? readLeaderTab(t, quarter, year) : { tab: t.name.trim(), owner: null, goals: [], skip: KIND_SKIP[kind] }));
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

/** Основа кода цели человека: инициалы, при совпадении фамилия, фамилия с инициалом имени, инициалы с цифрой.
 *  taken: основа уже занята другим человеком в той же команде. Код не длиннее 20 знаков вместе с номером */
export function codeBase(fullName: string, taken: (base: string) => boolean): string {
  const words = flat(fullName).split(" ").filter(Boolean);
  const initials = personCode(fullName, 0).slice(0, -2);
  const surname = (words[0] ?? "Ц").slice(0, 12);
  const candidates = [initials, surname, `${surname}${words[1]?.[0]?.toUpperCase() ?? ""}`];
  for (let k = 2; k < 100; k++) candidates.push(`${initials}${k}`);
  return candidates.find((b) => !taken(b)) ?? `${initials}${Date.now() % 1000}`;
}

/**
 * Номера целей человека при загрузке. Номер из колонки «№» остаётся. Цель без номера получает номер прежней цели с тем
 * же названием: строка, вставленная в середину борда, не сдвигает коды остальных целей. previous: название, номер
 */
export function assignNumbers(goals: LeaderGoal[], previous: Map<string, number>): number[] {
  const used = new Set(goals.filter((g) => g.numbered).map((g) => g.number));
  const out = goals.map((g) => (g.numbered ? g.number : 0));
  goals.forEach((g, i) => {
    if (g.numbered) return;
    const was = previous.get(low(g.title));
    if (was && !used.has(was)) {
      out[i] = was;
      used.add(was);
    }
  });
  let next = 1;
  goals.forEach((g, i) => {
    if (out[i]) return;
    let n = used.has(g.number) ? 0 : g.number;
    if (!n) {
      while (used.has(next)) next++;
      n = next;
    }
    out[i] = n;
    used.add(n);
  });
  return out;
}

/** Название для сравнения: без регистра, лишних пробелов и разницы е и ё */
export const titleKey = (title: string) => low(title);

/** Код цели человека: инициалы и номер, «РТ-1». Номера у разных людей одной команды не пересекаются */
export function personCode(fullName: string, number: number): string {
  const letters = flat(fullName)
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return `${letters || "Ц"}-${number}`;
}
