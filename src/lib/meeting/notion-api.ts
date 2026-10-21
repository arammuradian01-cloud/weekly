// Чтение страницы встречи из Notion (этап 61). Внутренняя интеграция Notion: ключ в переменной окружения NOTION_TOKEN,
// страницы встреч расшарены на интеграцию. Страница читается по ссылке: заголовок (GET /v1/pages/{id}) и блоки
// (GET /v1/blocks/{id}/children с пагинацией, вложенные блоки до четвёртого уровня). Блоки превращаются в текст
// с заголовками и списками, по нему разбирается встреча.
//
// Транспорт подменяемый: fetch передаётся снаружи. В тестах и e2e работает имитация по фикстурам (NOTION_FAKE_DIR),
// настоящий Notion тестами не вызывается. Ключ интеграции не попадает ни в ответы, ни в тексты ошибок, ни в журнал.

import { cleanText, PARSE_LIMITS } from "./parse-types";

export const NOTION_VERSION = "2022-06-28";
const DEFAULT_BASE = "https://api.notion.com";
const REQUEST_TIMEOUT_MS = 20_000;
/** Больше блоков не читаем: длинная страница обрезается, разбор идёт по началу */
const MAX_BLOCKS = 1500;
const MAX_DEPTH = 4;

export type NotionErrorCode = "no-token" | "bad-url" | "not-shared" | "not-allowed" | "bad-allowed" | "unauthorized" | "rate" | "timeout" | "other";

/** Ошибка Notion словами для экрана: что не так и что сделать. Без ключа и без текста страницы */
export class NotionError extends Error {
  constructor(
    message: string,
    readonly code: NotionErrorCode,
  ) {
    super(message);
  }
}

export const NOTION_MESSAGES: Record<NotionErrorCode, string> = {
  "no-token": "На сервере не задан ключ интеграции Notion (переменная NOTION_TOKEN). Его ставит владелец в переменных приложения в Timeweb",
  "bad-url": "Ссылка не похожа на страницу Notion. Откройте встречу в Notion, «Поделиться», «Скопировать ссылку» и вставьте её целиком",
  "not-shared":
    "Notion не отдал страницу: её нет или она не расшарена на интеграцию. Откройте страницу в Notion, меню с тремя точками справа вверху, «Подключения» и добавьте интеграцию ресурса",
  "not-allowed":
    "Эта страница не лежит в разделах Notion, из которых ресурсу разрешено разбирать встречи (переменная NOTION_ALLOWED_PARENTS). Перенесите встречу в такой раздел или попросите владельца добавить раздел",
  "bad-allowed":
    "Переменная NOTION_ALLOWED_PARENTS задана, но в ней нет ни одного ID страницы или базы Notion. Разбор закрыт, пока владелец не поправит её в переменных приложения",
  unauthorized: "Notion не принял ключ интеграции. Проверьте переменную NOTION_TOKEN на сервере",
  rate: "Notion просит подождать: слишком много запросов. Повторите через минуту",
  timeout: "Notion не ответил вовремя. Повторите через минуту",
  other: "Notion не ответил. Повторите через минуту",
};

const failWith = (code: NotionErrorCode): never => {
  throw new NotionError(NOTION_MESSAGES[code], code);
};

/** Домены Notion: notion.so, notion.com с www и app, опубликованные страницы *.notion.site */
export function isNotionHost(host: string): boolean {
  return /^(?:www\.)?notion\.(?:so|com)$|^app\.notion\.com$|^[a-z0-9-]+\.notion\.site$/i.test(host);
}

/**
 * ID страницы из ссылки: 32 шестнадцатеричных знака в конце адреса или в параметре p (с дефисами или без).
 * Только https и домены Notion. null: ссылка не на страницу Notion, в том числе с битым «%» в адресе
 */
export function notionPageIdFromUrl(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let candidates: string[];
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !isNotionHost(u.hostname)) return null;
    candidates = [u.searchParams.get("p") ?? "", decodeURIComponent(u.pathname)];
  } catch {
    return null;
  }
  for (const c of candidates) {
    const found = [...c.matchAll(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?![0-9a-f])/gi)].at(-1)?.[1];
    if (found) return normId(found);
  }
  return null;
}

/** ID Notion в одном виде: строчные с дефисами. null: не ID */
export function normId(value: string): string | null {
  const hex = String(value ?? "").replace(/-/g, "").trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? dashed(hex) : null;
}

const dashed = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

// ---------- Блоки в текст ----------

/** Блоки, которые Notion API не отдаёт текстом: AI-заметки встречи, расшифровки и всё, что API помечает unsupported */
const UNREADABLE = new Set(["unsupported", "transcription", "meeting_notes", "ai_block"]);
/** Блоки без текста по своей природе: их отсутствие текста не ошибка */
const NO_TEXT = new Set([
  "image", "video", "file", "pdf", "audio", "embed", "bookmark", "link_preview", "divider", "table_of_contents", "breadcrumb",
  "column_list", "column", "table", "link_to_page", "child_page", "child_database", "synced_block", "template", "equation",
]);
const KNOWN_TEXT = new Set(["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "toggle", "quote", "callout", "code", "table_row"]);

/** Не прочитался ли блок: известный нечитаемый тип или незнакомый тип без текста и без детей */
export function unreadableBlock(b: NotionBlock): boolean {
  if (UNREADABLE.has(b.type)) return true;
  if (KNOWN_TEXT.has(b.type) || NO_TEXT.has(b.type)) return false;
  return !blockLine(b).trim() && !b.has_children;
}

type RichText = { plain_text?: string; type?: string; text?: { content?: string } };
export type NotionBlock = { id: string; type: string; has_children?: boolean; children?: NotionBlock[] } & Record<string, unknown>;

export function richText(list: unknown): string {
  if (!Array.isArray(list)) return "";
  return (list as RichText[]).map((r) => r?.plain_text ?? r?.text?.content ?? "").join("");
}

function payload(b: NotionBlock): Record<string, unknown> {
  const p = b[b.type];
  return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
}

/** Текст блока без детей: rich_text блока, у заголовка вложенной страницы её название, у строки таблицы ячейки */
function blockLine(b: NotionBlock): string {
  const p = payload(b);
  if (b.type === "child_page" || b.type === "child_database") return typeof p.title === "string" ? p.title : "";
  if (b.type === "table_row") return Array.isArray(p.cells) ? (p.cells as unknown[]).map(richText).join(" | ") : "";
  if (b.type === "equation") return typeof p.expression === "string" ? p.expression : "";
  return richText(p.rich_text ?? p.text ?? p.caption);
}

/**
 * Дерево блоков в текст: заголовки «#», списки «-» и «1.», задачи «- [ ]» и «- [x]», цитаты «>», вложенность отступом.
 * Неизвестные блоки с текстом пишутся строкой, без текста пропускаются; их дети читаются
 */
export function blocksToText(blocks: NotionBlock[], depth = 0): string {
  const out: string[] = [];
  const pad = "  ".repeat(depth);
  let n = 0;
  for (const b of blocks) {
    const text = cleanText(blockLine(b), 2000);
    n = b.type === "numbered_list_item" ? n + 1 : 0;
    let line: string | null = null;
    let childDepth = depth;
    switch (b.type) {
      case "heading_1":
        line = text ? `# ${text}` : null;
        break;
      case "heading_2":
        line = text ? `## ${text}` : null;
        break;
      case "heading_3":
        line = text ? `### ${text}` : null;
        break;
      case "bulleted_list_item":
      case "toggle":
        line = text ? `${pad}- ${text}` : null;
        childDepth = depth + 1;
        break;
      case "numbered_list_item":
        line = text ? `${pad}${n}. ${text}` : null;
        childDepth = depth + 1;
        break;
      case "to_do":
        line = text ? `${pad}- [${payload(b).checked ? "x" : " "}] ${text}` : null;
        childDepth = depth + 1;
        break;
      case "quote":
        line = text ? `${pad}> ${text}` : null;
        break;
      case "divider":
        line = "---";
        break;
      case "child_page":
        line = text ? `${pad}Вложенная страница: ${text}` : null;
        break;
      case "child_database":
        line = text ? `${pad}Вложенная база: ${text}` : null;
        break;
      default:
        line = text ? `${pad}${text}` : null;
    }
    if (line) out.push(line);
    if (b.children?.length) {
      const inner = blocksToText(b.children, childDepth);
      if (inner) out.push(inner);
    }
  }
  return out.join("\n");
}

// ---------- Запросы ----------

export type NotionDeps = {
  fetch?: typeof fetch;
  token?: string | null;
  base?: string;
  timeoutMs?: number;
  maxBlocks?: number;
  /** Общий срок на чтение страницы: что не успели, отмечается «текст обрезан по времени» */
  budgetMs?: number;
  /** Разрешённые разделы (NOTION_ALLOWED_PARENTS): страница должна лежать под одним из них */
  allowedParents?: string[];
  /** Переменная разделов задана, но ни одного ID в ней нет: разбор закрыт, а не открыт для всех */
  allowedInvalid?: boolean;
};

export type NotionPage = {
  id: string;
  title: string;
  text: string;
  blocks: number;
  truncated: boolean;
  /** Не успели дочитать за общий срок */
  cutByTime: boolean;
  /** Блоки, которые Notion API не отдаёт текстом */
  unreadable: number;
  /** Копии синхронизированных блоков с других страниц, которые не читались из-за разрешённых разделов */
  syncedSkipped: number;
};

/** Общий срок на чтение Notion: дальше разбор идёт по тому, что успели прочитать */
export const NOTION_BUDGET_MS = 90_000;
/** Сколько уровней вверх проверять разрешённый раздел */
const PARENT_DEPTH = 5;

type Conn = { fetch: typeof fetch; base: string; timeoutMs: number; token: string; deadline: number };

class OutOfTime extends Error {}

async function call(d: Conn, path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const left = d.deadline - Date.now();
    if (left <= 0) throw new OutOfTime();
    // Остаток общего срока меньше таймаута запроса: обрыв запроса значит, что кончилось время, а не что Notion упал
    const capped = left < d.timeoutMs;
    let res: Response;
    try {
      res = await d.fetch(`${d.base}${path}`, {
        headers: { Authorization: `Bearer ${d.token}`, "Notion-Version": NOTION_VERSION, Accept: "application/json" },
        signal: AbortSignal.timeout(Math.min(d.timeoutMs, left)),
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        if (capped || d.deadline - Date.now() <= 0) throw new OutOfTime();
        return failWith("timeout");
      }
      return failWith("other");
    }
    if (res.ok) {
      try {
        return await res.json();
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") && capped) throw new OutOfTime();
        return failWith("other");
      }
    }
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min((Number(res.headers.get("retry-after") ?? "1") || 1) * 1000, 5000, d.deadline - Date.now());
      if (wait <= 0) throw new OutOfTime();
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    let code = "";
    try {
      code = String(((await res.json()) as { code?: string })?.code ?? "");
    } catch {
      // Ответ без тела: разбираем по статусу
    }
    if (res.status === 401 || code === "unauthorized") return failWith("unauthorized");
    if (res.status === 404 || res.status === 403 || code === "object_not_found" || code === "restricted_resource") return failWith("not-shared");
    if (res.status === 400 || code === "validation_error") return failWith("bad-url");
    if (res.status === 429) return failWith("rate");
    return failWith("other");
  }
}

/** Заголовок страницы: свойство с типом title */
function pageTitle(page: unknown): string {
  const props = (page as { properties?: Record<string, { type?: string; title?: unknown }> })?.properties ?? {};
  const prop = Object.values(props).find((p) => p?.type === "title");
  return cleanText(richText(prop?.title), 300);
}

type Parent = { type?: string; page_id?: string; database_id?: string; data_source_id?: string; block_id?: string };

/** Родитель объекта Notion: страница, база, источник данных или блок. Пространство и неизвестное: верх */
function parentOf(obj: unknown): { kind: "page" | "database" | "block"; id: string } | null {
  const p = (obj as { parent?: Parent })?.parent;
  if (!p) return null;
  if (p.type === "page_id" && p.page_id) return { kind: "page", id: p.page_id };
  if (p.type === "database_id" && p.database_id) return { kind: "database", id: p.database_id };
  if (p.type === "data_source_id" && (p.database_id || p.data_source_id)) return { kind: "database", id: (p.database_id ?? p.data_source_id)! };
  if (p.type === "block_id" && p.block_id) return { kind: "block", id: p.block_id };
  return null;
}

/**
 * Лежит ли страница под разрешённым разделом: сама страница или её родители до пяти уровней вверх. Родителя не видно
 * (не расшарен на интеграцию): проверить нельзя, значит нельзя и разбирать
 */
async function checkAllowed(d: Conn, pageId: string, page: unknown, allowed: string[]): Promise<void> {
  const want = new Set(allowed.map(normId).filter((x): x is string => !!x));
  if (!want.size) return;
  if (want.has(normId(pageId)!)) return;
  let cur: unknown = page;
  for (let level = 0; level < PARENT_DEPTH; level++) {
    const parent = parentOf(cur);
    if (!parent) break;
    const id = normId(parent.id);
    if (id && want.has(id)) return;
    const path = parent.kind === "page" ? `/v1/pages/${encodeURIComponent(parent.id)}` : parent.kind === "database" ? `/v1/databases/${encodeURIComponent(parent.id)}` : `/v1/blocks/${encodeURIComponent(parent.id)}`;
    try {
      cur = await call(d, path);
    } catch (error) {
      // Родителя не видно (404 или 403: не расшарен на интеграцию): проверить нельзя, значит нельзя и разбирать.
      // Таймаут, лимит запросов и сбой Notion остаются ошибкой Notion: повтор может пройти
      if (error instanceof NotionError && error.code === "not-shared") break;
      throw error;
    }
  }
  failWith("not-allowed");
}

/** Разрешённые разделы из окружения: ID страниц или баз через запятую, можно ссылками */
export function allowedParentsFromEnv(value = process.env.NOTION_ALLOWED_PARENTS): string[] {
  return String(value ?? "")
    .split(/[,;\s]+/)
    .map((x) => (x.startsWith("http") ? notionPageIdFromUrl(x) : normId(x)))
    .filter((x): x is string => !!x);
}

/** Имитация включается только в тестах: в рабочем образе (NODE_ENV=production) лишь со сквозными тестами (WEEKLY_E2E=1) */
export function fakeAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.WEEKLY_E2E === "1";
}

/**
 * Разрешённые разделы из окружения с проверкой: переменная задана, а ID в ней не разобрать, значит разбор закрыт (fail
 * closed). В лог предупреждение без значения переменной
 */
export function allowedFromEnv(value = process.env.NOTION_ALLOWED_PARENTS): { allowedParents: string[]; allowedInvalid: boolean } {
  const allowedParents = allowedParentsFromEnv(value);
  const allowedInvalid = !!String(value ?? "").trim() && !allowedParents.length;
  if (allowedInvalid) console.warn("NOTION_ALLOWED_PARENTS задана, но в ней нет ни одного ID страницы или базы Notion: разбор встреч закрыт");
  return { allowedParents, allowedInvalid };
}

/** Транспорт по умолчанию: имитация по фикстурам, если задан NOTION_FAKE_DIR и это тест, иначе настоящий Notion с ключом из окружения */
export async function notionDepsFromEnv(): Promise<NotionDeps> {
  const allowed = allowedFromEnv();
  if (process.env.NOTION_FAKE_DIR && fakeAllowed()) {
    const { fakeNotionFetch } = await import("./notion-fake");
    return { fetch: fakeNotionFetch(process.env.NOTION_FAKE_DIR), token: "fake", base: "https://notion.fake", ...allowed };
  }
  return { fetch: globalThis.fetch, token: process.env.NOTION_TOKEN ?? null, base: process.env.NOTION_API_BASE || DEFAULT_BASE, ...allowed };
}

/** Страница целиком: заголовок и текст блоков. Ошибка: NotionError со словами для экрана */
export async function readNotionPage(pageId: string, deps: NotionDeps): Promise<NotionPage> {
  const token = deps.token?.trim();
  if (!token) return failWith("no-token");
  if (deps.allowedInvalid) return failWith("bad-allowed");
  const d: Conn = {
    fetch: deps.fetch ?? globalThis.fetch,
    base: (deps.base ?? DEFAULT_BASE).replace(/\/+$/, ""),
    timeoutMs: deps.timeoutMs ?? REQUEST_TIMEOUT_MS,
    token,
    deadline: Date.now() + (deps.budgetMs ?? NOTION_BUDGET_MS),
  };
  const max = deps.maxBlocks ?? MAX_BLOCKS;
  let page: unknown;
  try {
    page = await call(d, `/v1/pages/${encodeURIComponent(pageId)}`);
    await checkAllowed(d, pageId, page, deps.allowedParents ?? []);
  } catch (error) {
    if (error instanceof OutOfTime) return failWith("timeout");
    throw error;
  }
  let count = 0;
  let truncated = false;
  let cutByTime = false;
  let unreadable = 0;
  let syncedSkipped = 0;
  // С разрешёнными разделами копия синхронизированного блока с другой страницы не читается: её оригинал может лежать
  // вне разрешённых разделов
  const restricted = (deps.allowedParents ?? []).length > 0;
  const foreignCopy = (b: NotionBlock) => b.type === "synced_block" && !!(payload(b).synced_from as { block_id?: string } | null | undefined)?.block_id;
  const children = async (id: string, depth: number): Promise<NotionBlock[]> => {
    const list: NotionBlock[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `/v1/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
      let res: { results?: NotionBlock[]; has_more?: boolean; next_cursor?: string | null };
      try {
        res = (await call(d, q)) as typeof res;
      } catch (error) {
        // Время вышло: разбираем то, что успели прочитать
        if (!(error instanceof OutOfTime)) throw error;
        cutByTime = true;
        truncated = true;
        return list;
      }
      for (const b of res.results ?? []) {
        if (count >= max) {
          truncated = true;
          break;
        }
        count++;
        if (unreadableBlock(b)) unreadable++;
        list.push(b);
      }
      cursor = res.has_more && count < max ? (res.next_cursor ?? null) : null;
      if (res.has_more && count >= max) truncated = true;
    } while (cursor);
    for (const b of list) {
      if (restricted && foreignCopy(b)) {
        syncedSkipped++;
        unreadable++;
        continue;
      }
      // Вложенные страницы и базы не читаем: это другие документы
      if (!b.has_children || b.type === "child_page" || b.type === "child_database") continue;
      if (depth >= MAX_DEPTH || count >= max || cutByTime) {
        truncated = true;
        continue;
      }
      b.children = await children(b.id, depth + 1);
    }
    return list;
  };
  const tree = await children(pageId, 0);
  let text = blocksToText(tree);
  if (text.length > PARSE_LIMITS.pageText) {
    text = text.slice(0, PARSE_LIMITS.pageText);
    truncated = true;
  }
  return { id: pageId, title: pageTitle(page), text, blocks: count, truncated, cutByTime, unreadable, syncedSkipped };
}

/** Есть ли в тексте что разбирать: без заголовков, значков списков и разметки хотя бы пара слов */
export function meaningfulText(text: string): boolean {
  const body = text
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && l.trim() !== "---")
    .join(" ")
    .replace(/[-*>|\[\]x\d.\s]/gi, "");
  return body.length >= 10;
}
