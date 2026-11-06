// Замер живых данных перед пересборкой экрана «Сдать weekly» (этап 87). Пять вопросов из раздела «Что проверить на
// живых данных до начала пересборки» документа docs/resheniya-peresborka-sdachi-weekly.md:
//
// 1. Сколько записей сдают за неделю и какие поля записи реально заполняют (решение 14: прятать ли «Влияние» и «Цифру»);
// 2. Сколько команд завели шаблон блоков и есть ли среди них свои блоки;
// 3. Сколько записей не влезает в предел строки отчёта (BLOCK_LIMITS.text);
// 4. Что получает человек, состоящий в двух и более командах с разными шаблонами;
// 5. Выборка миграции за четыре недели: куда переедет каждая запись по правилу entryBlockKey (решение 8).
//
// Здесь только чистые функции на готовых данных: их считает команда замера (scripts/measure-weekly.ts через
// src/lib/weekly-measure/collect.ts) и модульные тесты. Правило переезда и предел строки не переписаны второй
// реализацией: entryBlockKey, entryText и BLOCK_LIMITS берутся из приложения, иначе выборка соврёт о том, что
// сделает настоящая миграция.

import { entryBlockKey, entryText } from "@/lib/weekly-blocks/assemble";
import { BLOCK_LIMITS, LIVE_FIGURE_KEYS, STANDARD_KEYS, STANDARD_TEMPLATE, standardOf, tidy, type TemplateBlock } from "@/lib/weekly-blocks/types";

// ---------- Данные замера ----------

export type MeasureWeek = { key: string; number: number; year: number; /** Текущая отчётная неделя: её цифры неполные */ current: boolean };

/** Запись weekly в том виде, в каком её читает замер. Поля совпадают с полями формы записи */
export type MeasureEntry = {
  id: string;
  weekKey: string;
  authorId: string | null;
  authorName: string;
  direction: string;
  /** Код старого справочника блоков на 7 значений: «было» в выборке миграции */
  block: string;
  blockLabel: string;
  type: string;
  /** Блок шаблона, по которому запись сдали. null: шаблона не было */
  section: string | null;
  what: string;
  fact: string | null;
  impact: string | null;
  next: string | null;
  help: string | null;
  /** Сколько ссылок на артефакты в записи */
  links: number;
};

export type MeasureTeam = {
  id: string;
  name: string;
  /** Сохранённая настройка; null: руководитель ещё не задавал шаблон. */
  template: TemplateBlock[] | null;
  /** Рабочий шаблон после этапа 88: включает виртуальный стандарт и совместимость старых наборов. */
  effective?: TemplateBlock[];
};

export type MeasureAuthor = {
  personId: string;
  name: string;
  /** Команды по порядку правила шаблона: сначала те, что ждут weekly человека, затем остальные его команды */
  order: string[];
  /** Команды, чей отчёт видит записи человека: где он участник или руководитель */
  showing: string[];
  /** Команда, по чьему шаблону (своему или стандартному) человек сдаёт weekly. null: нет команды сдачи */
  templateTeamId: string | null;
};

export type MeasureInput = {
  /** Недели периода, от свежей к старой */
  weeks: MeasureWeek[];
  /** Сколько последних недель разбираются подробно (решение 8: выборка за четыре недели) */
  recent: number;
  entries: MeasureEntry[];
  teams: MeasureTeam[];
  authors: MeasureAuthor[];
  /** Сколько всего включённых команд, включая топ-команду */
  teamsTotal: number;
};

// ---------- 1. Записи и поля ----------

export const FIELDS = [
  { key: "impact", title: "Влияние на бизнес" },
  { key: "fact", title: "Цифра или факт" },
  { key: "next", title: "Что делаем дальше" },
  { key: "help", title: "Какая помощь нужна" },
  { key: "link", title: "Ссылка на артефакт" },
] as const;

export type FieldKey = (typeof FIELDS)[number]["key"];

/** Поле записи заполнено: в тексте есть хоть один знак, у ссылки есть хоть одна ссылка */
export function fieldFilled(e: MeasureEntry, field: FieldKey): boolean {
  if (field === "link") return e.links > 0;
  const value = field === "impact" ? e.impact : field === "fact" ? e.fact : field === "next" ? e.next : e.help;
  return typeof value === "string" && value.trim().length > 0;
}

export type FieldShare = { key: FieldKey; title: string; filled: number; /** Доля от 0 до 1 */ share: number };
export type WeekFill = { week: MeasureWeek; entries: number; fields: FieldShare[] };

/** Доли заполненных полей по списку записей */
export function fieldShares(entries: readonly MeasureEntry[]): FieldShare[] {
  return FIELDS.map((f) => {
    const filled = entries.filter((e) => fieldFilled(e, f.key)).length;
    return { key: f.key, title: f.title, filled, share: entries.length ? filled / entries.length : 0 };
  });
}

/**
 * Что доля заполнения «Влияния» и «Цифры» значит для решения 14. Порог из документа решений: «одна запись из десяти»
 * против «каждой второй». Берётся большая из двух долей: прячем оба поля одной кнопкой
 */
export type DetailsVerdict = "cheap" | "discuss" | "revisit";
export const DETAILS_RARE = 0.15;
export const DETAILS_OFTEN = 0.4;
export function detailsVerdict(shares: readonly number[]): DetailsVerdict {
  const top = shares.length ? Math.max(...shares) : 0;
  return top < DETAILS_RARE ? "cheap" : top <= DETAILS_OFTEN ? "discuss" : "revisit";
}

export type FillsPart = {
  weeks: number;
  entries: number;
  /** Среднее за неделю по завершённым неделям периода (текущая отчётная неделя не считается: она неполная) */
  perWeek: number;
  countedWeeks: number;
  fields: FieldShare[];
  /** Все недели периода: сколько записей сдали */
  byWeek: { week: MeasureWeek; entries: number }[];
  /** Последние четыре недели подробно */
  recent: WeekFill[];
  verdict: DetailsVerdict;
};

export function fillsPart(input: MeasureInput): FillsPart {
  const of = (key: string) => input.entries.filter((e) => e.weekKey === key);
  const closed = input.weeks.filter((w) => !w.current);
  const countedEntries = input.entries.filter((e) => closed.some((w) => w.key === e.weekKey)).length;
  const fields = fieldShares(input.entries);
  const share = (key: FieldKey) => fields.find((f) => f.key === key)?.share ?? 0;
  return {
    weeks: input.weeks.length,
    entries: input.entries.length,
    perWeek: closed.length ? countedEntries / closed.length : 0,
    countedWeeks: closed.length,
    fields,
    byWeek: input.weeks.map((week) => ({ week, entries: of(week.key).length })),
    recent: input.weeks.slice(0, input.recent).map((week) => {
      const list = of(week.key);
      return { week, entries: list.length, fields: fieldShares(list) };
    }),
    verdict: detailsVerdict([share("impact"), share("fact")]),
  };
}

// ---------- 2. Шаблоны блоков команд ----------

export const isCustomKey = (key: string): boolean => key.startsWith("c:");

export type TemplateRow = { team: string; blocks: number; custom: string[]; /** В шаблоне нет блока «Продукты»: записи поедут не по смыслу */ noProducts: boolean; /** В шаблоне только блоки цифр: записи туда не попадут */ onlyFigures: boolean };

export type TemplatesPart = {
  teamsTotal: number;
  withTemplate: number;
  customTotal: number;
  rows: TemplateRow[];
};

export function templatesPart(input: MeasureInput): TemplatesPart {
  const rows: TemplateRow[] = input.teams
    .filter((t) => t.template && t.template.length)
    .map((t) => {
      const blocks = t.template!;
      const keys = blocks.map((b) => b.key);
      return {
        team: t.name,
        blocks: blocks.length,
        custom: blocks.filter((b) => isCustomKey(b.key)).map((b) => b.title),
        noProducts: !keys.includes("products"),
        onlyFigures: keys.every((k) => LIVE_FIGURE_KEYS.includes(k)),
      };
    });
  return {
    teamsTotal: input.teamsTotal,
    withTemplate: rows.length,
    customTotal: rows.reduce((n, r) => n + r.custom.length, 0),
    rows,
  };
}

// ---------- 3. Обрезка строки отчёта ----------

const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/** Строка отчёта из записи и её обрезка: так же, как их делает автосборка (entryText плюс tidy до BLOCK_LIMITS.text) */
export function reportLine(e: MeasureEntry): { full: string; cut: string; over: number } {
  const full = tidy(entryText(e), NO_LIMIT);
  const cut = tidy(entryText(e), BLOCK_LIMITS.text);
  return { full, cut, over: Math.max(0, full.length - cut.length) };
}

export type CutExample = { weekKey: string; author: string; before: number; after: number; full: string; cut: string };
export type CutPart = { limit: number; checked: number; cut: number; share: number; longest: number; examples: CutExample[] };

export function cutPart(input: MeasureInput, examples = 3): CutPart {
  const lines = input.entries.map((e) => ({ e, ...reportLine(e) }));
  const over = lines.filter((l) => l.over > 0).sort((a, b) => b.full.length - a.full.length);
  return {
    limit: BLOCK_LIMITS.text,
    checked: lines.length,
    cut: over.length,
    share: lines.length ? over.length / lines.length : 0,
    longest: lines.reduce((max, l) => Math.max(max, l.full.length), 0),
    examples: over.slice(0, examples).map((l) => ({ weekKey: l.e.weekKey, author: l.e.authorName, before: l.full.length, after: l.cut.length, full: l.full, cut: l.cut })),
  };
}

// ---------- 4. Человек в нескольких командах ----------

/** Отпечаток шаблона: по нему видно, что у команд шаблоны разные. Нет шаблона: тоже значение */
export const templateSign = (team: MeasureTeam | undefined): string => (team?.template?.length ? team.template.map((b) => `${b.key}=${b.title}`).join("|") : "—");

export type MultiTeamPerson = {
  name: string;
  /** Команды по порядку правила шаблона */
  teams: { name: string; blocks: number | null }[];
  /** Команда, чей шаблон человек получает по правилу приложения */
  winner: string | null;
  /** Блоки, которые человек получает */
  blocks: string[];
  /** Правило взяло не первую команду из списка: у первой шаблона нет */
  notFirst: boolean;
};

export type MultiTeamPart = { people: MultiTeamPerson[]; notFirst: number };

/**
 * Люди в двух и более командах, где шаблоны разные (нет шаблона тоже считается). Что они получают: по коду это шаблон
 * первой команды из списка, но правило перебирает команды по порядку и берёт первую, где шаблон задан. Расхождение
 * (winner не первая команда) видно в поле notFirst
 */
export function multiTeamPart(input: MeasureInput): MultiTeamPart {
  const team = (id: string) => input.teams.find((t) => t.id === id);
  const people: MultiTeamPerson[] = [];
  for (const a of input.authors) {
    if (a.order.length < 2) continue;
    const signs = new Set(a.order.map((id) => templateSign(team(id))));
    if (signs.size < 2) continue;
    const winner = a.templateTeamId ? team(a.templateTeamId) : undefined;
    people.push({
      name: a.name,
      teams: a.order.map((id) => ({ name: team(id)?.name ?? id, blocks: team(id)?.template?.length ?? null })),
      winner: winner?.name ?? null,
      blocks: (winner?.effective ?? winner?.template)?.map((b) => b.title) ?? [],
      notFirst: !!a.templateTeamId && a.templateTeamId !== a.order[0],
    });
  }
  people.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { people, notFirst: people.filter((p) => p.notFirst).length };
}

// ---------- 5. Выборка миграции ----------

/**
 * Почему запись попала в этот блок:
 * - section: её сдали по этому блоку шаблона;
 * - sense: по смыслу (риск, план, команда, партнёрка, продукты) и такой блок в шаблоне есть;
 * - products: блока по смыслу в шаблоне нет, запись ушла в «Продукты»;
 * - first: ни блока по смыслу, ни «Продуктов» — запись ушла в первый блок шаблона. Однозначного ответа правило не дало
 */
export type MoveReason = "section" | "sense" | "products" | "first";

/**
 * Что в переезде записи требует решения владельца:
 * - stale-section: запись сдана по блоку, которого в шаблоне уже нет, блок записи теряется;
 * - outside-template: блока, в который запись переехала, в шаблоне её команды нет. По правилу это бывает только когда
 *   шаблона у команды нет совсем и блок считали по стандартному набору (решение 5); признак считается по каждой
 *   команде, которая видит запись, чтобы случай нашёлся и если правило изменят;
 * - figures-block: запись переехала в блок цифр («Неделя к неделе», «Месяц»), который ресурс собирает сам: строка
 *   записи там не сохранится;
 * - no-author: у записи нет автора (общая запись «Все лидеры»), команды и шаблона у неё нет;
 * - split-teams: человек в нескольких командах, и в их отчётах запись попадёт в разные блоки
 */
export type MoveFlag = "stale-section" | "outside-template" | "figures-block" | "no-author" | "split-teams";

export type Move = {
  entryId: string;
  weekKey: string;
  author: string;
  /** Команда, по шаблону которой считали переезд. null: шаблона нет, считали по стандартному набору */
  team: string | null;
  from: string;
  fromLabel: string;
  to: string;
  toTitle: string;
  reason: MoveReason;
  flags: MoveFlag[];
  /** Первые знаки «Что произошло»: чтобы владелец узнал запись, без полного текста */
  start: string;
  /** Куда запись попадёт в отчёте каждой команды автора и есть ли такой блок в шаблоне этой команды */
  perTeam: { team: string; toTitle: string; inTemplate: boolean }[];
};

const titleOf = (key: string, blocks: readonly TemplateBlock[]): string => blocks.find((b) => b.key === key)?.title ?? standardOf(key)?.title ?? key;

/** Переезд одной записи по шаблону. template пустой или null: считаем по стандартному набору (решение 5) */
export function moveTo(e: MeasureEntry, template: TemplateBlock[] | null): { to: string; toTitle: string; reason: MoveReason; stale: boolean; figures: boolean; assumed: boolean } {
  const own = template && template.length ? template : null;
  const blocks = own ?? STANDARD_TEMPLATE;
  const keys = blocks.map((b) => b.key);
  const to = entryBlockKey(e, keys);
  // Блок по смыслу: то же правило на полном наборе блоков, где блок по смыслу есть всегда. Второй реализации правила нет
  const want = entryBlockKey({ section: null, type: e.type, block: e.block, direction: e.direction }, STANDARD_KEYS);
  const bySection = !!e.section && to === e.section && !LIVE_FIGURE_KEYS.includes(e.section);
  const reason: MoveReason = bySection ? "section" : to === want ? "sense" : to === "products" ? "products" : "first";
  return {
    to,
    toTitle: titleOf(to, blocks),
    reason,
    stale: !!e.section && !LIVE_FIGURE_KEYS.includes(e.section) && !keys.includes(e.section),
    figures: LIVE_FIGURE_KEYS.includes(to),
    assumed: !own,
  };
}

export type MovePart = {
  weeks: string[];
  entries: number;
  byReason: Record<MoveReason, number>;
  /** Сколько записей переезжает из какого блока в какой */
  pairs: { fromLabel: string; toTitle: string; count: number }[];
  /** Сколько записей в какой блок переезжает */
  targets: { toTitle: string; count: number }[];
  /** Случаи, которые решают, можно ли утверждать миграцию */
  problems: Move[];
};

/** Выборка миграции за последние недели: куда переедет каждая запись и какие случаи требуют решения */
export function movePart(input: MeasureInput): MovePart {
  const weeks = input.weeks.slice(0, input.recent).map((w) => w.key);
  const entries = input.entries.filter((e) => weeks.includes(e.weekKey));
  const team = (id: string) => input.teams.find((t) => t.id === id);
  const byReason: Record<MoveReason, number> = { section: 0, sense: 0, products: 0, first: 0 };
  const pairs = new Map<string, { fromLabel: string; toTitle: string; count: number }>();
  const targets = new Map<string, number>();
  const problems: Move[] = [];

  for (const e of entries) {
    const author = e.authorId ? input.authors.find((a) => a.personId === e.authorId) : undefined;
    const home = author?.templateTeamId ? team(author.templateTeamId) : undefined;
    const main = moveTo(e, home?.effective ?? home?.template ?? null);
    byReason[main.reason] += 1;
    const pairKey = `${e.block}>${main.to}`;
    const pair = pairs.get(pairKey) ?? { fromLabel: e.blockLabel, toTitle: main.toTitle, count: 0 };
    pair.count += 1;
    pairs.set(pairKey, pair);
    targets.set(main.toTitle, (targets.get(main.toTitle) ?? 0) + 1);

    // Куда запись попадёт в отчёте каждой команды автора: у человека в нескольких командах блоки могут разойтись
    const perTeam = (author?.showing ?? [])
      .map((id) => team(id))
      .filter((t): t is MeasureTeam => !!t)
      .map((t) => {
        const template = t.effective ?? t.template;
        const own = moveTo(e, template);
        const keys = template?.map((b) => b.key) ?? [];
        return { team: t.name, toTitle: own.toTitle, inTemplate: keys.includes(own.to) };
      });
    const flags: MoveFlag[] = [];
    if (main.stale) flags.push("stale-section");
    if (main.assumed || perTeam.some((p) => !p.inTemplate)) flags.push("outside-template");
    if (main.figures) flags.push("figures-block");
    if (!e.authorId) flags.push("no-author");
    if (new Set(perTeam.map((p) => p.toTitle)).size > 1) flags.push("split-teams");
    const ambiguous = main.reason === "products" || main.reason === "first";
    if (flags.length || ambiguous) {
      problems.push({
        entryId: e.id,
        weekKey: e.weekKey,
        author: e.authorName,
        team: home?.name ?? null,
        from: e.block,
        fromLabel: e.blockLabel,
        to: main.to,
        toTitle: main.toTitle,
        reason: main.reason,
        flags,
        start: tidy(e.what, 40),
        perTeam,
      });
    }
  }

  const order = (a: { count: number }, b: { count: number }) => b.count - a.count;
  return {
    weeks,
    entries: entries.length,
    byReason,
    pairs: [...pairs.values()].sort(order),
    targets: [...targets.entries()].map(([toTitle, count]) => ({ toTitle, count })).sort(order),
    problems,
  };
}

// ---------- Замер целиком ----------

export type Survey = { input: MeasureInput; fills: FillsPart; templates: TemplatesPart; cut: CutPart; multi: MultiTeamPart; move: MovePart };

export function survey(input: MeasureInput): Survey {
  return { input, fills: fillsPart(input), templates: templatesPart(input), cut: cutPart(input), multi: multiTeamPart(input), move: movePart(input) };
}
