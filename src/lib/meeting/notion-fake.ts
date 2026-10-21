// Имитация Notion API для тестов и e2e (этап 61): NOTION_FAKE_DIR указывает на папку с фикстурами *.json. Настоящий Notion
// тестами не вызывается. Фикстура: { "page": объект страницы, "children": { "<id страницы или блока>": [блоки] } }.
// Нет страницы в фикстурах: ответ 404 object_not_found, как у страницы, не расшаренной на интеграцию.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

type Fixture = { page?: { id?: string } & Record<string, unknown>; children?: Record<string, unknown[]> };

const norm = (id: string) => id.replace(/-/g, "").toLowerCase();

function load(dir: string) {
  const pages = new Map<string, unknown>();
  const children = new Map<string, unknown[]>();
  const root = resolve(process.cwd(), dir);
  for (const name of readdirSync(root).filter((n) => n.endsWith(".json"))) {
    const fx = JSON.parse(readFileSync(join(root, name), "utf8")) as Fixture;
    if (fx.page?.id) pages.set(norm(fx.page.id), fx.page);
    for (const [id, list] of Object.entries(fx.children ?? {})) children.set(norm(id), list);
  }
  return { pages, children };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** fetch, который отвечает как Notion API по фикстурам. Страницы списка отдаются по page_size с курсором-смещением */
export function fakeNotionFetch(dir: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const data = load(dir);
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const page = /^\/v1\/pages\/([^/]+)$/.exec(url.pathname);
    if (page) {
      const found = data.pages.get(norm(decodeURIComponent(page[1]!)));
      return found ? json(200, found) : json(404, { object: "error", status: 404, code: "object_not_found", message: "Could not find page" });
    }
    const kids = /^\/v1\/blocks\/([^/]+)\/children$/.exec(url.pathname);
    if (kids) {
      const id = norm(decodeURIComponent(kids[1]!));
      const list = data.children.get(id);
      if (!list) return data.pages.has(id) ? json(200, { object: "list", results: [], has_more: false, next_cursor: null }) : json(404, { object: "error", status: 404, code: "object_not_found" });
      const size = Math.min(Number(url.searchParams.get("page_size") ?? 100) || 100, 100);
      const from = Number(url.searchParams.get("start_cursor") ?? 0) || 0;
      const results = list.slice(from, from + size);
      const more = from + size < list.length;
      return json(200, { object: "list", results, has_more: more, next_cursor: more ? String(from + size) : null });
    }
    return json(400, { object: "error", status: 400, code: "validation_error" });
  }) as typeof fetch;
}
