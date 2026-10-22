// Пакет наполнения (этап 67): задачи, решения, цели и связи задач с целями, которые собраны из истории проекта и
// проверены владельцем. Здесь только разбор и проверка файла, без базы: что в нём должно быть и в каком виде.
// Пакет хранится вне репозитория (в нём внутренние имена и цифры), в базу попадают только записи и их ключи.
//
// У каждой записи стабильный внешний ключ: по нему повторная загрузка находит то, что уже загружено, и ничего не
// дублирует. Ссылки внутри пакета идут по ключам: задача решения { key }, цель связи { key } или уже существующая
// в ресурсе задача { number } и цель { code }.

import { createHash } from "node:crypto";
import type { IsoDate } from "@/domain/dates";

import { PACKAGE_FORMAT, PACKAGE_MAX_BYTES, PACKAGE_MAX_ITEMS } from "./limits";

export { PACKAGE_FORMAT, PACKAGE_MAX_BYTES, PACKAGE_MAX_ITEMS };

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
  /** Итог или причина: обязательны для закрытых статусов */
  resolution: string | null;
  whereNow: string | null;
  priority: (typeof IMPORT_PRIORITIES)[number] | null;
  source: { kind: (typeof IMPORT_SOURCES)[number]; note: string | null; date: IsoDate | null };
  links: { title: string | null; url: string }[];
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

export type ContentPackage = {
  format: typeof PACKAGE_FORMAT;
  title: string | null;
  createdAt: string | null;
  goals: PackageGoal[];
  tasks: PackageTask[];
  decisions: PackageDecision[];
  links: PackageLink[];
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

/** Текст как его хранит ресурс: длинное тире и стрелки заменены дефисом, пробелы схлопнуты */
export function cleanText(value: unknown, keepLines = false): string {
  const s = typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
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
      this.add(`«${label}»: «${String(v)}» не из списка (${allowed.join(", ")})`);
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
  if (bytes > PACKAGE_MAX_BYTES) throw new PackageError("Файл пакета больше 2 МБ: разделите его на части");
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
    };
    if (!goal.team && !goal.owner) r.problems.push(`цель ${key}: нужна команда или владелец`);
    problems.push(...r.problems);
    return goal;
  });

  const taskKeys = new Set<string>();
  const tasks: PackageTask[] = list(r0, "tasks", problems).map((raw, i) => {
    const r = new Reader(`задача ${i + 1}${typeof raw.key === "string" ? ` (${raw.key})` : ""}`);
    const key = keyOf(raw, r, `задача ${i + 1}`, taskKeys, problems);
    const src = raw.source && typeof raw.source === "object" && !Array.isArray(raw.source) ? (raw.source as Raw) : {};
    const linksRaw = Array.isArray(raw.links) ? (raw.links as unknown[]).slice(0, 10) : [];
    const links = linksRaw
      .map((l) => (l && typeof l === "object" ? (l as Raw) : {}))
      .map((l) => ({ title: cleanText(l.title) || null, url: cleanText(l.url) }))
      .filter((l) => {
        if (/^https?:\/\/\S+$/i.test(l.url)) return true;
        r.problems.push(`задача ${key}: ссылка «${l.url}» не начинается с https://`);
        return false;
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
      resolution: r.str(raw, "resolution", "Итог или причина", 1000),
      whereNow: r.str(raw, "whereNow", "Где сейчас", 500),
      priority: r.oneOf(raw, "priority", "Приоритет", IMPORT_PRIORITIES, null),
      source: {
        kind: r.oneOf(src, "kind", "Источник", IMPORT_SOURCES, "other") ?? "other",
        note: r.str(src, "note", "Подробнее об источнике", 200),
        date: r.date(src, "date", "Дата источника", false),
      },
      links,
    };
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

  // Ссылки по ключам должны вести на записи этого же пакета
  for (const g of goals) if (g.parent && "key" in g.parent && !goalKeys.has(g.parent.key)) problems.push(`цель ${g.key}: цели выше с ключом «${g.parent.key}» в пакете нет`);
  for (const d of decisions) for (const t of d.tasks) if ("key" in t && !taskKeys.has(t.key)) problems.push(`решение ${d.key}: задачи с ключом «${t.key}» в пакете нет`);
  for (const l of links) {
    if ("key" in l.task && l.task.key && !taskKeys.has(l.task.key)) problems.push(`связь ${l.key}: задачи с ключом «${l.task.key}» в пакете нет`);
    if ("key" in l.goal && l.goal.key && !goalKeys.has(l.goal.key)) problems.push(`связь ${l.key}: цели с ключом «${l.goal.key}» в пакете нет`);
  }
  // Одна задача работает на одну цель: две связи одной задачи в пакете противоречат друг другу
  const linked = new Map<string, string>();
  for (const l of links) {
    const t = "key" in l.task ? `key:${l.task.key}` : `number:${l.task.number}`;
    const was = linked.get(t);
    if (was) problems.push(`связи ${was} и ${l.key}: одна задача привязана к двум целям, оставьте одну`);
    else linked.set(t, l.key);
  }

  return {
    pkg: {
      format: PACKAGE_FORMAT,
      title: cleanText(r0.title) || null,
      createdAt: cleanText(r0.createdAt) || null,
      goals,
      tasks,
      decisions,
      links,
    },
    problems,
  };
}
