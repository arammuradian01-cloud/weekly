// Разбор встречи из Notion (этап 61): что получается из текста встречи и как это проверяется. Чистые функции без базы:
// их считают и сервер, и экран (предпросмотр отчёта CEO), и модульные тесты.
//
// Текст встречи разбирает Claude по API или запасные правила. И тот и другой отдают «сырой» разбор (RawMeeting): имена
// людей как сказано на встрече, сроки как в тексте. Сервер сопоставляет имена с людьми компании и превращает сырой разбор
// в черновики (ParseResult), которые ведущий правит перед отправкой CEO и созданием задач.

import { addDays, type IsoDate } from "@/domain/dates";
import { sameStem, tokens } from "@/lib/goals/match";
import { BLOCK_LIMITS, DEFAULT_PRODUCTS, DRAFT_TEMPLATE, emptyBlocks, legacyToBlocks, productOfText, uniqueLines, type BlockLine, type ProductRef, type ReportBlock } from "@/lib/weekly-blocks/types";

/** Пределы разбора: что длиннее, обрезается, что сверх количества, отбрасывается */
export const PARSE_LIMITS = {
  /** Текст страницы, который уходит в разбор и хранится в базе */
  pageText: 60_000,
  listItems: 12,
  decisions: 30,
  tasks: 50,
  item: 500,
  section: 4000,
  title: 120,
  outcome: 1000,
  name: 120,
  coExecutors: 5,
  dueText: 100,
} as const;

export type RawTask = {
  title: string;
  outcome: string;
  /** Ответственный как сказано на встрече */
  owner: string | null;
  coExecutors: string[];
  /** Срок ГГГГ-ММ-ДД, если назван или понятен из текста */
  due: IsoDate | null;
  /** Срок словами из текста: «до пятницы», «к 25.10» */
  dueText: string | null;
  /** Код направления из справочника, если понятен */
  direction: string | null;
};

export type RawMeeting = {
  summary: string[];
  decisions: { text: string; owner: string | null }[];
  risks: string[];
  next: string[];
  /** Черновик weekly для CEO по смысловым блокам (этап 66). null: собрать из итогов */
  ceo: ReportBlock[] | null;
  tasks: RawTask[];
};

/** Черновик задачи на экране разбора */
export type ParseTaskDraft = {
  key: string;
  /** Создавать ли задачу: лишние ведущий снимает */
  on: boolean;
  title: string;
  outcome: string;
  /** Имя из текста встречи: показываем рядом с выбором, если человек не распознан */
  ownerText: string;
  /** Короткое имя человека компании. null: не распознан, строка требует выбора */
  owner: string | null;
  coText: string[];
  coExecutors: string[];
  due: IsoDate;
  dueText: string | null;
  /** Срок не назван на встрече: подставлен через неделю, его стоит проверить */
  dueGuessed: boolean;
  direction: string;
  /** auto: цель по тексту (этап 55), та же, что получит задача; none: без цели */
  goalMode: "auto" | "none";
  goal: string | null;
  goalTitle: string | null;
  /** Похожая задача уже создана из прошлого разбора этой встречи: строка снята, номер показан */
  existing?: number | null;
};

/** Решение встречи: в журнал решений записываются только отмеченные, текст можно поправить */
export type ParseDecision = { key?: string; on?: boolean; text: string; ownerText: string | null; owner: string | null };

export type ParseResult = {
  summary: string[];
  decisions: ParseDecision[];
  risks: string[];
  next: string[];
  /** Черновик weekly для CEO по смысловым блокам отчёта CEO (этап 66) */
  ceo: ReportBlock[];
  tasks: ParseTaskDraft[];
  /** Блоки страницы, которые Notion API не отдал текстом */
  unreadable?: number;
};

export const EMPTY_RESULT: ParseResult = { summary: [], decisions: [], risks: [], next: [], ceo: [], tasks: [] };

const titleNorm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();

/**
 * Та же задача: одинаковое название без учёта регистра и знаков или почти те же слова (основы слов, сходство от 0,8),
 * и тот же ответственный. Так повторный разбор той же страницы не ставит задачу второй раз
 */
export function sameTask(a: { title: string; owner: string | null }, b: { title: string; owner: string | null }): boolean {
  if (!a.owner || a.owner !== b.owner) return false;
  const x = titleNorm(a.title);
  const y = titleNorm(b.title);
  if (!x || !y) return false;
  if (x === y) return true;
  const tx = new Set(tokens(a.title));
  const ty = new Set(tokens(b.title));
  if (tx.size < 2 || ty.size < 2) return false;
  const common = [...tx].filter((t) => [...ty].some((u) => sameStem(t, u))).length;
  return common / Math.max(tx.size, ty.size) >= 0.8;
}

/**
 * Текст для ресурса: длинное тире и стрелки становятся дефисом, точка посередине запятой, пробелы схлопнуты.
 * Так пишет Арам, и так модель не протащит на экран символы, которых в ресурсе нет
 */
export function cleanText(value: string, max: number = PARSE_LIMITS.item): string {
  return value
    .replace(/[\u2014\u2013\u2012\u2015]/g, "-")
    .replace(/\s*[\u2192\u27f6\u21d2\u279d\u2794\u27f9]\s*/g, " - ")
    .replace(/\s*\u00b7\s*/g, ", ")
    .replace(/[\u200b\u00ad]/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Многострочный раздел: строки чистятся по отдельности, пустые подряд схлопываются */
export function cleanSection(value: string, max: number = PARSE_LIMITS.section): string {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => cleanText(l, max))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** Название задачи не длиннее 120 знаков: режем по слову, без обрывка слова в конце */
export function taskTitle(text: string): string {
  const value = cleanText(text, 1000).replace(/[.;,:\s]+$/, "");
  if (value.length <= PARSE_LIMITS.title) return value;
  const cut = value.slice(0, PARSE_LIMITS.title);
  const space = cut.lastIndexOf(" ");
  return (space > 60 ? cut.slice(0, space) : cut).replace(/[.;,:\s-]+$/, "");
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? cleanText(v, max) : "");
const strOrNull = (v: unknown, max: number): string | null => str(v, max) || null;

function stringList(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x, PARSE_LIMITS.item))
    .filter(Boolean)
    .slice(0, limit);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function isoOrNull(v: unknown): IsoDate | null {
  if (typeof v !== "string" || !ISO.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

export type Checked<T> = { ok: true; value: T; skipped: number } | { ok: false; error: string };

/**
 * Проверка ответа модели. Верхний уровень строгий: не тот вид ответа значит, что разбор модели не принимаем и разбираем
 * правилами. Отдельные строки без нужных полей отбрасываются (skipped), остальное чистится и обрезается по пределам
 */
export function validateRawMeeting(input: unknown, products: readonly ProductRef[] = DEFAULT_PRODUCTS): Checked<RawMeeting> {
  if (!isObj(input)) return { ok: false, error: "ответ не объект" };
  for (const key of ["summary", "decisions", "risks", "next", "tasks"] as const) {
    if (!Array.isArray(input[key])) return { ok: false, error: `нет списка ${key}` };
  }
  let skipped = 0;
  const decisions: RawMeeting["decisions"] = [];
  for (const d of input.decisions as unknown[]) {
    const text = isObj(d) ? str(d.text, PARSE_LIMITS.item) : typeof d === "string" ? str(d, PARSE_LIMITS.item) : "";
    if (!text) {
      skipped++;
      continue;
    }
    decisions.push({ text, owner: isObj(d) ? strOrNull(d.owner, PARSE_LIMITS.name) : null });
  }
  const tasks: RawTask[] = [];
  for (const t of input.tasks as unknown[]) {
    if (!isObj(t) || !str(t.title, 1000)) {
      skipped++;
      continue;
    }
    const title = taskTitle(str(t.title, 1000));
    const outcome = str(t.outcome, PARSE_LIMITS.outcome);
    tasks.push({
      title,
      outcome: outcome || title,
      owner: strOrNull(t.owner, PARSE_LIMITS.name),
      coExecutors: Array.isArray(t.coExecutors) ? stringList(t.coExecutors, PARSE_LIMITS.coExecutors).map((n) => n.slice(0, PARSE_LIMITS.name)) : [],
      due: isoOrNull(t.due),
      dueText: strOrNull(t.dueText, PARSE_LIMITS.dueText),
      direction: strOrNull(t.direction, 40),
    });
  }
  let ceo: ReportBlock[] | null = null;
  if (input.ceo !== undefined && input.ceo !== null) {
    if (!isObj(input.ceo)) return { ok: false, error: "раздел ceo не объект" };
    const c = input.ceo;
    // Прежний вид ответа (главное, риски, что дальше строками) раскладывается по блокам тем же правилом, что старый отчёт
    const legacy = ["main", "risks", "next"].some((k) => typeof c[k] === "string") && !DRAFT_TEMPLATE.some((t) => Array.isArray(c[t.key]));
    ceo = legacy
      ? legacyToBlocks({ main: bullets(typeof c.main === "string" ? c.main : ""), risks: bullets(typeof c.risks === "string" ? c.risks : ""), next: bullets(typeof c.next === "string" ? c.next : "") }, products, DRAFT_TEMPLATE)
      : DRAFT_TEMPLATE.map((t) => ({ key: t.key, title: t.title, hidden: false, note: null, lines: draftLines(c[t.key], t.key, products) }));
    if (!ceo.some((b) => b.lines.length)) ceo = null;
  }
  return {
    ok: true,
    skipped,
    value: {
      summary: stringList(input.summary, PARSE_LIMITS.listItems),
      decisions: decisions.slice(0, PARSE_LIMITS.decisions),
      risks: stringList(input.risks, PARSE_LIMITS.listItems),
      next: stringList(input.next, PARSE_LIMITS.listItems),
      ceo,
      tasks: tasks.slice(0, PARSE_LIMITS.tasks),
    },
  };
}

/** Раздел отчёта CEO строками «- текст»: так их легко дописывать и сравнивать */
export function bullets(text: string): string {
  return cleanSection(text)
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•◦▪]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((l) => `- ${l}`)
    .join("\n");
}

/** Строки блока из ответа модели: продукт из списка направлений или по тексту строки, текст чистый и короткий */
function draftLines(value: unknown, key: string, products: readonly ProductRef[]): BlockLine[] {
  if (!Array.isArray(value)) return [];
  const known = new Set(products.map((p) => p.code));
  const fallback = known.has("department") ? "department" : null;
  const out: BlockLine[] = [];
  for (const raw of value) {
    const text0 = typeof raw === "string" ? raw : isObj(raw) && typeof raw.text === "string" ? raw.text : "";
    const text = cleanText(text0.replace(/^\s*[-*•]\s*/, ""), PARSE_LIMITS.item);
    if (!text) continue;
    const given = isObj(raw) && typeof raw.product === "string" && known.has(raw.product.trim()) ? raw.product.trim() : null;
    const found = given ? { product: given, rest: text } : productOfText(text, products);
    out.push({ product: found.product ?? (key === "partners" && known.has("partners") ? "partners" : fallback), text: cleanText(found.rest || text, PARSE_LIMITS.item), href: null, source: null });
    if (out.length >= PARSE_LIMITS.listItems) break;
  }
  return uniqueLines(out);
}

/** Строка раздела заметки, уже привязанная к блоку отчёта: разбор правилами нашёл её под заголовком «Новости», «ОСАГО» */
export type TaggedLine = { key: "news" | "competitors" | "partners" | "products"; product: string | null; text: string };

/**
 * Черновик weekly для CEO по блокам из итогов встречи: строки разделов «Новости», «Конкуренты», продуктов и партнёров в
 * свои блоки; итоги и решения по продукту строки (партнёрка в «Партнёрский канал», без продукта в новости команды),
 * риски в «Риски», что дальше (а без него задачи встречи) в «План на неделю». Строка без продукта подписана департаментом
 */
export function buildDraft(raw: Omit<RawMeeting, "ceo">, products: readonly ProductRef[] = DEFAULT_PRODUCTS, tagged: readonly TaggedLine[] = []): ReportBlock[] {
  const blocks = emptyBlocks(DRAFT_TEMPLATE);
  const known = new Set(products.map((p) => p.code));
  const fallback = known.has("department") ? "department" : null;
  const push = (key: string, product: string | null, text: string) => {
    const b = blocks.find((x) => x.key === key);
    const t = cleanText(text, PARSE_LIMITS.item);
    if (b && t && b.lines.length < BLOCK_LIMITS.lines) b.lines.push({ product: product && known.has(product) ? product : fallback, text: t, href: null, source: null });
  };
  const route = (text: string, prefix = "") => {
    const { product, rest } = productOfText(text, products);
    push(product === "partners" ? "partners" : product ? "products" : "news", product, `${prefix}${rest || text}`);
  };
  for (const t of tagged) {
    const found = productOfText(t.text, products);
    const product = t.product ?? found.product ?? (t.key === "partners" ? "partners" : null);
    const key = t.key === "products" && product === "partners" ? "partners" : t.key;
    push(key, product, t.product ? t.text : found.rest || t.text);
  }
  const taggedTexts = new Set(tagged.map((t) => cleanText(t.text)));
  for (const s of raw.summary) if (!taggedTexts.has(cleanText(s))) route(s);
  for (const d of raw.decisions) route(d.text, "Решили: ");
  for (const r of raw.risks) push("risks", productOfText(r, products).product, r);
  const nextItems = raw.next.length ? raw.next : raw.tasks.slice(0, 7).map((t) => t.title);
  for (const n of nextItems) push("plan", productOfText(n, products).product, n);
  return blocks.map((b) => ({ ...b, lines: uniqueLines(b.lines) }));
}

/** Черновик weekly для CEO: от модели или разбора правилами по разделам, если они его дали, иначе из итогов встречи */
export function ceoDraftOf(raw: RawMeeting, products: readonly ProductRef[] = DEFAULT_PRODUCTS): ReportBlock[] {
  if (!raw.ceo) return buildDraft(raw, products);
  // Все блоки черновика по порядку, даже пустые: ведущий видит, куда можно дописать
  return DRAFT_TEMPLATE.map((t) => raw.ceo!.find((b) => b.key === t.key) ?? { key: t.key, title: t.title, hidden: false, note: null, lines: [] });
}

// ---------- Сроки из текста ----------

const WEEKDAYS: Record<string, number> = {
  понедельник: 1, понедельника: 1, понедельнику: 1,
  вторник: 2, вторника: 2, вторнику: 2,
  среда: 3, среды: 3, среду: 3, среде: 3,
  четверг: 4, четверга: 4, четвергу: 4,
  пятница: 5, пятницы: 5, пятницу: 5, пятнице: 5,
  суббота: 6, субботы: 6, субботу: 6,
  воскресенье: 7, воскресенья: 7,
};

const weekday = (iso: IsoDate) => new Date(`${iso}T00:00:00Z`).getUTCDay() || 7;

/** Срок словами: «до 25.10», «к 25.10.2026», «срок: 25.10», «до пятницы», «до конца недели». Остальное не угадываем */
export const DUE_PATTERN =
  /(?:^|[\s,(])((?:до|к|ко|(?:срок|дедлайн)(?:\s*[:-])?(?:\s+(?:до|к))?|не позднее)\s+(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?|(?:до|к|ко)\s+(понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|понедельнику|вторнику|среде|четвергу|пятнице|субботе)|(?:до|к)\s+конц[ау]\s+(недели|месяца))(?=$|[\s,.;)])/i;

/**
 * Дата срока из текста относительно даты встречи. «до 25.10» без года: ближайшее 25.10 не раньше чем за два месяца до
 * встречи, иначе следующего года. День недели: ближайший после встречи
 */
export function dueFromText(text: string, base: IsoDate): { due: IsoDate | null; dueText: string | null } {
  const m = DUE_PATTERN.exec(text);
  if (!m) return { due: null, dueText: null };
  const dueText = m[1]!.trim();
  if (m[2]) {
    const day = Number(m[2]);
    const month = Number(m[3]);
    let year = m[4] ? Number(m[4].length === 2 ? `20${m[4]}` : m[4]) : Number(base.slice(0, 4));
    const make = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let iso = make(year);
    if (!isoOrNull(iso)) return { due: null, dueText };
    if (!m[4] && iso < addDays(base, -60)) {
      year += 1;
      iso = make(year);
    }
    return { due: isoOrNull(iso), dueText };
  }
  if (m[5]) {
    const want = WEEKDAYS[m[5].toLowerCase()]!;
    const from = weekday(base);
    const days = ((want - from + 7) % 7) || 7;
    return { due: addDays(base, days), dueText };
  }
  if (m[6]) {
    if (m[6].toLowerCase() === "недели") {
      const from = weekday(base);
      return { due: addDays(base, from <= 5 ? 5 - from : 12 - from), dueText };
    }
    const [y, mo] = base.split("-").map(Number);
    const last = new Date(Date.UTC(y!, mo!, 0)).toISOString().slice(0, 10);
    return { due: last, dueText };
  }
  return { due: null, dueText };
}

/** Срок по умолчанию: через неделю после встречи, но не в прошлом, если разбирают позже (как в приёме из Notion этапа 23) */
export function defaultDue(meetingDate: IsoDate, today: IsoDate): IsoDate {
  const week = addDays(meetingDate, 7);
  return week > today ? week : addDays(today, 7);
}

/** Подпись статуса разбора для экрана и журнала */
export function parseStatusLabel(p: { status: "pending" | "ready" | "failed"; stale?: boolean; ceoSentAt?: string | null; tasksCreatedAt?: string | null }): string {
  if (p.status === "pending") return p.stale ? "Завис" : "Разбираем";
  if (p.status === "failed") return "Не разобрано";
  if (p.ceoSentAt && p.tasksCreatedAt) return "Отправлено CEO, задачи созданы";
  if (p.ceoSentAt) return "Отправлено CEO";
  if (p.tasksCreatedAt) return "Задачи созданы";
  return "Черновик";
}
