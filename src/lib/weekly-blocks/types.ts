// Weekly по смысловым блокам (этап 66). Решение Арама 22.10: из weekly для CEO должно быть понятно, о каком продукте
// речь. Отчёт делится на смысловые блоки в постоянном порядке: новости рынка и команды, неделя к неделе, месяц (к
// прошлому году, к прошлому месяцу, план продаж), конкуренты, продукты (подраздел на каждый продукт), партнёрский канал,
// риски, план на неделю. Каждая строка подписана продуктом, у цифр ссылка на источник. Те же блоки руководитель задаёт
// weekly своей команды.
//
// Чистые функции без базы: их считают сервер, экраны (редактор и предпросмотр) и модульные тесты.

export type StandardBlockKey = "news" | "wow" | "month" | "competitors" | "products" | "partners" | "risks" | "plan";

export type StandardBlock = { key: StandardBlockKey; title: string; hint: string };

/** Стандартный набор блоков в порядке отчёта CEO */
export const STANDARD_BLOCKS: readonly StandardBlock[] = [
  { key: "news", title: "Новости рынка и команды", hint: "Главные новости рынка за неделю и новости команды" },
  { key: "wow", title: "Неделя к неделе", hint: "Цифры недели: как растём или падаем к прошлой неделе" },
  { key: "month", title: "Месяц: к прошлому году, к прошлому месяцу, план продаж", hint: "Прогноз месяца против бюджета, прошлого месяца и прошлого года" },
  { key: "competitors", title: "Конкуренты", hint: "Новости по конкурентам за неделю. Нет новостей: блок скрыт" },
  { key: "products", title: "Продукты", hint: "Подраздел на каждый продукт: что сделали и что изменилось" },
  { key: "partners", title: "Партнёрский канал", hint: "Партнёры и их цифры" },
  { key: "risks", title: "Риски", hint: "Что мешает: риски задач, целей и записей weekly" },
  { key: "plan", title: "План на неделю", hint: "Задачи со сроком на следующей неделе и что планируем" },
];

export const STANDARD_KEYS: readonly StandardBlockKey[] = STANDARD_BLOCKS.map((b) => b.key);

/** Строка блока: продукт, текст и ссылка на источник (раздел «Прогноз», хаб, новость, артефакт записи, задача) */
export type BlockLine = {
  /** Код направления из справочника: строка подписана продуктом. null: общая строка без продукта */
  product: string | null;
  text: string;
  href: string | null;
  /** Подпись ссылки: «Прогноз, октябрь», «Хаб: ОСАГО по СК», название источника новости */
  source: string | null;
};

export type ReportBlock = {
  key: string;
  title: string;
  /** Скрытый блок не попадает ни в отправленный отчёт, ни в текст для копирования */
  hidden: boolean;
  lines: BlockLine[];
  /** Пояснение под заголовком: «нет данных», откуда собрано */
  note: string | null;
};

/** Блок шаблона weekly команды: стандартный или свой (ключ c:...) */
export type TemplateBlock = { key: string; title: string };

/** Подписи продуктов: код направления и название */
export type Labels = Record<string, string>;
export type ProductRef = { code: string; label: string };

export const BLOCK_LIMITS = { blocks: 24, lines: 60, text: 600, title: 80, href: 600, source: 80, note: 300, templateBlocks: 16 } as const;

/** Свой блок шаблона: c: и от 4 до 16 строчных латинских букв и цифр */
export const CUSTOM_KEY = /^c:[a-z0-9]{4,16}$/;

export const isStandardKey = (key: string): key is StandardBlockKey => (STANDARD_KEYS as readonly string[]).includes(key);
export const isBlockKey = (key: string): boolean => isStandardKey(key) || CUSTOM_KEY.test(key);
export const standardOf = (key: string): StandardBlock | undefined => STANDARD_BLOCKS.find((b) => b.key === key);

/** Новый ключ своего блока */
export function newCustomKey(random: () => number = Math.random): string {
  let s = "";
  while (s.length < 8) s += Math.floor(random() * 36).toString(36);
  return `c:${s.slice(0, 8)}`;
}

/**
 * Текст для ресурса одной строкой: длинное тире и стрелки становятся дефисом, точка посередине запятой, пробелы
 * схлопнуты. Так пишет Арам, и так в отчёт не попадут символы, которых в ресурсе нет
 */
export function tidy(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[—–‒―]/g, "-")
    .replace(/\s*[→⟶⇒➝➔⟹]\s*/g, " - ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/[​­]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/** Ссылка источника: адрес раздела приложения (/forecast?...) или внешний http(s). Остальное отбрасывается */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v || v.length > BLOCK_LIMITS.href) return null;
  if (v.startsWith("/") && !v.startsWith("//") && !/[\s\\]/.test(v)) return v;
  try {
    const url = new URL(v);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Строка блока из формы или базы. directions: допустимые коды продуктов (null: любые непустые) */
export function cleanLine(raw: unknown, directions: Set<string> | null): BlockLine | null {
  if (!isObj(raw)) return null;
  const text = tidy(raw.text, BLOCK_LIMITS.text);
  if (!text) return null;
  const code = typeof raw.product === "string" ? raw.product.trim().slice(0, 40) : "";
  const product = code && (!directions || directions.has(code)) ? code : null;
  const href = safeHref(raw.href);
  const source = href ? tidy(raw.source, BLOCK_LIMITS.source) || null : null;
  return { product, text, href, source };
}

/** Отчёт по блокам из формы или базы: неизвестные ключи, повторы и пустые строки отбрасываются, тексты обрезаются */
export function cleanBlocks(input: unknown, directions: Set<string> | null): ReportBlock[] {
  if (!Array.isArray(input)) return [];
  const out: ReportBlock[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!isObj(raw) || typeof raw.key !== "string") continue;
    const key = raw.key.trim();
    if (!isBlockKey(key) || seen.has(key)) continue;
    seen.add(key);
    const title = tidy(raw.title, BLOCK_LIMITS.title) || standardOf(key)?.title || "Блок";
    const lines = (Array.isArray(raw.lines) ? raw.lines : [])
      .map((l) => cleanLine(l, directions))
      .filter((l): l is BlockLine => !!l)
      .slice(0, BLOCK_LIMITS.lines);
    out.push({ key, title, hidden: raw.hidden === true, lines, note: tidy(raw.note, BLOCK_LIMITS.note) || null });
    if (out.length >= BLOCK_LIMITS.blocks) break;
  }
  return out;
}

/** Шаблон блоков команды из формы или базы: стандартные блоки с их названием, свои с названием от руководителя */
export function cleanTemplate(input: unknown): TemplateBlock[] {
  if (!Array.isArray(input)) return [];
  const out: TemplateBlock[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!isObj(raw) || typeof raw.key !== "string") continue;
    const key = raw.key.trim();
    if (!isBlockKey(key) || seen.has(key)) continue;
    const title = isStandardKey(key) ? standardOf(key)!.title : tidy(raw.title, BLOCK_LIMITS.title);
    if (!title) continue;
    seen.add(key);
    out.push({ key, title });
    if (out.length >= BLOCK_LIMITS.templateBlocks) break;
  }
  return out;
}

export const STANDARD_TEMPLATE: TemplateBlock[] = STANDARD_BLOCKS.map((b) => ({ key: b.key, title: b.title }));

/** Пустые блоки по шаблону */
export function emptyBlocks(template: readonly TemplateBlock[] = STANDARD_TEMPLATE): ReportBlock[] {
  return template.map((t) => ({ key: t.key, title: t.title, hidden: false, lines: [], note: null }));
}

// ---------- Продукт строки ----------

/** Другие названия продуктов в начале строки: «Партнёры:», «Вклады -» */
const PREFIX_SYNONYMS: Record<string, string[]> = {
  osago: ["ОСАГО"],
  kasko: ["КАСКО"],
  red: ["RED", "РЕД"],
  deposits: ["Депозиты и инвестиции", "Депозиты", "Вклады", "Инвестиции"],
  partners: ["Партнёрский канал", "Партнерский канал", "Партнёрка", "Партнерка", "Партнёры", "Партнеры"],
  product: ["Продукт и CJM", "CJM"],
  insurance: ["Страхование в целом"],
  department: ["Департамент"],
};

const W = "\\p{L}\\p{N}";
/** Признаки продукта внутри строки, если в начале его нет */
const KEYWORDS: [string, RegExp][] = [
  ["osago", new RegExp(`(?<![${W}])(осаго|osago)`, "iu")],
  ["kasko", new RegExp(`(?<![${W}])(каско|casco|kasko)`, "iu")],
  ["red", new RegExp(`(?<![${W}])(ипотек|ипотечн|взр(?![${W}])|ифл(?![${W}])|red(?![${W}])|страхован\\S* имуществ|страхован\\S* путешеств|клещ)`, "iu")],
  ["deposits", new RegExp(`(?<![${W}])(вклад|депозит|иис(?![${W}])|пиф(?![${W}])|инвестиц)`, "iu")],
  ["partners", new RegExp(`(?<![${W}])(партн[её]р|агрегатор|b2b(?![${W}]))`, "iu")],
  ["product", new RegExp(`(?<![${W}])cjm(?![${W}])`, "iu")],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Продукт строки: название продукта в начале («ОСАГО. текст», «Партнёры: текст») или признак продукта внутри строки
 * («Конверсия ОСАГО выросла»). rest: текст без названия в начале. Только продукты из products
 */
export function productOfText(text: string, products: readonly ProductRef[]): { product: string | null; rest: string } {
  const value = text.trim();
  const known = new Set(products.map((p) => p.code));
  const names: [string, string][] = [];
  for (const p of products) {
    names.push([p.code, p.label]);
    for (const s of PREFIX_SYNONYMS[p.code] ?? []) names.push([p.code, s]);
  }
  names.sort((a, b) => b[1].length - a[1].length);
  for (const [code, name] of names) {
    const m = new RegExp(`^${escape(name)}\\s*[.:,]\\s*(.+)$|^${escape(name)}\\s+-\\s+(.+)$`, "iu").exec(value);
    if (m) return { product: code, rest: (m[1] ?? m[2] ?? "").trim() };
  }
  for (const [code, re] of KEYWORDS) if (known.has(code) && re.test(value)) return { product: code, rest: value };
  return { product: null, rest: value };
}

// ---------- Текст ----------

export const labelOf = (code: string | null, labels: Labels): string | null => (code ? (labels[code] ?? code) : null);

/** Строка текстом: «ОСАГО. Текст». Текст уже начинается с названия продукта: второй раз не пишем */
export function lineText(line: BlockLine, labels: Labels): string {
  const label = labelOf(line.product, labels);
  if (!label) return line.text;
  if (new RegExp(`^${escape(label)}(?![${W}])`, "iu").test(line.text)) return line.text;
  return `${label}. ${line.text}`;
}

/** Строки блока «Продукты» по продуктам в порядке справочника: подраздел на каждый продукт */
export function productGroups(lines: readonly BlockLine[], order: readonly string[]): { product: string | null; items: { line: BlockLine; index: number }[] }[] {
  const groups = new Map<string | null, { line: BlockLine; index: number }[]>();
  lines.forEach((line, index) => {
    const list = groups.get(line.product) ?? [];
    list.push({ line, index });
    groups.set(line.product, list);
  });
  const rank = (p: string | null) => (p === null ? order.length + 1 : order.includes(p) ? order.indexOf(p) : order.length);
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([product, items]) => ({ product, items }));
}

/** Строки блока в порядке показа: в «Продуктах» по продуктам, в остальных как есть */
export function orderedLines(block: ReportBlock, order: readonly string[]): BlockLine[] {
  return block.key === "products" ? productGroups(block.lines, order).flatMap((g) => g.items.map((i) => i.line)) : block.lines;
}

/** Видимые блоки со строками: то, что получит CEO или руководитель */
export const visibleBlocks = (blocks: readonly ReportBlock[]) => blocks.filter((b) => !b.hidden && b.lines.length);

/** Есть ли в отчёте хоть одна видимая строка */
export const hasBlocksText = (blocks: readonly ReportBlock[] | null | undefined): boolean => !!blocks && visibleBlocks(blocks).length > 0;

/** Отчёт текстом для копирования и письма: заголовок блока и строки «- ОСАГО. Текст». Скрытые и пустые блоки не попадают */
export function blocksText(blocks: readonly ReportBlock[], labels: Labels, order: readonly string[]): string[] {
  const out: string[] = [];
  for (const b of visibleBlocks(blocks)) {
    out.push(b.title, ...orderedLines(b, order).map((l) => `- ${lineText(l, labels)}`), "");
  }
  return out;
}

export type LegacySections = { main: string; risks: string; next: string };

/**
 * Прежние разделы отчёта CEO из блоков: их читают выгрузка в Excel и всё, что знает отчёт в прежнем виде. Главное: все
 * видимые блоки, кроме рисков и плана, с заголовком блока; риски из «Рисков», что дальше из «Плана на неделю»
 */
export function blocksToLegacy(blocks: readonly ReportBlock[], labels: Labels, order: readonly string[]): LegacySections {
  const lines = (b: ReportBlock) => orderedLines(b, order).map((l) => `- ${lineText(l, labels)}`);
  const visible = visibleBlocks(blocks);
  const main = visible
    .filter((b) => b.key !== "risks" && b.key !== "plan")
    .flatMap((b) => [`${b.title}:`, ...lines(b)])
    .join("\n");
  return {
    main,
    risks: visible.filter((b) => b.key === "risks").flatMap(lines).join("\n"),
    next: visible.filter((b) => b.key === "plan").flatMap(lines).join("\n"),
  };
}

const bulletLines = (text: string) =>
  text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•◦▪]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

/**
 * Отчёт в прежнем виде по блокам: строки главного по продуктам («Продукты», партнёрка в «Партнёрский канал», без
 * продукта в «Новости рынка и команды»), риски в «Риски», что дальше в «План на неделю». Строка без продукта
 * подписывается департаментом, если он есть в справочнике
 */
export function legacyToBlocks(sections: LegacySections, products: readonly ProductRef[], template: readonly TemplateBlock[] = STANDARD_TEMPLATE): ReportBlock[] {
  const blocks = emptyBlocks(template);
  const fallback = products.some((p) => p.code === "department") ? "department" : null;
  const push = (key: string, line: BlockLine) => {
    const b = blocks.find((x) => x.key === key) ?? blocks.find((x) => x.key === "products") ?? blocks[0];
    if (b && b.lines.length < BLOCK_LIMITS.lines) b.lines.push(line);
  };
  const line = (text: string): { found: string | null; line: BlockLine } => {
    const { product, rest } = productOfText(text, products);
    return { found: product, line: { product: product ?? fallback, text: tidy(rest || text, BLOCK_LIMITS.text), href: null, source: null } };
  };
  for (const t of bulletLines(sections.main)) {
    const { found, line: l } = line(t);
    if (l.text) push(found === "partners" ? "partners" : found ? "products" : "news", l);
  }
  for (const t of bulletLines(sections.risks)) push("risks", line(t).line);
  for (const t of bulletLines(sections.next)) push("plan", line(t).line);
  return blocks.map((b) => ({ ...b, lines: b.lines.filter((l) => l.text) }));
}

/**
 * Черновик weekly для CEO из хранилища разбора встречи: новый вид (блоки) или прежний (главное, риски, что дальше,
 * разборы до этапа 66). Прежний раскладывается по блокам тем же правилом, что старый отчёт CEO
 */
export function draftBlocksOf(value: unknown, products: readonly ProductRef[]): ReportBlock[] {
  if (Array.isArray(value)) return cleanBlocks(value, null);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const s = (x: unknown) => (typeof x === "string" ? x : "");
    if ("main" in v || "risks" in v || "next" in v) return legacyToBlocks({ main: s(v.main), risks: s(v.risks), next: s(v.next) }, products);
  }
  return [];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Та же строка: одинаковый текст без учёта регистра и знаков. Продукт не важен: одна мысль не повторяется дважды */
export const sameLine = (a: Pick<BlockLine, "text">, b: Pick<BlockLine, "text">) => norm(a.text) === norm(b.text);

/** Строки без повторов: первая из одинаковых остаётся */
export function uniqueLines(lines: readonly BlockLine[]): BlockLine[] {
  const out: BlockLine[] = [];
  for (const l of lines) if (!out.some((x) => sameLine(x, l))) out.push(l);
  return out;
}

export type MergeMode = "merge" | "replace";

/**
 * Черновик (например, из разбора встречи) и отчёт, который за неделю уже есть. merge: строки черновика дописываются в
 * конец своих блоков, строки, которые там уже есть, второй раз не попадают; пустой блок, получивший строки, открывается.
 * replace: блоки черновика заменяют строки своих блоков целиком. Блоки, которых в черновике нет (цифры недели и месяца,
 * свои блоки), остаются как были
 */
export function mergeBlocks(existing: readonly ReportBlock[], draft: readonly ReportBlock[], mode: MergeMode): ReportBlock[] {
  const byKey = new Map(draft.map((b) => [b.key, b]));
  const out = existing.map((b): ReportBlock => {
    const d = byKey.get(b.key);
    if (!d) return b;
    if (mode === "replace") return { ...b, lines: uniqueLines(d.lines).slice(0, BLOCK_LIMITS.lines), hidden: d.lines.length ? false : b.hidden };
    const add = d.lines.filter((l, i) => !b.lines.some((x) => sameLine(x, l)) && !d.lines.slice(0, i).some((x) => sameLine(x, l)));
    if (!add.length) return b;
    return { ...b, lines: [...b.lines, ...add].slice(0, BLOCK_LIMITS.lines), hidden: b.lines.length ? b.hidden : false };
  });
  for (const d of draft) if (!existing.some((b) => b.key === d.key) && d.lines.length && out.length < BLOCK_LIMITS.blocks) out.push({ ...d, lines: uniqueLines(d.lines) });
  return out;
}
