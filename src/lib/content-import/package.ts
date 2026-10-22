// Пакет наполнения (этап 67): задачи, решения, цели и связи задач с целями, которые собраны из истории проекта и
// проверены владельцем. Здесь только разбор и проверка файла, без базы: что в нём должно быть и в каком виде.
// Пакет хранится вне репозитория (в нём внутренние имена и цифры), в базу попадают только записи и их ключи.
//
// У каждой записи стабильный внешний ключ: по нему повторная загрузка находит то, что уже загружено, и ничего не
// дублирует. Ссылки внутри пакета идут по ключам: задача решения { key }, цель связи { key } или уже существующая
// в ресурсе задача { number } и цель { code }.

import { createHash } from "node:crypto";
import type { IsoDate } from "@/domain/dates";

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

/** Запись пакета, которая не загрузится, пока её не исправят в файле: например, в ней кадровые сведения */
export type ExcludedRecord = { kind: "task" | "decision" | "goal"; key: string; what: string; text: string };

export type ContentPackage = {
  format: typeof PACKAGE_FORMAT;
  title: string | null;
  createdAt: string | null;
  goals: PackageGoal[];
  tasks: PackageTask[];
  decisions: PackageDecision[];
  links: PackageLink[];
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
 * Текст как его хранит ресурс: длинное тире и стрелки заменены дефисом, пробелы схлопнуты. Текстом считаются только
 * строка и число: список или объект дают пустую строку (String() от глубоко вложенного списка уронил бы разбор)
 */
export function cleanText(value: unknown, keepLines = false): string {
  const s = typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  const dashed = s.replace(/[—–]/g, "-").replace(/\s*[→⟶⇒]\s*/g, " - ");
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
// src/lib/goals/leader-board.ts). Слово с начала, иначе «доклад» сойдёт за «оклад», а «апгрейд» за «грейд». Страховые и
// банковские термины не повод: голая или «годовая» премия (страховая премия), зарплатный проект, клиент и карта,
// выплата по больничному (продукт НС), калибровка оценок риска и скоринга, сокращение сроков и расходов. Поэтому
// больничный, сокращение, премия и бонус считаются кадровыми только рядом с людьми
const START = "(?:^|[^а-яa-z0-9])";
const NUMERAL = "(?:[0-9]+|дв(?:а|е|ух|ум|ое)|тр(?:и|ех|ем|ое)|четыр(?:е|ех)|пят(?:ь|и|ерых)|нескольк(?:о|их)|одн(?:ого|у|а)|в|на|из)";
const PEOPLE = "(?:штат|отдел|команд|ставк|менеджер|человек|сотрудник|персонал)";
const PERSONNEL = new RegExp(
  `${START}(${[
    "зарплат(?!н[а-я]*\\s+(?:проект|клиент|карт))[а-я]*",
    "заработн[а-я]*\\s+плат[а-я]*",
    "зп(?![а-яa-z0-9])",
    "з/п(?![а-яa-z0-9])",
    "фот(?![а-яa-z0-9])",
    "фонд[а-я]*\\s+оплаты",
    "оплат[а-я]*\\s+труда",
    "оклад[а-я]*",
    "грейд[а-я]*",
    "калибровк[а-я]*\\s+(?:оцен[а-я]*(?![а-я])(?!\\s+(?:риск|скоринг))|грейд[а-я]*|сотрудник[а-я]*|персонал[а-я]*)",
    "декрет[а-я]*",
    "на\\s+больничн[а-я]*",
    "больничн[а-я]*\\s+(?:сотрудник|менеджер)[а-я]*",
    "(?:сотрудник|менеджер)[а-я]*\\s+больничн[а-я]*",
    "увол[а-я]*",
    `(?:сокращ|сократ)[а-я]*\\s+(?:${NUMERAL}\\s+)?${PEOPLE}[а-я]*`,
    "оценк[а-я]*\\s+(?:эффективност[а-я]*\\s+)?(?:сотрудник|персонал)[а-я]*",
    "аттестац[а-я]*",
    "(?:преми|бонус)[а-я]*\\s+(?:сотрудник|менеджер|команд)[а-я]*",
    "salary",
  ].join("|")})`,
);

/** Кадровое слово в тексте или null */
export function personnelMarker(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = PERSONNEL.exec(text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " "));
  return m ? m[1]! : null;
}

function personnelHit(fields: [string, string | null][]): string | null {
  for (const [label, text] of fields) {
    const marker = personnelMarker(text);
    if (marker) return `кадровые сведения («${marker}» в поле «${label}»): такие записи в ресурс не загружаются, уберите их из пакета`;
  }
  return null;
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
  const excluded: ExcludedRecord[] = [];

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
    const hr = personnelHit([
      ["Цель", goal.title],
      ["Описание", goal.description],
      ["Метрика", goal.metric],
      ["Целевое значение", goal.target],
    ]);
    if (hr) excluded.push({ kind: "goal", key, what: `Цель «${shortText(goal.title)}»`, text: hr });
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
    const hr = personnelHit([
      ["Задача", task.title],
      ["Что нужно сделать", task.outcome],
      ["Где сейчас", task.whereNow],
      ["Итог или причина", task.resolution],
      ["Подробнее об источнике", task.source.note],
      ...task.links.map((l): [string, string | null] => ["Подпись ссылки", l.title]),
    ]);
    if (hr) excluded.push({ kind: "task", key, what: `Задача «${shortText(task.title)}»`, text: hr });
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
    const hr = personnelHit([
      ["Решение", decision.text],
      ["Почему отменено", decision.cancelReason],
    ]);
    if (hr) excluded.push({ kind: "decision", key, what: `Решение «${shortText(decision.text)}»`, text: hr });
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
  problems.unshift(...head.problems);

  return {
    pkg: { format: PACKAGE_FORMAT, title, createdAt, goals, tasks, decisions, links, excluded },
    problems,
  };
}
