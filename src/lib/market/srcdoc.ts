// Страница окна дашборда рынка (этап 62): srcdoc изолированного iframe. Порядок: политика CSP (сеть закрыта, только
// встроенные скрипты и стили), токены оформления, среда window.dash, библиотека графиков d3 из пакета, затем код
// index.html. Скрипты и стили, которые index.html подключает по имени файла, встают внутрь страницы: внешних
// адресов у окна нет. Чистая функция: её считает браузер родителя и проверяют тесты.

import { attr, D3_FILE, SCRIPT_ELEMENT } from "./bundle";
import { MARKET_RUNTIME_JS } from "./runtime";
import { MARKET_PALETTES, MARKET_THEME_CSS, type MarketTheme } from "./theme";
import type { MarketParams } from "./params";

/** Политика окна: ни сети, ни внешних файлов. Картинки и шрифты только встроенные */
export const MARKET_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

export type MarketBoot = { link: string | null; params: MarketParams; theme: MarketTheme };

/** Текст скрипта внутри <script>: закрывающий тег и начало HTML-комментария не должны сломать разбор страницы */
export function scriptText(code: string): string {
  return code.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function styleText(css: string): string {
  return css.replace(/<\/(style)/gi, "<\\/$1");
}

/** JSON внутри <script>: без «<» и разделителей строк, которые ломают разбор */
export function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Код страницы дашборда с файлами пакета внутри. Обёртка документа, мета-теги и base убираются: их задаёт окно */
export function inlinePage(html: string, files: Record<string, string>): string {
  const file = (src: string | null) => {
    if (src === null) return null;
    const name = src.replace(/^\.\//, "");
    return Object.prototype.hasOwnProperty.call(files, name) ? files[name]! : null;
  };
  // Разметка между скриптами чистится, текст встроенных скриптов не трогается: в нём бывают строки с тегами
  const markup = (part: string) =>
    part
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
      .replace(/<(meta|base)\b[^>]*>/gi, "")
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
      .replace(/<link\b([^>]*)>/gi, (_whole, attrs: string) => {
        if (!/^stylesheet$/i.test(attr(attrs, "rel") ?? "")) return "";
        const css = file(attr(attrs, "href"));
        return css === null ? "" : `<style>${styleText(css)}</style>`;
      });
  const script = (whole: string, attrs: string) => {
    // Встроенный скрипт страницы остаётся как есть, подключённый по имени файла встаёт внутрь
    const src = attr(attrs, "src");
    if (src === null) return whole;
    const code = file(src);
    if (code === null) return "";
    const isModule = /^module$/i.test(attr(attrs, "type") ?? "");
    return `<script${isModule ? ' type="module"' : ""}>${scriptText(code)}</script>`;
  };
  let out = "";
  let at = 0;
  for (const m of html.matchAll(SCRIPT_ELEMENT)) {
    out += markup(html.slice(at, m.index)) + script(m[0], m[1] ?? "");
    at = m.index + m[0].length;
  }
  return out + markup(html.slice(at));
}

/** Полный документ окна */
export function buildSrcdoc(files: Record<string, string>, boot: MarketBoot): string {
  const index = files["index.html"] ?? "";
  const d3 = Object.prototype.hasOwnProperty.call(files, D3_FILE) ? files[D3_FILE]! : null;
  const config = { link: boot.link, params: boot.params, theme: boot.theme, palettes: MARKET_PALETTES };
  return [
    "<!doctype html>",
    `<html lang="ru" data-theme="${boot.theme === "dark" ? "dark" : "light"}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${MARKET_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${styleText(MARKET_THEME_CSS)}</style>`,
    `<script>window.__MARKET_BOOT__ = ${inlineJson(config)};</script>`,
    `<script>${scriptText(MARKET_RUNTIME_JS)}</script>`,
    d3 !== null ? `<script>${scriptText(d3)}</script>` : "",
    "</head>",
    "<body>",
    `<div id="dash-root">${inlinePage(index, files)}</div>`,
    "</body>",
    "</html>",
  ]
    .filter(Boolean)
    .join("\n");
}
