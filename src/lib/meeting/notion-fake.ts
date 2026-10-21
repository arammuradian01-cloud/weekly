// Имитация Notion API для тестов и e2e (этап 61): NOTION_FAKE_DIR указывает на папку с фикстурами *.json. Настоящий Notion
// тестами не вызывается. Фикстура: { "page": объект страницы, "children": { "<id страницы или блока>": [блоки] },
// "databases": { "<id>": объект базы }, "pages": { "<id>": объект родительской страницы } }. Нет страницы в фикстурах:
// ответ 404 object_not_found, как у страницы, не расшаренной на интеграцию. В рабочем образе имитация не включается
// (notion-api.ts, fakeAllowed).

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

type Obj = { id?: string } & Record<string, unknown>;
type Fixture = { page?: Obj; children?: Record<string, Obj[]>; databases?: Record<string, Obj>; pages?: Record<string, Obj> };

const norm = (id: string) => id.replace(/-/g, "").toLowerCase();

function load(dir: string) {
  const pages = new Map<string, unknown>();
  const databases = new Map<string, unknown>();
  const children = new Map<string, Obj[]>();
  const blocks = new Map<string, Obj>();
  const root = resolve(process.cwd(), dir);
  for (const name of readdirSync(root).filter((n) => n.endsWith(".json"))) {
    const fx = JSON.parse(readFileSync(join(root, name), "utf8")) as Fixture;
    if (fx.page?.id) pages.set(norm(fx.page.id), fx.page);
    for (const [id, p] of Object.entries(fx.pages ?? {})) pages.set(norm(id), { id, ...p });
    for (const [id, db] of Object.entries(fx.databases ?? {})) databases.set(norm(id), { object: "database", id, ...db });
    for (const [id, list] of Object.entries(fx.children ?? {})) {
      children.set(norm(id), list);
      // Родитель блока: страница фикстуры или блок, в котором он лежит
      const parent = fx.page?.id && norm(fx.page.id) === norm(id) ? { type: "page_id", page_id: id } : { type: "block_id", block_id: id };
      for (const b of list) if (b.id) blocks.set(norm(b.id), { parent, ...b });
    }
  }
  return { pages, databases, children, blocks };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () => json(404, { object: "error", status: 404, code: "object_not_found", message: "Could not find object" });

/** fetch, который отвечает как Notion API по фикстурам. Страницы списка отдаются по page_size с курсором-смещением */
export function fakeNotionFetch(dir: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const data = load(dir);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const id = (m: RegExpExecArray) => norm(decodeURIComponent(m[1]!));
    const page = /^\/v1\/pages\/([^/]+)$/.exec(url.pathname);
    if (page) return data.pages.has(id(page)) ? json(200, data.pages.get(id(page))) : notFound();
    const db = /^\/v1\/databases\/([^/]+)$/.exec(url.pathname);
    if (db) return data.databases.has(id(db)) ? json(200, data.databases.get(id(db))) : notFound();
    const kids = /^\/v1\/blocks\/([^/]+)\/children$/.exec(url.pathname);
    if (kids) {
      const key = id(kids);
      const list = data.children.get(key);
      if (!list) return data.pages.has(key) || data.blocks.has(key) ? json(200, { object: "list", results: [], has_more: false, next_cursor: null }) : notFound();
      const size = Math.min(Number(url.searchParams.get("page_size") ?? 100) || 100, 100);
      const from = Number(url.searchParams.get("start_cursor") ?? 0) || 0;
      const results = list.slice(from, from + size);
      const more = from + size < list.length;
      return json(200, { object: "list", results, has_more: more, next_cursor: more ? String(from + size) : null });
    }
    const block = /^\/v1\/blocks\/([^/]+)$/.exec(url.pathname);
    if (block) return data.blocks.has(id(block)) ? json(200, data.blocks.get(id(block))) : notFound();
    return json(400, { object: "error", status: 400, code: "validation_error" });
  }) as typeof fetch;
}
