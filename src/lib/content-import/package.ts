// Пакет наполнения (этап 67): задачи, решения, цели и связи задач с целями, которые собраны из истории проекта и
// проверены владельцем. Здесь только разбор и проверка файла, без базы: что в нём должно быть и в каком виде.
// Пакет хранится вне репозитория (в нём внутренние имена и цифры), в базу попадают только записи и их ключи.
//
// У каждой записи стабильный внешний ключ: по нему повторная загрузка находит то, что уже загружено, и ничего не
// дублирует. Ссылки внутри пакета идут по ключам: задача решения { key }, цель связи { key } или уже существующая
// в ресурсе задача { number } и цель { code }.
//
// Этап 67г: крупные инициативы (initiatives). Продукт по коду справочника направлений, ответственный по ФИО, деление
// шкалы searching или doing, закрытые done или dropped с итогом.
//
// Этап 67г: удаление (remove). Пакет перечисляет по ключам решения, которые загрузка ставила раньше и которые нужно
// стереть: раздел решений собирают заново. Стирается только то, что поставила сама загрузка.
//
// Этап 67г: weekly для CEO за прошедшие недели (ceoReports): неделя понедельником, блоки отчёта (ключи этапа 66) со
// строками и «Мои встречи недели».

import { createHash } from "node:crypto";
import type { IsoDate } from "@/domain/dates";
import { resourceChars } from "@/lib/meeting/parse-types";

import { PACKAGE_FORMAT, PACKAGE_LINK_TITLE_MAX, PACKAGE_MAX_BYTES, PACKAGE_MAX_ITEMS, PACKAGE_MAX_LABEL, PACKAGE_TITLE_MAX, PACKAGE_URL_MAX } from "./limits";

export { PACKAGE_FORMAT, PACKAGE_MAX_BYTES, PACKAGE_MAX_ITEMS, PACKAGE_MAX_LABEL };

export const IMPORT_STATUSES = ["in-progress", "clarify", "done", "partial", "failed", "cancelled"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export const IMPORT_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export const IMPORT_SOURCES = ["meeting", "weekly", "ceo", "other"] as const;
export const CONFIDENCE = ["высокая", "средняя", "низкая"] as const;

export type TaskRef = { key: string } | { number: number };
export type GoalRef = { key: string } | { code: string };

export type PackageGoal = {
  key: string;
  quarter: string;
  /** Команда по названию как в ресурсе или «top». Пусто: команда, которой руководит владелец цели */
  team: string | null;
  /** ФИО владельца как в ресурсе */
  owner: string | null;
  code: string | null;
  title: string;
  description: string | null;
  metric: string | null;
  base: string | null;
  target: string | null;
  link: string | null;
  parent: GoalRef | null;
  /** Цель уже есть в ресурсе с тем же номером: true значит привести её к пакету (тексты и целевые как в борде),
   *  false: заполнить только пустые поля */
  replace: boolean;
  /** Откуда цель: leader-board:<вкладка> для целей из бордов лидеров. Пусто: manual */
  source: string | null;
};

export type PackageTask = {
  key: string;
  title: string;
  outcome: string;
  /** ФИО ответственного или «Все лидеры» */
  owner: string;
  coExecutors: string[];
  direction: string;
  team: string | null;
  due: IsoDate;
  status: ImportStatus;
  /** Когда задачу закрыли (для закрытых статусов). Пусто: срок, если он прошёл, иначе дата источника, иначе день загрузки */
  closedAt: IsoDate | null;
  /** Итог или причина: обязательны для закрытых статусов */
  resolution: string | null;
  whereNow: string | null;
  priority: (typeof IMPORT_PRIORITIES)[number] | null;
  source: { kind: (typeof IMPORT_SOURCES)[number]; note: string | null; date: IsoDate | null };
  links: { title: string | null; url: string }[];
  /** Задача уже есть в ресурсе (поставлена до импорта): номер и её название в ресурсе для проверки. Загрузка не
   *  создаёт новую задачу, а подхватывает эту и приводит статус, «Где сейчас» и срок к пакету. Название, «что нужно
   *  сделать» и ответственного ведут в ресурсе, закрытую задачу загрузка не открывает */
  adopt: { number: number; title: string } | null;
};

export type PackageDecision = {
  key: string;
  text: string;
  date: IsoDate;
  team: string | null;
  owner: string | null;
  tasks: TaskRef[];
  status: "active" | "cancelled";
  cancelReason: string | null;
};

export type PackageLink = {
  key: string;
  task: TaskRef;
  goal: GoalRef;
  confidence: (typeof CONFIDENCE)[number] | null;
  reason: string | null;
};

export const INITIATIVE_STATES = ["searching", "doing", "done", "dropped"] as const;
export type InitiativeState = (typeof INITIATIVE_STATES)[number];

export type PackageInitiative = {
  key: string;
  title: string;
  why: string | null;
  /** Код продукта из справочника направлений. Пусто: общая для департамента */
  direction: string | null;
  /** ФИО ответственного как в ресурсе */
  owner: string;
  /** Команда, которая ведёт инициативу, по названию или «top». Пусто: топ-команда */
  team: string | null;
  goal: GoalRef | null;
  /** searching и doing: деление шкалы; done и dropped: закрыта, итог в result */
  state: InitiativeState;
  /** Что сейчас происходит: одна фраза */
  note: string | null;
  result: string | null;
};

/** Запись пакета, которая не загрузится, пока её не исправят в файле: например, в ней кадровые сведения */
export type ExcludedRecord = { kind: "task" | "decision" | "goal" | "link" | "initiative" | "ceo"; key: string; what: string; text: string };

/** Строка блока отчёта CEO: текст и код продукта (пусто: общая строка) */
export type PackageCeoLine = { text: string; product: string | null };
export type PackageCeoReport = {
  key: string;
  /** Понедельник недели */
  week: IsoDate;
  blocks: { key: string; lines: PackageCeoLine[] }[];
  meetings: { title: string; text: string }[];
};

export const REMOVABLE = ["decision"] as const;
/** Запись, которую прошлая загрузка поставила и которую этот пакет стирает */
export type PackageRemoval = { kind: (typeof REMOVABLE)[number]; key: string };

export type ContentPackage = {
  format: typeof PACKAGE_FORMAT;
  title: string | null;
  createdAt: string | null;
  goals: PackageGoal[];
  tasks: PackageTask[];
  decisions: PackageDecision[];
  links: PackageLink[];
  initiatives: PackageInitiative[];
  remove: PackageRemoval[];
  ceoReports: PackageCeoReport[];
  /** Записи с кадровыми сведениями: в пакете остаются (на них могут ссылаться другие записи), но не загружаются */
  excluded: ExcludedRecord[];
};

/** Ошибка разбора пакета: текст показывается владельцу как есть */
export class PackageError extends Error {}

type Raw = Record<string, unknown>;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const QUARTER = /^\d{4}-Q[1-4]$/;
const KEY = /^[A-Za-z0-9._:-]{3,120}$/;

function isRealDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Текст как его хранит ресурс: та же чистка знаков, что у разбора встречи (тире и стрелки дефисом, точка посередине
 * запятой, без знаков нулевой ширины), пробелы схлопнуты. Текстом считаются только
 * строка и число: список или объект дают пустую строку (String() от глубоко вложенного списка уронил бы разбор)
 */
export function cleanText(value: unknown, keepLines = false): string {
  const s = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const dashed = resourceChars(s);
  if (!keepLines) return dashed.replace(/\s+/g, " ").trim();
  return dashed
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Значение для текста ошибки: строку и число показываем, остальное только видом (без String() от вложенных данных) */
function shown(value: unknown): string {
  if (typeof value === "string") return value.length > 60 ? `${value.slice(0, 59)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return Array.isArray(value) ? "список" : value === null ? "пусто" : "не текст";
}

/** Короткая подпись записи для предпросмотра */
export function shortText(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Кадровые сведения: зарплаты, оценки и судьбы людей в ресурс из пакета не попадают (как личные вкладки бордов лидеров,
// src/lib/goals/leader-board.ts). Жёсткое правило: лучше не загрузить лишнее, чем загрузить кадровое. Ложное срабатывание
// видно в предпросмотре и чинится переформулировкой в пакете, пропуск означает кадровые данные в ресурсе. Поэтому
// страховой смысл снимает правило только у самой связки слов («сбор премии», «страховая премия», «премия по ОСАГО»,
// «ставка КВ», «калибровка оценок убытков»), а не у всего текста: «Премии менеджеров КАСКО: 10% от сбора» кадровое.
//
// Как устроено: связки по словам текста (премия или бонус рядом с людьми или фамилией, оценка и калибровка людей,
// сокращение и оптимизация штата), потом слова и связки, которые кадровые всегда (оклад, ФОТ, увольнение, штатное
// расписание, оффер кандидату). Слово с начала, иначе «доклад» сойдёт за «оклад», а «апгрейд» за «грейд»
const START = "(?:^|[^а-яa-z0-9])";
const HARD = new RegExp(
  `${START}(${[
    "зарплат(?!н[а-я]*\\s+(?:проект|клиент|карт|банк))[а-я]*",
    "заработн[а-я]*\\s+плат[а-я]*",
    "зп(?![а-яa-z0-9])(?!\\s*-?\\s*проект)",
    "з/пл?(?![а-яa-z0-9])",
    "фот(?:а|у|ом|е)?(?![а-яa-z0-9])",
    "фонд[а-я]*\\s+оплаты",
    "оплат[а-я]*\\s+труда",
    "оклад[а-я]*",
    "(?<!(?:инвестиционн|кредитн)[а-я]*\\s)грейд[а-я]*",
    "декрет[а-я]*",
    "отпуск[а-я]*\\s+по\\s+уходу",
    "(?<!(?:выплат|пособи|страхов|покрыти)[а-я]*\\s)на\\s+больничн[а-я]*",
    "больничн[а-я]*\\s+(?:сотрудник|менеджер)[а-я]*",
    "(?:сотрудник|менеджер)[а-я]*\\s+больничн[а-я]*",
    "увол[а-я]*",
    "расста(?:ться|емся|немся|лись|вани)[а-я]*",
    "уход[а-я]*\\s+(?:[а-я]+\\s+){0,2}из\\s+компани[а-я]*",
    "покида[а-я]*\\s+компани[а-я]*",
    "испытательн[а-я]*\\s+срок[а-я]*",
    "кандидат[а-я]*",
    "вилк[а-я]*\\s+(?:для|по|от|на|зарплат|[0-9])",
    "[0-9][0-9 .,]*(?:тыс|к|млн)[а-я.]*\\s+на\\s+руки",
    "гросс(?![а-я])",
    "компенсационн[а-я]*\\s+пакет[а-я]*",
    "штатн(?![а-я]*\\s+(?:режим|ситуац|работ))[а-я]*",
    "численност[а-я]*\\s+(?:сотрудник|персонал|штат|департамент|отдел|команд|кц)[а-я]*",
    "хедкаунт[а-я]*",
    "headcount",
    "fte(?![a-z])",
    "кадров[а-я]*",
    "перформанс[а-я-]*",
    "performance[\\s-]*review",
    "премир(?:ова|у)[а-я]*",
    "премиальн[а-я]*\\s+(?:фонд|выплат|част|пул)[а-я]*",
    "бонусн[а-я]*\\s+(?:фонд|пул|част|выплат)[а-я]*",
    "переменн[а-я]*\\s+част[а-я]*",
    "повы(?:сить|шени|шаем|сили|шать|шу|сим)[а-я]*\\s+(?:[а-яa-z]+\\s+){0,3}?до\\s+(?:руководител|директор|начальник|старш|ведущ|главн|лидер|менеджер)[а-я]*",
    "аттестац(?![а-я]*\\s+(?:информационн|систем|объект|рабоч|агент|по\\s+152))[а-я]*",
    "salary",
    "payroll",
    "zarplat",
    "oklad",
    "uvol",
    "bonus",
    "premi(?:ya|ia|ja|i)(?![a-z])",
  ].join("|")})`,
);

/** Слово текста: как в тексте (фамилия с заглавной) и в нижнем регистре с «е» вместо «ё» */
type Word = { raw: string; low: string };
function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(/[A-Za-zА-Яа-яЁё0-9%][A-Za-zА-Яа-яЁё0-9%/,.-]*/g)) {
    const raw = m[0].replace(/[.,/-]+$/, "");
    if (raw) out.push({ raw, low: raw.toLowerCase().replace(/ё/g, "е") });
  }
  return out;
}

/** Похоже на фамилию: с заглавной и с окончанием русской фамилии в любом падеже (Иванову, Петровой, Мурадяну) */
const SURNAME = /^[А-ЯЁ][а-яё]+(?:(?:ов|ев|ёв|ин|ын)(?:а|у|ым|ом|ой|ою|ую|е|ы|ых|ыми)?|(?:ск|цк)(?:ий|ого|ому|им|ом|ая|ой|ую)|ян(?:а|у|ом|е)?|енко|швили|дзе)$/;
/** Основы фамилий людей ресурса: «Рева» ловится и как «Реве», «Ревой» */
export type Surnames = string[];
function surnameLike(raw: string, names: Surnames): boolean {
  if (!/^[А-ЯЁ]/.test(raw)) return false;
  if (SURNAME.test(raw)) return true;
  const low = raw.toLowerCase().replace(/ё/g, "е");
  return names.some((stem) => low.startsWith(stem) && low.length <= stem.length + 3);
}

/** Основы фамилий из ФИО людей ресурса (фамилия первая): без конечных гласных, не короче трёх букв */
export function surnameStems(fullNames: string[]): Surnames {
  const stems = fullNames.map((n) => (n.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/ё/g, "е").replace(/[аяоеыиуюйь]+$/, "")).filter((s) => s.length >= 3);
  return [...new Set(stems)];
}

/** Слово про людей компании. Не про людей: «лидер рынка», «специалисты Банка России», «оператор связи», «персональные» */
function isPerson(w: Word[], i: number, names: Surnames): boolean {
  const x = w[i]?.low;
  if (!x) return false;
  const next = w[i + 1]?.low ?? "";
  if (["мпп", "кц", "bdm", "люди", "людей", "людям", "людьми"].includes(x)) return true;
  if (/^(?:персональн|командиров|отделени|отдельн|штатн|человеко)/.test(x)) return false;
  if (/^лидер/.test(x) && /^(?:рынк|отрасл|сегмент|мнени)/.test(next)) return false;
  if (/^(?:специалист|аналитик|руководител|директор|эксперт)/.test(x) && /^(?:банк|цб$|регулятор|рынк|компани|ск$|агентств|рейтинг)/.test(next)) return false;
  if (/^оператор/.test(x) && /^(?:связи|фискальн|данных|платеж|сотов)/.test(next)) return false;
  if (/^(?:сотрудник|сотрудниц|менеджер|руководител|аналитик|оператор|специалист|директор|персонал|команд|коллектив|отдел|штат|работник|продавц|лидер|человек)/.test(x)) return true;
  return surnameLike(w[i]!.raw, names);
}

/** Кому: дательный падеж («сотрудникам», «менеджеру», «команде») */
const dative = (x: string) => /(?:ам|ям)$/.test(x) || x === "команде" || /^(?:сотрудник|менеджер|руководител|аналитик|оператор|специалист|директор|работник|лидер)(?:у|ю)$/.test(x);
/** Премия или бонус (не «премиальный», «бонусный», «премиум», «премировать»: у них свои правила) */
const isPay = (x: string) => /^(?:преми(?!альн|ум|ров|ру)|бонус(?!н))/.test(x);
const PRODUCT = /^(?:продукт|полис|осаго|каско|нс$|нсж|ипотек|взр|дмс|страхован|договор|пул|риск|портфел|сегмент|канал)/;
const INSURER = /^(?:ск$|ск-|вск|согаз|ингосстрах|ресо|альфастрах|ренессанс|росгосстрах|сбер|тинькоф|абсолют|согласи|зетта|энергогарант|югори|страховщик|страхов)/;
const AWARD = /^(?:конференц|конкурс|номинац|фестивал|форум|церемони|награжд|лауреат)/;
/** Страховая премия: «сбор премии», «страховая премия», «объём премии», «премия по ОСАГО», «премия ВСК», «премия по полису» */
function insurancePay(w: Word[], i: number): boolean {
  const prev = w[i - 1]?.low ?? "";
  const next = w[i + 1]?.low ?? "";
  const next2 = w[i + 2]?.low ?? "";
  if (/^(?:страхов|сбор|объем|брутто|нетто|начисленн|подписанн|валов|собранн)/.test(prev)) return true;
  if (PRODUCT.test(next) || INSURER.test(next)) return true;
  return /^(?:по|в)$/.test(next) && (PRODUCT.test(next2) || INSURER.test(next2));
}
/** Калибровка оценок с явным предметом: убытков, риска, скоринга, качества лидов, моделей */
const CALIBRATED = /^(?:убыт|риск|скоринг|качеств|лид|модел|тариф|резерв|вероятност|частот|ущерб|стоимост|прогноз|спрос|конверс)/;
const NUMERAL = /^(?:на|в|во|до|из|по|у|с|со|от|\d+(?:[.,]\d+)?%?|один|одна|одного|одну|два|две|двух|двум|двое|двоих|три|трех|трем|трое|троих|четыре|четырех|четверо|четверых|пять|пяти|пятерых|шесть|шести|семь|семи|восемь|восьми|девять|девяти|десять|десяти|несколько|нескольких|оба|обоих|половину|треть|четверть)$/;
/** Ставка не штатная: КВ, комиссия, вознаграждение, тариф, ставка партнёрам и банкам, процентная ставка, «ставка 15%» */
const RATE_OK = /^(?:кв$|комисси|вознагражд|тариф|партн|банк|агент|брокер|страховщ|дилер|площадк|ск$|ипотек|кредит|депозит|вклад|рефинансир|ключев)/;
const percent = (x: string | undefined) => !!x && /^\d+(?:[.,]\d+)?%$/.test(x);
/** Штат: люди и штатные единицы (позиции, должности, вакансии, ставки, численность) */
function isStaff(w: Word[], j: number, names: Surnames): boolean {
  const x = w[j]?.low ?? "";
  const next = w[j + 1]?.low ?? "";
  if (/^(?:ставк|ставок)/.test(x)) {
    if (/^процентн/.test(w[j - 1]?.low ?? "") || RATE_OK.test(next) || percent(next) || (/^(?:до|с|на|в)$/.test(next) && percent(w[j + 2]?.low))) return false;
    return true;
  }
  if (/^позици/.test(x)) return !/^(?:ск$|страхов|компани|банк|выдач|рейтинг|поиск|топ)/.test(next);
  if (/^(?:должност|ваканси|численност|единиц|хедкаунт|fte$|штат(?!н))/.test(x)) return true;
  return isPerson(w, j, names);
}
const phrase = (w: Word[], a: number, b: number) =>
  w
    .slice(a, b + 1)
    .map((x) => x.low)
    .join(" ");

/**
 * Кадровое слово или связка в тексте, иначе null. names: основы фамилий людей ресурса (без них фамилию узнают по
 * окончанию). Сам маркер на экран не идёт: запись подписывается без её текста
 */
export function personnelMarker(text: string | null | undefined, names: Surnames = []): string | null {
  if (!text) return null;
  const w = wordsOf(text);
  for (let i = 0; i < w.length; i++) {
    const x = w[i]!.low;
    // Премия или бонус рядом с людьми или фамилией. Страховая премия только у самой связки; награда на конференции
    // команде (не «сотрудникам») не кадровое
    if (isPay(x) && !insurancePay(w, i)) {
      const award = w.slice(i + 1, i + 7).some((y) => AWARD.test(y.low));
      for (let j = Math.max(0, i - 4); j <= Math.min(w.length - 1, i + 5); j++) {
        if (j !== i && isPerson(w, j, names) && !(award && !dative(w[j]!.low))) return phrase(w, Math.min(i, j), Math.max(i, j));
      }
    }
    // Оценка людей: «оценка эффективности менеджеров», «оценка команды». Не «по оценке аналитиков»
    if (/^(?:оценк|ревью)/.test(x) && w[i - 1]?.low !== "по") {
      for (let j = i + 1; j <= Math.min(w.length - 1, i + 3); j++) if (isPerson(w, j, names)) return phrase(w, i, j);
    }
    // Калибровка оценок (кроме явного предмета: убытков, риска, скоринга), грейдов и людей
    if (/^калибровк/.test(x)) {
      const n = w[i + 1]?.low ?? "";
      if (/^оцен/.test(n) && !CALIBRATED.test(w[i + 2]?.low ?? "")) return phrase(w, i, i + 1);
      if (/^грейд/.test(n) || isPerson(w, i + 1, names)) return phrase(w, i, i + 1);
    }
    // Сокращение и оптимизация штата: «сократить на 2 человека отдел», «сокращение двух ставок», «оптимизация штата»
    if (/^(?:сокращ|сократ|оптимиз|урез|уменьш)/.test(x)) {
      let j = i + 1;
      while (j < w.length && j <= i + 3 && NUMERAL.test(w[j]!.low)) j++;
      if (j < w.length && isStaff(w, j, names)) return phrase(w, i, j);
    }
  }
  const hard = HARD.exec(text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " "));
  return hard ? hard[1]! : null;
}

function validUrl(value: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(value)) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// ---------- Кадровые сведения в записях пакета ----------

/** Поля, которые фильтр не проверяет: ФИО и названия команд (фамилия не кадровое сведение) */
const NOT_CHECKED = new Set(["owner", "coExecutors", "team"]);
const FIELD_LABELS: Record<string, string> = {
  key: "Ключ",
  title: "Название",
  outcome: "Что нужно сделать",
  whereNow: "Где сейчас",
  resolution: "Итог или причина",
  direction: "Направление",
  status: "Статус",
  priority: "Приоритет",
  due: "Срок",
  closedAt: "Дата закрытия",
  "source.kind": "Источник",
  "source.note": "Подробнее об источнике",
  "source.date": "Дата источника",
  "links.title": "Подпись ссылки",
  "links.url": "Адрес ссылки",
  "adopt.title": "Название в ресурсе (adopt)",
  quarter: "Квартал",
  code: "Номер цели",
  description: "Описание",
  metric: "Метрика",
  base: "База",
  target: "Целевое значение",
  link: "Ссылка",
  "parent.key": "Цель выше",
  "parent.code": "Цель выше",
  source: "Откуда цель",
  text: "Решение",
  date: "Дата",
  cancelReason: "Почему отменено",
  "tasks.key": "Задачи решения",
  "task.key": "Задача",
  "goal.key": "Цель",
  "goal.code": "Цель",
  confidence: "Уверенность",
  reason: "Причина связи",
  "blocks.key": "Блок отчёта",
  "blocks.lines.text": "Строка отчёта",
  "blocks.lines.product": "Продукт строки",
  "meetings.title": "Встреча",
  "meetings.text": "Текст о встрече",
  week: "Неделя",
  why: "Зачем",
  note: "Что сейчас происходит",
  result: "Итог",
  state: "Деление шкалы",
};
/** Все строки записи с путём поля, кроме ФИО и команд */
function stringsOf(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v) => stringsOf(v, path));
  if (value && typeof value === "object") {
    return Object.entries(value as Raw).flatMap(([k, v]) => (path === "" && NOT_CHECKED.has(k) ? [] : stringsOf(v, path ? `${path}.${k}` : k)));
  }
  return [];
}
const KIND_LABELS: Record<ExcludedRecord["kind"], string> = { task: "Задача", goal: "Цель", decision: "Решение", link: "Связь", initiative: "Инициатива", ceo: "Weekly для CEO" };

/**
 * Записи пакета с кадровыми сведениями в любой строке (кроме ФИО и названий команд). Запись подписывается без её текста:
 * вид, номер по порядку в пакете и ключ (если в ключе нет кадрового); маркер не показывается. names: основы фамилий
 * людей ресурса, служба импорта передаёт их из базы
 */
export function personnelExclusions(pkg: Pick<ContentPackage, "goals" | "tasks" | "decisions" | "links"> & { initiatives?: PackageInitiative[]; ceoReports?: PackageCeoReport[] }, names: Surnames = []): ExcludedRecord[] {
  const out: ExcludedRecord[] = [];
  const scan = (kind: ExcludedRecord["kind"], records: { key: string }[]) =>
    records.forEach((record, i) => {
      const hit = stringsOf(record).find(([, text]) => personnelMarker(text, names));
      if (!hit) return;
      const keyClean = !personnelMarker(record.key, names);
      const what = `${KIND_LABELS[kind]} ${i + 1} в пакете${keyClean ? ` (ключ ${record.key})` : ""}`;
      out.push({ kind, key: record.key, what, text: `кадровые сведения в поле «${FIELD_LABELS[hit[0]] ?? hit[0]}»: запись не загрузится, уберите их из пакета` });
    });
  scan("goal", pkg.goals);
  scan("task", pkg.tasks);
  scan("decision", pkg.decisions);
  scan("link", pkg.links);
  scan("initiative", pkg.initiatives ?? []);
  scan("ceo", pkg.ceoReports ?? []);
  return out;
}

/** Каноническая запись: ключи по алфавиту. Отпечаток не зависит от порядка полей в файле */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Raw)
        .sort()
        .map((k) => [k, canonical((value as Raw)[k])]),
    );
  }
  return value;
}

export function recordHash(record: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(record))).digest("hex").slice(0, 32);
}

class Reader {
  problems: string[] = [];
  constructor(private where: string) {}

  private add(text: string) {
    this.problems.push(`${this.where}: ${text}`);
  }

  str(raw: Raw, field: string, label: string, max: number, opts: { required?: boolean; lines?: boolean } = {}): string | null {
    const v = raw[field];
    if (v !== undefined && v !== null && typeof v !== "string" && typeof v !== "number") {
      this.add(`«${label}» должно быть текстом`);
      return null;
    }
    const text = cleanText(v, opts.lines);
    if (!text) {
      if (opts.required) this.add(`не заполнено «${label}»`);
      return null;
    }
    if (text.length > max) {
      this.add(`«${label}» длиннее ${max} знаков`);
      return text.slice(0, max);
    }
    return text;
  }

  date(raw: Raw, field: string, label: string, required: boolean): IsoDate | null {
    const v = raw[field];
    if (v === undefined || v === null || v === "") {
      if (required) this.add(`не заполнено «${label}»`);
      return null;
    }
    if (typeof v !== "string" || !isRealDate(v)) {
      this.add(`«${label}» не дата в виде ГГГГ-ММ-ДД`);
      return null;
    }
    return v;
  }

  oneOf<T extends string>(raw: Raw, field: string, label: string, allowed: readonly T[], fallback: T | null): T | null {
    const v = raw[field];
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
      this.add(`«${label}»: «${shown(v)}» не из списка (${allowed.join(", ")})`);
      return fallback;
    }
    return v as T;
  }

  names(raw: Raw, field: string, label: string): string[] {
    const v = raw[field];
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      this.add(`«${label}» должно быть списком ФИО`);
      return [];
    }
    return [...new Set((v as string[]).map((x) => cleanText(x)).filter(Boolean))].slice(0, 10);
  }

  taskRef(v: unknown, label: string): TaskRef | null {
    if (v && typeof v === "object" && "key" in v && typeof (v as Raw).key === "string") return { key: String((v as Raw).key) };
    if (v && typeof v === "object" && "number" in v && Number.isInteger((v as Raw).number) && Number((v as Raw).number) > 0) return { number: Number((v as Raw).number) };
    this.add(`«${label}»: нужна ссылка на задачу { "key": ... } или { "number": ... }`);
    return null;
  }

  goalRef(v: unknown, label: string): GoalRef | null {
    if (v && typeof v === "object" && "key" in v && typeof (v as Raw).key === "string") return { key: String((v as Raw).key) };
    if (v && typeof v === "object" && "code" in v && typeof (v as Raw).code === "string" && cleanText((v as Raw).code)) return { code: cleanText((v as Raw).code) };
    this.add(`«${label}»: нужна ссылка на цель { "key": ... } или { "code": ... }`);
    return null;
  }
}

function list(root: Raw, field: string, problems: string[]): Raw[] {
  const v = root[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    problems.push(`«${field}» должно быть списком`);
    return [];
  }
  if (v.length > PACKAGE_MAX_ITEMS) problems.push(`«${field}»: больше ${PACKAGE_MAX_ITEMS} записей, разделите пакет`);
  return v.slice(0, PACKAGE_MAX_ITEMS).map((x) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Raw) : {}));
}

function keyOf(raw: Raw, r: Reader, label: string, seen: Set<string>, problems: string[]): string {
  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  if (!KEY.test(key)) {
    problems.push(`${label}: ключ «${key}» пустой или с недопустимыми знаками (латиница, цифры, точка, двоеточие, дефис, от 3 до 120)`);
    return key;
  }
  if (seen.has(key)) problems.push(`${label}: ключ «${key}» повторяется в пакете`);
  seen.add(key);
  return key;
}

/**
 * Разбор и проверка пакета. Ошибки собираются все сразу, чтобы владелец увидел их списком. Пакет с ошибками
 * не загружается вовсе: даже предпросмотр показывает только список ошибок
 */
export function parsePackage(text: string, bytes = Buffer.byteLength(text, "utf8")): { pkg: ContentPackage; problems: string[] } {
  if (bytes > PACKAGE_MAX_BYTES) throw new PackageError(`Файл пакета больше ${PACKAGE_MAX_LABEL}: разделите его на части`);
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new PackageError("Это не пакет наполнения: файл не читается как JSON");
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) throw new PackageError("Это не пакет наполнения: нет полей пакета");
  const r0 = root as Raw;
  if (r0.format !== PACKAGE_FORMAT) throw new PackageError(`Это не пакет наполнения: в поле format должно быть «${PACKAGE_FORMAT}»`);
  const problems: string[] = [];

  const goalKeys = new Set<string>();
  const goals: PackageGoal[] = list(r0, "goals", problems).map((raw, i) => {
    const r = new Reader(`цель ${i + 1}${typeof raw.key === "string" ? ` (${raw.key})` : ""}`);
    const key = keyOf(raw, r, `цель ${i + 1}`, goalKeys, problems);
    const quarter = typeof raw.quarter === "string" && QUARTER.test(raw.quarter) ? raw.quarter : null;
    if (!quarter) r.problems.push(`цель ${key}: квартал в виде 2026-Q4`);
    const link = r.str(raw, "link", "Ссылка", 500);
    if (link && !/^https?:\/\//i.test(link)) r.problems.push(`цель ${key}: ссылка должна начинаться с https://`);
    const goal: PackageGoal = {
      key,
      quarter: quarter ?? "",
      team: r.str(raw, "team", "Команда", 120),
      owner: r.str(raw, "owner", "Владелец", 120),
      code: r.str(raw, "code", "Номер цели", 20),
      title: r.str(raw, "title", "Цель", 300, { required: true }) ?? "",
      description: r.str(raw, "description", "Описание", 2000, { lines: true }),
      metric: r.str(raw, "metric", "Метрика", 500),
      base: r.str(raw, "base", "База", 120),
      target: r.str(raw, "target", "Целевое значение", 300),
      link,
      parent: raw.parent === undefined || raw.parent === null ? null : r.goalRef(raw.parent, "Цель выше"),
      replace: raw.replace === true,
      source: r.str(raw, "source", "Откуда цель", 120),
    };
    if (goal.source && !/^(manual|import|leader-board:.+)$/.test(goal.source)) r.problems.push(`цель ${key}: источник цели manual, import или leader-board:<вкладка>`);
    if (!goal.team && !goal.owner) r.problems.push(`цель ${key}: нужна команда или владелец`);
    problems.push(...r.problems);
    return goal;
  });

  const taskKeys = new Set<string>();
  const tasks: PackageTask[] = list(r0, "tasks", problems).map((raw, i) => {
    const r = new Reader(`задача ${i + 1}${typeof raw.key === "string" ? ` (${raw.key})` : ""}`);
    const key = keyOf(raw, r, `задача ${i + 1}`, taskKeys, problems);
    const src = raw.source && typeof raw.source === "object" && !Array.isArray(raw.source) ? (raw.source as Raw) : {};
    if (raw.links !== undefined && raw.links !== null && !Array.isArray(raw.links)) r.problems.push(`задача ${key}: «Ссылки» должны быть списком`);
    const linksRaw = Array.isArray(raw.links) ? (raw.links as unknown[]).slice(0, 10) : [];
    // Те же правила, что у службы задач: подпись до 120 знаков, адрес до 500, только http и https
    const links = linksRaw.flatMap((l, j) => {
      if (!l || typeof l !== "object" || Array.isArray(l)) {
        r.problems.push(`задача ${key}: ссылка ${j + 1} должна быть записью { "url": ... }`);
        return [];
      }
      const title = r.str(l as Raw, "title", "Подпись ссылки", PACKAGE_LINK_TITLE_MAX);
      const url = r.str(l as Raw, "url", "Адрес ссылки", PACKAGE_URL_MAX, { required: true });
      if (!url) return [];
      if (!validUrl(url)) {
        r.problems.push(`задача ${key}: ссылка «${shortText(url)}» не начинается с https://`);
        return [];
      }
      return [{ title, url }];
    });
    const task: PackageTask = {
      key,
      title: r.str(raw, "title", "Задача", 120, { required: true }) ?? "",
      outcome: r.str(raw, "outcome", "Что нужно сделать", 1000, { required: true, lines: true }) ?? "",
      owner: r.str(raw, "owner", "Ответственный", 120, { required: true }) ?? "",
      coExecutors: r.names(raw, "coExecutors", "Соисполнители"),
      direction: r.str(raw, "direction", "Направление", 40, { required: true }) ?? "",
      team: r.str(raw, "team", "Команда", 120),
      due: r.date(raw, "due", "Срок", true) ?? "",
      status: r.oneOf(raw, "status", "Статус", IMPORT_STATUSES, "in-progress") ?? "in-progress",
      closedAt: r.date(raw, "closedAt", "Дата закрытия", false),
      resolution: r.str(raw, "resolution", "Итог или причина", 1000),
      whereNow: r.str(raw, "whereNow", "Где сейчас", 500),
      priority: r.oneOf(raw, "priority", "Приоритет", IMPORT_PRIORITIES, null),
      source: {
        kind: r.oneOf(src, "kind", "Источник", IMPORT_SOURCES, "other") ?? "other",
        note: r.str(src, "note", "Подробнее об источнике", 200),
        date: r.date(src, "date", "Дата источника", false),
      },
      links,
      adopt: null,
    };
    if (raw.adopt !== undefined && raw.adopt !== null) {
      // Без Number() и String() от присланного значения: вложенный список уронил бы разбор
      const a = typeof raw.adopt === "object" && !Array.isArray(raw.adopt) ? (raw.adopt as Raw) : {};
      const n = typeof a.number === "number" && Number.isInteger(a.number) ? a.number : 0;
      const title = typeof a.title === "string" ? cleanText(a.title) : "";
      if (n <= 0 || !title) r.problems.push(`задача ${key}: adopt это { "number": номер в ресурсе, "title": название в ресурсе }`);
      else task.adopt = { number: n, title: title.slice(0, 200) };
    }
    if (["done", "partial", "failed", "cancelled"].includes(task.status) && !task.resolution) {
      r.problems.push(`задача ${key}: для статуса «${task.status}» нужен итог или причина (resolution)`);
    }
    problems.push(...r.problems);
    return task;
  });

  const decisionKeys = new Set<string>();
  const decisions: PackageDecision[] = list(r0, "decisions", problems).map((raw, i) => {
    const r = new Reader(`решение ${i + 1}${typeof raw.key === "string" ? ` (${raw.key})` : ""}`);
    const key = keyOf(raw, r, `решение ${i + 1}`, decisionKeys, problems);
    const refs = Array.isArray(raw.tasks) ? (raw.tasks as unknown[]).slice(0, 20).map((t) => r.taskRef(t, "Задачи решения")).filter((t): t is TaskRef => !!t) : [];
    const status = r.oneOf(raw, "status", "Статус решения", ["active", "cancelled"] as const, "active") ?? "active";
    const decision: PackageDecision = {
      key,
      text: r.str(raw, "text", "Решение", 1000, { required: true }) ?? "",
      date: r.date(raw, "date", "Дата", true) ?? "",
      team: r.str(raw, "team", "Команда", 120),
      owner: r.str(raw, "owner", "Владелец решения", 120),
      tasks: refs,
      status,
      cancelReason: r.str(raw, "cancelReason", "Почему отменено", 300),
    };
    if (status === "cancelled" && !decision.cancelReason) r.problems.push(`решение ${key}: для отменённого решения нужна причина (cancelReason)`);
    problems.push(...r.problems);
    return decision;
  });

  const linkKeys = new Set<string>();
  const links: PackageLink[] = list(r0, "links", problems).map((raw, i) => {
    const r = new Reader(`связь ${i + 1}${typeof raw.key === "string" ? ` (${raw.key})` : ""}`);
    const key = keyOf(raw, r, `связь ${i + 1}`, linkKeys, problems);
    const link: PackageLink = {
      key,
      task: r.taskRef(raw.task, "Задача") ?? { key: "" },
      goal: r.goalRef(raw.goal, "Цель") ?? { key: "" },
      confidence: r.oneOf(raw, "confidence", "Уверенность", CONFIDENCE, null),
      reason: r.str(raw, "reason", "Причина связи", 500),
    };
    problems.push(...r.problems);
    return link;
  });

  const initiativeKeys = new Set<string>();
  const initiatives: PackageInitiative[] = list(r0, "initiatives", problems).map((raw, i) => {
    const r = new Reader(`инициатива ${i + 1}${typeof raw.key === "string" ? ` (${raw.key})` : ""}`);
    const key = keyOf(raw, r, `инициатива ${i + 1}`, initiativeKeys, problems);
    // Пределы те же, что у формы инициативы: название 120, зачем 500, заметка и итог 300
    const item: PackageInitiative = {
      key,
      title: r.str(raw, "title", "Инициатива", 120, { required: true }) ?? "",
      why: r.str(raw, "why", "Зачем", 500),
      direction: r.str(raw, "direction", "Продукт", 40),
      owner: r.str(raw, "owner", "Ответственный", 120, { required: true }) ?? "",
      team: r.str(raw, "team", "Команда", 120),
      goal: raw.goal === undefined || raw.goal === null ? null : r.goalRef(raw.goal, "Цель"),
      state: r.oneOf(raw, "state", "Деление шкалы", INITIATIVE_STATES, "searching") ?? "searching",
      note: r.str(raw, "note", "Что сейчас происходит", 300),
      result: r.str(raw, "result", "Итог", 300),
    };
    if ((item.state === "done" || item.state === "dropped") && !item.result) r.problems.push(`инициатива ${key}: для закрытой инициативы нужен итог (result)`);
    problems.push(...r.problems);
    return item;
  });
  for (const x of initiatives) if (x.goal && "key" in x.goal && !goalKeys.has(x.goal.key)) problems.push(`инициатива ${x.key}: цели с ключом «${x.goal.key}» в пакете нет`);

  const removeSeen = new Set<string>();
  const remove: PackageRemoval[] = list(r0, "remove", problems).flatMap((raw, i) => {
    const kind = raw.kind;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    if (typeof kind !== "string" || !(REMOVABLE as readonly string[]).includes(kind)) {
      problems.push(`удаление ${i + 1}: стереть можно только решения (kind «decision»)`);
      return [];
    }
    if (!KEY.test(key)) {
      problems.push(`удаление ${i + 1}: ключ «${shown(key)}» пустой или с недопустимыми знаками`);
      return [];
    }
    if (removeSeen.has(`${kind}/${key}`)) problems.push(`удаление ${i + 1}: ключ «${key}» повторяется`);
    removeSeen.add(`${kind}/${key}`);
    if (kind === "decision" && decisionKeys.has(key)) problems.push(`удаление ${i + 1}: решение ${key} и загружается, и стирается, оставьте одно`);
    return [{ kind: kind as PackageRemoval["kind"], key }];
  });

  const ceoKeys = new Set<string>();
  const ceoWeeks = new Set<string>();
  const ceoReports: PackageCeoReport[] = list(r0, "ceoReports", problems).map((raw, i) => {
    const r = new Reader(`weekly для CEO ${i + 1}${typeof raw.key === "string" ? ` (${raw.key})` : ""}`);
    const key = keyOf(raw, r, `weekly для CEO ${i + 1}`, ceoKeys, problems);
    const week = r.date(raw, "week", "Неделя", true) ?? "";
    if (week && new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) r.problems.push(`weekly для CEO ${key}: неделя задаётся понедельником`);
    if (week && ceoWeeks.has(week)) r.problems.push(`weekly для CEO ${key}: неделя ${week} уже есть в пакете`);
    ceoWeeks.add(week);
    const blocksRaw = Array.isArray(raw.blocks) ? (raw.blocks as unknown[]).slice(0, 24) : [];
    const blocks = blocksRaw.flatMap((b) => {
      if (!b || typeof b !== "object" || Array.isArray(b) || typeof (b as Raw).key !== "string") return [];
      const linesRaw = Array.isArray((b as Raw).lines) ? ((b as Raw).lines as unknown[]).slice(0, 60) : [];
      const lines = linesRaw.flatMap((l) => {
        if (!l || typeof l !== "object" || Array.isArray(l)) return [];
        const text = r.str(l as Raw, "text", "Строка отчёта", 600);
        return text ? [{ text, product: r.str(l as Raw, "product", "Продукт строки", 40) }] : [];
      });
      return [{ key: String((b as Raw).key).trim(), lines }];
    });
    if (!blocks.some((b) => b.lines.length)) r.problems.push(`weekly для CEO ${key}: в отчёте нет ни одной строки`);
    const meetingsRaw = Array.isArray(raw.meetings) ? (raw.meetings as unknown[]).slice(0, 20) : [];
    const meetings = meetingsRaw.flatMap((m) => {
      if (!m || typeof m !== "object" || Array.isArray(m)) return [];
      const text = r.str(m as Raw, "text", "Текст о встрече", 2000, { lines: true });
      return text ? [{ title: r.str(m as Raw, "title", "Встреча", 120) ?? "", text }] : [];
    });
    problems.push(...r.problems);
    return { key, week, blocks, meetings };
  });

  // Ссылки по ключам должны вести на записи этого же пакета
  for (const g of goals) if (g.parent && "key" in g.parent && !goalKeys.has(g.parent.key)) problems.push(`цель ${g.key}: цели выше с ключом «${g.parent.key}» в пакете нет`);
  for (const d of decisions) for (const t of d.tasks) if ("key" in t && !taskKeys.has(t.key)) problems.push(`решение ${d.key}: задачи с ключом «${t.key}» в пакете нет`);
  for (const l of links) {
    if ("key" in l.task && l.task.key && !taskKeys.has(l.task.key)) problems.push(`связь ${l.key}: задачи с ключом «${l.task.key}» в пакете нет`);
    if ("key" in l.goal && l.goal.key && !goalKeys.has(l.goal.key)) problems.push(`связь ${l.key}: цели с ключом «${l.goal.key}» в пакете нет`);
  }
  // Одну задачу ресурса подхватывает одна запись пакета
  const adopted = new Map<number, string>();
  for (const t of tasks) {
    if (!t.adopt) continue;
    const was = adopted.get(t.adopt.number);
    if (was) problems.push(`задачи ${was} и ${t.key}: обе подхватывают задачу ${t.adopt.number}, оставьте одну`);
    else adopted.set(t.adopt.number, t.key);
  }
  // Одна задача работает на одну цель: две связи одной задачи в пакете противоречат друг другу. Задача, которую запись
  // пакета подхватывает, та же, что и по её номеру
  const adoptOf = new Map(tasks.filter((t) => t.adopt).map((t) => [t.key, t.adopt!.number]));
  const linked = new Map<string, string>();
  for (const l of links) {
    const t = "key" in l.task ? (adoptOf.has(l.task.key) ? `number:${adoptOf.get(l.task.key)}` : `key:${l.task.key}`) : `number:${l.task.number}`;
    const was = linked.get(t);
    if (was) problems.push(`связи ${was} и ${l.key}: одна задача привязана к двум целям, оставьте одну`);
    else linked.set(t, l.key);
  }

  const head = new Reader("пакет");
  const title = head.str(r0, "title", "Название пакета", PACKAGE_TITLE_MAX);
  const createdAt = head.str(r0, "createdAt", "Дата сборки пакета", 40);
  // Название и дата пакета пишутся в журнал: кадровых сведений в них быть не должно (без маркера, только поле)
  for (const [label, value] of [["Название пакета", title], ["Дата сборки пакета", createdAt]] as const) {
    if (personnelMarker(value)) head.problems.push(`пакет: кадровые сведения в поле «${label}», уберите их из пакета`);
  }
  problems.unshift(...head.problems);

  const pkg: ContentPackage = { format: PACKAGE_FORMAT, title, createdAt, goals, tasks, decisions, links, initiatives, remove, ceoReports, excluded: [] };
  pkg.excluded = personnelExclusions(pkg);
  return { pkg, problems };
}
