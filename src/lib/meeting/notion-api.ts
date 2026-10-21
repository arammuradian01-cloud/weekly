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

export type NotionErrorCode = "no-token" | "bad-url" | "not-shared" | "unauthorized" | "rate" | "timeout" | "other";

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
  unauthorized: "Notion не принял ключ интеграции. Проверьте переменную NOTION_TOKEN на сервере",
  rate: "Notion просит подождать: слишком много запросов. Повторите через минуту",
  timeout: "Notion не ответил вовремя. Повторите через минуту",
  other: "Notion не ответил. Повторите через минуту",
};

const failWith = (code: NotionErrorCode): never => {
  throw new NotionError(NOTION_MESSAGES[code], code);
};

/**
 * ID страницы из ссылки: 32 шестнадцатеричных знака в конце адреса или в параметре p (с дефисами или без).
 * Только https и домены Notion. null: ссылка не на страницу Notion
 */
export function notionPageIdFromUrl(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/(^|\.)notion\.(so|site)$/.test(u.hostname)) return null;
  const candidates = [u.searchParams.get("p") ?? "", decodeURIComponent(u.pathname)];
  for (const c of candidates) {
    const found = [...c.matchAll(/([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})(?![0-9a-f])/gi)].at(-1)?.[1];
    if (found) return dashed(found.replace(/-/g, "").toLowerCase());
  }
  return null;
}

const dashed = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

// ---------- Блоки в текст ----------

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
};

export type NotionPage = { id: string; title: string; text: string; blocks: number; truncated: boolean };

async function call(deps: Required<Pick<NotionDeps, "fetch" | "base" | "timeoutMs">> & { token: string }, path: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await deps.fetch(`${deps.base}${path}`, {
        headers: { Authorization: `Bearer ${deps.token}`, "Notion-Version": NOTION_VERSION, Accept: "application/json" },
        signal: AbortSignal.timeout(deps.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return failWith("timeout");
      return failWith("other");
    }
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? "1") || 1, 5);
      await new Promise((r) => setTimeout(r, wait * 1000));
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

/** Транспорт по умолчанию: имитация по фикстурам, если задан NOTION_FAKE_DIR, иначе настоящий Notion с ключом из окружения */
export async function notionDepsFromEnv(): Promise<NotionDeps> {
  if (process.env.NOTION_FAKE_DIR) {
    const { fakeNotionFetch } = await import("./notion-fake");
    return { fetch: fakeNotionFetch(process.env.NOTION_FAKE_DIR), token: "fake", base: "https://notion.fake" };
  }
  return { fetch: globalThis.fetch, token: process.env.NOTION_TOKEN ?? null, base: process.env.NOTION_API_BASE || DEFAULT_BASE };
}

/** Страница целиком: заголовок и текст блоков. Ошибка: NotionError со словами для экрана */
export async function readNotionPage(pageId: string, deps: NotionDeps): Promise<NotionPage> {
  const token = deps.token?.trim();
  if (!token) return failWith("no-token");
  const d = { fetch: deps.fetch ?? globalThis.fetch, base: (deps.base ?? DEFAULT_BASE).replace(/\/+$/, ""), timeoutMs: deps.timeoutMs ?? REQUEST_TIMEOUT_MS, token };
  const max = deps.maxBlocks ?? MAX_BLOCKS;
  const page = await call(d, `/v1/pages/${encodeURIComponent(pageId)}`);
  let count = 0;
  let truncated = false;
  const children = async (id: string, depth: number): Promise<NotionBlock[]> => {
    const list: NotionBlock[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `/v1/blocks/${encodeURIComponent(id)}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = (await call(d, q)) as { results?: NotionBlock[]; has_more?: boolean; next_cursor?: string | null };
      for (const b of res.results ?? []) {
        if (count >= max) {
          truncated = true;
          break;
        }
        count++;
        list.push(b);
      }
      cursor = res.has_more && count < max ? (res.next_cursor ?? null) : null;
      if (res.has_more && count >= max) truncated = true;
    } while (cursor);
    for (const b of list) {
      // Вложенные страницы и базы не читаем: это другие документы
      if (!b.has_children || b.type === "child_page" || b.type === "child_database") continue;
      if (depth >= MAX_DEPTH || count >= max) {
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
  return { id: pageId, title: pageTitle(page), text, blocks: count, truncated };
}
