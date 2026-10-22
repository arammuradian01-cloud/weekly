// Этап 62: рынок КАСКО и ОСАГО. Проверка пакета рынка, параметры в адресе и сообщения окна, страница окна (srcdoc),
// среда window.dash на поддельном окне (node:vm), уровень доступа и пункт повестки. Пакет синтетический:
// tests/fixtures/market/bundle.json, цифры выдуманные
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import type { NextConfig } from "next";
import { config as proxyConfig } from "@/proxy";
import { MARKET_MAX_BYTES, MarketBundleError, linkedFiles, parseBundle, validateBundle } from "@/lib/market/bundle";
import { cleanParams, createInitGate, marketNonce, readFrameMessage, searchFromState, stateFromSearch } from "@/lib/market/params";
import { MARKET_CSP, buildSrcdoc, inlineJson, inlinePage, scriptText } from "@/lib/market/srcdoc";
import { MARKET_RUNTIME_JS } from "@/lib/market/runtime";
import { MARKET_PALETTES, MARKET_THEME_CSS } from "@/lib/market/theme";
import { canSeeMarketWith, canUploadMarket, marketAccessOf, marketMeetingOf } from "@/lib/market/access";
import { marketAgendaNote, marketAgendaTitle } from "@/lib/market/meeting";
import { visibleGroups } from "@/components/shell/nav";
import { AGENDA_BLOCKS, blockOf } from "@/domain/meeting";

// Сборка шаблона proxy та же, что у самого Next (внутренняя функция, без описания типов)
const { getMiddlewareMatchers } = createRequire(import.meta.url)("next/dist/build/analysis/get-page-static-info") as {
  getMiddlewareMatchers: (matcher: string[], config: object) => { regexp: string }[];
};
const nextConfig = ((await import(pathToFileURL(join(process.cwd(), "next.config.mjs")).href)) as { default: NextConfig }).default;

const FIXTURE = readFileSync("tests/fixtures/market/bundle.json", "utf8");
const fixture = () => JSON.parse(FIXTURE) as Record<string, unknown> & { files: Record<string, string>; datasets: Record<string, { rows: unknown[] }> };
const rejects = (raw: unknown, message: RegExp) => {
  expect(() => validateBundle(raw)).toThrow(MarketBundleError);
  expect(() => validateBundle(raw)).toThrow(message);
};

describe("пакет рынка", () => {
  it("синтетический пакет проходит: файлы, наборы, строки", () => {
    const b = parseBundle(FIXTURE);
    expect(Object.keys(b.files).sort()).toEqual(["app.js", "d3.min.js", "index.html"]);
    expect(b.datasetsCount).toBe(2);
    expect(b.rowsTotal).toBe(6);
    expect(b.datasets.k_demo!.title).toBe("Проверочные договоры КАСКО");
  });

  it("не JSON, пустой файл и слишком большой файл", () => {
    expect(() => parseBundle("не json")).toThrow(/не читается как JSON/);
    expect(() => parseBundle("   ")).toThrow(/Файл пустой/);
    expect(() => parseBundle(FIXTURE, MARKET_MAX_BYTES + 1)).toThrow(/не больше 25 МБ/);
    // Метка порядка байт в начале файла не мешает
    expect(parseBundle(`\ufeff${FIXTURE}`).datasetsCount).toBe(2);
  });

  it("отметка и версия пакета", () => {
    rejects([], /Это не пакет рынка/);
    rejects({ ...fixture(), kind: "other" }, /нет отметки kind «weekly-market-bundle»/);
    rejects({ ...fixture(), version: 2 }, /Версия пакета 2 не поддерживается/);
  });

  it("код страницы: нужен index.html, имена файлов, подключённые файлы внутри пакета", () => {
    const f = fixture();
    rejects({ ...f, files: undefined }, /нужен раздел files/);
    rejects({ ...f, files: { "app.js": "1" } }, /нет страницы index\.html/);
    rejects({ ...f, files: { ...f.files, "../evil.js": "1" } }, /Имя файла «\.\.\/evil\.js» не подходит/);
    rejects({ ...f, files: { ...f.files, "data.json": "{}" } }, /Имя файла «data\.json» не подходит/);
    rejects({ ...f, files: { ...f.files, "x.js": 5 } }, /Файл x\.js: ожидается текст/);
    rejects({ ...f, files: { "index.html": '<script src="https://cdn.example/d3.js"></script>' } }, /внешний адрес https:\/\/cdn\.example\/d3\.js/);
    rejects({ ...f, files: { "index.html": '<script src="//cdn.example/x.js"></script>' } }, /внешний адрес/);
    rejects({ ...f, files: { "index.html": '<script src="ui.js"></script>' } }, /подключает ui\.js, а такого файла в пакете нет/);
    rejects({ ...f, files: { "index.html": '<link rel="stylesheet" href="a.css">' } }, /подключает a\.css/);
    // Библиотека графиков обязательна: дашборд вызывает d3.formatLocale уже в первом скрипте
    rejects({ ...f, files: { "index.html": f.files["index.html"], "app.js": f.files["app.js"] } }, /В пакете нет библиотеки графиков d3\.min\.js: без неё дашборд не откроется/);
    rejects({ ...f, files: { ...f.files, "d3.min.js": "  \n" } }, /нет библиотеки графиков d3\.min\.js/);
    // Строка с тегом внутри встроенного скрипта не считается подключением
    expect(linkedFiles('<script>const s = "<script src=x.js>";</script><script src="./app.js"></script>')).toEqual([{ tag: "script", src: "./app.js" }]);
  });

  it("наборы данных: имена, объекты, простые значения полей", () => {
    const f = fixture();
    rejects({ ...f, datasets: [] }, /нужен раздел datasets/);
    rejects({ ...f, datasets: {} }, /нет ни одного набора данных/);
    rejects({ ...f, datasets: { "K-Demo": { rows: [] } } }, /Имя набора «K-Demo» не подходит/);
    rejects({ ...f, datasets: { ["a".repeat(41)]: { rows: [] } } }, /не подходит/);
    rejects({ ...f, datasets: { k: { rows: {} } } }, /Набор k: rows должен быть списком строк/);
    rejects({ ...f, datasets: { k: { rows: [1] } } }, /Набор k, строка 1: ожидается объект/);
    rejects({ ...f, datasets: { k: { rows: [{ a: 1 }, { a: { b: 1 } }] } } }, /строка 2, поле a: допустимы текст, число/);
    rejects({ ...f, datasets: { k: { rows: [{ a: [1] }] } } }, /поле a/);
    rejects({ ...f, datasets: { k: { rows: JSON.parse('[{"__proto__": 1}]') } } }, /имя поля «__proto__» не принимается/);
    rejects({ ...f, datasets: { k: { title: 5, rows: [] } } }, /название \(title\) должно быть текстом/);
    // Без названия набор называется своим именем, пустой список строк допустим
    const ok = validateBundle({ ...f, datasets: { k: { rows: [{ a: null, b: true, c: "x", d: 1.5 }] }, empty: { rows: [] } } });
    expect(ok.datasets.k).toEqual({ title: "k", description: "", rows: [{ a: null, b: true, c: "x", d: 1.5 }] });
    expect(ok.rowsTotal).toBe(1);
  });
});

describe("адрес страницы и сообщения окна", () => {
  it("вкладка и фильтры из адреса и обратно, без лишнего", () => {
    const s = stateFromSearch({ tab: "o-insurers", gm: "cnt", geo: ["top4", "rest"], "bad key": "1", empty: "", x: undefined });
    expect(s).toEqual({ link: "o-insurers", params: { gm: "cnt", geo: "top4" } });
    expect(searchFromState(s)).toBe("?tab=o-insurers&geo=top4&gm=cnt");
    expect(stateFromSearch(new URLSearchParams("tab=%3Cscript%3E&q=%D0%B4%D0%B0"))).toEqual({ link: null, params: { q: "да" } });
    expect(searchFromState({ link: null, params: {} })).toBe("");
  });

  it("фильтры: короткие значения, понятные имена, вкладка отдельно", () => {
    expect(cleanParams({ a: "x".repeat(500), n: 5, b: true, z: null, o: { x: 1 }, tab: "kasko", "a-b": "1" })).toEqual({ a: "x".repeat(200), n: "5", b: "true" });
    expect(cleanParams(null)).toEqual({});
    expect(Object.keys(cleanParams(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "v"]))))).toHaveLength(40);
  });

  it("сообщения окна по схеме и с меткой окна, остальное отбрасывается", () => {
    const n = "a1b2";
    const read = (m: Record<string, unknown>) => readFrameMessage({ ...m, nonce: n }, n);
    expect(read({ type: "ready", doc: "d0c1d2e3f4" })).toEqual({ type: "ready", doc: "d0c1d2e3f4" });
    // ready без номера документа или с непонятным номером не читается
    expect(read({ type: "ready" })).toBeNull();
    expect(read({ type: "ready", doc: "x" })).toBeNull();
    expect(read({ type: "ready", doc: "<script>alert(1)" })).toBeNull();
    expect(read({ type: "height", height: 812.4 })).toEqual({ type: "height", height: 812 });
    expect(read({ type: "height", height: 1e9 })).toEqual({ type: "height", height: 20000 });
    expect(read({ type: "height", height: "800" })).toBeNull();
    expect(read({ type: "params", params: { gm: "prem", "x y": "1" } })).toEqual({ type: "params", params: { gm: "prem" } });
    expect(read({ type: "params", params: [] })).toBeNull();
    expect(read({ type: "link", link: "insurers" })).toEqual({ type: "link", link: "insurers" });
    expect(read({ type: "link", link: "javascript:alert(1)" })).toBeNull();
    expect(read({ type: "navigate", url: "https://example.com" })).toBeNull();
    expect(readFrameMessage("ready", n)).toBeNull();
    expect(readFrameMessage(null, n)).toBeNull();
    // Без метки, с чужой меткой или когда метки у родителя ещё нет: не читается
    expect(readFrameMessage({ type: "ready", doc: "d0c1d2e3f4" }, n)).toBeNull();
    expect(readFrameMessage({ type: "ready", doc: "d0c1d2e3f4", nonce: "other" }, n)).toBeNull();
    expect(readFrameMessage({ type: "ready", doc: "d0c1d2e3f4", nonce: 5 }, n)).toBeNull();
    expect(readFrameMessage({ type: "ready", doc: "d0c1d2e3f4", nonce: "" }, "")).toBeNull();
  });

  it("метка окна: 32 шестнадцатеричных знака, каждый раз новая", () => {
    const a = marketNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(marketNonce()).not.toBe(a);
  });

  it("данные окну только в ответ на ready с меткой: load без ready данных не даёт", () => {
    const gate = createInitGate();
    // Окно ушло по ссылке на чужую страницу: её load приходит, ready с меткой нет, данных нет
    expect(gate.load()).toBe(false);
    expect(gate.load()).toBe(false);
    expect(gate.ready("")).toBe(false);
    expect(gate.load()).toBe(false);
  });

  it("раз на цикл load и каждому документу окна один раз, повторные ready 5 МБ не дублируют", () => {
    const gate = createInitGate();
    // Первый документ просит данные, пока разбирается (до load): получает сразу
    expect(gate.ready("docA0001")).toBe(true);
    expect(gate.ready("docA0001")).toBe(false);
    expect(gate.load()).toBe(false);
    // Он же ещё раз, пока разбирает присланное: не дублируется
    expect(gate.ready("docA0001")).toBe(false);
    // Документ окна загрузился заново: новый документ получает данные один раз
    expect(gate.ready("docB0002")).toBe(true);
    expect(gate.ready("docB0002")).toBe(false);
    expect(gate.load()).toBe(false);
    expect(gate.ready("docB0002")).toBe(false);
    // В одном цикле load второй раз данные не уходят, после следующего load уходят
    expect(gate.ready("docC0003")).toBe(true);
    expect(gate.ready("docD0004")).toBe(false);
    expect(gate.load()).toBe(false);
    expect(gate.ready("docD0004")).toBe(true);
  });
});

describe("страница окна", () => {
  const f = fixture();
  const doc = buildSrcdoc(f.files, { link: "osago", params: { metric: "prem" }, theme: "dark", nonce: "n0nce" });

  it("сначала политика CSP, потом стили, среда, d3 и код страницы", () => {
    const at = (s: string) => doc.indexOf(s);
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${MARKET_CSP}">`);
    expect(MARKET_CSP).toContain("default-src 'none'");
    expect(at("Content-Security-Policy")).toBeLessThan(at("<script"));
    expect(at("--cds-gap-lg")).toBeLessThan(at("window.__MARKET_BOOT__"));
    expect(at("window.__MARKET_BOOT__")).toBeLessThan(at("win.dash = {"));
    expect(at("win.dash = {")).toBeLessThan(at("window.d3 = { stub: true }"));
    expect(at("window.d3 = { stub: true }")).toBeLessThan(at("dash.calc('k_total'"));
    expect(doc).toContain('<html lang="ru" data-theme="dark">');
  });

  it("файлы пакета встают внутрь страницы, внешних адресов нет, блок обновления спрятан", () => {
    expect(doc).not.toMatch(/<script[^>]*\bsrc=/i);
    expect(doc).toContain("dash.onData(draw)");
    expect(doc).toContain("#c-import, #go-imp");
    expect(doc).toContain('<div id="dash-root">');
    expect(doc).toContain('"palettes":');
    // Одноразовая метка окна в загрузочных данных
    expect(doc).toContain('"nonce":"n0nce"');
  });

  it("закрывающий тег и HTML-комментарий в коде не ломают разбор страницы", () => {
    expect(scriptText('var s = "</script><script>alert(1)</script>"; var c = "<!--";')).toBe('var s = "<\\/script><script>alert(1)<\\/script>"; var c = "<\\x21--";');
    expect(inlineJson({ q: "</script><b>" })).toBe('{"q":"\\u003c/script>\\u003cb>"}');
    const page = inlinePage('<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://example.com"><title>x</title><link rel="stylesheet" href="a.css"><link rel="icon" href="i.png"></head><body><p>Привет</p><script>var t = "<body>";</script><script src="a.js"></script></body></html>', {
      "a.js": "var x = '</script>';",
      "a.css": "p { color: red } </style>",
    });
    expect(page).toBe('<style>p { color: red } <\\/style></style><p>Привет</p><script>var t = "<body>";</script><script>var x = \'<\\/script>\';</script>');
  });

  it("замена «<!--» не меняет смысл кода: строка, регулярное выражение с флагом u и шаблон", () => {
    const run = (code: string) => vm.runInNewContext(scriptText(code));
    expect(scriptText("<!--")).not.toContain("<!--");
    expect(run('"<!--"')).toBe("<!--");
    expect(run("'a<!--b'")).toBe("a<!--b");
    expect(run("/<!--/u.test('x<!--y')")).toBe(true);
    expect(run("/^<!--$/.test('<!--')")).toBe(true);
    expect(run("/[<!--]/u.test('!')")).toBe(true);
    expect(run("`<!--${1 + 1}`")).toBe("<!--2");
    expect(run('"</script>"')).toBe("</script>");
    // Прежняя запись «<\\!--» в регулярном выражении с флагом u ломала код окна
    expect(() => vm.runInNewContext("/<\\!--/u")).toThrow(/Invalid regular expression/);
  });
});

/** Поддельное окно для среды window.dash: сообщения родителю, таймеры по команде, события */
function fakeWindow(boot: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const docListeners: Record<string, ((e: unknown) => void)[]> = {};
  const posted: Record<string, unknown>[] = [];
  const timers: (() => void)[] = [];
  const attrs: Record<string, string> = {};
  const parent = { postMessage: (m: Record<string, unknown>) => posted.push(JSON.parse(JSON.stringify(m))) };
  const root = { getBoundingClientRect: () => ({ bottom: 480.2 }) };
  const win: Record<string, unknown> = {
    __MARKET_BOOT__: boot,
    parent,
    innerWidth: 1000,
    scrollY: 0,
    document: {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
      getElementById: (id: string) => (id === "dash-root" ? root : null),
      body: root,
      addEventListener: (type: string, cb: (e: unknown) => void) => (docListeners[type] ??= []).push(cb),
    },
    addEventListener: (type: string, cb: (e: unknown) => void) => (listeners[type] ??= []).push(cb),
    setTimeout: (cb: () => void) => timers.push(cb),
    clearTimeout: () => undefined,
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => ((win.location as { href: string }).href = url) },
    location: { href: "about:srcdoc" },
    console: { error: () => undefined },
    ...extra,
  };
  vm.runInNewContext(MARKET_RUNTIME_JS, { window: win });
  const flush = () => {
    for (let i = 0; i < 50 && timers.length; i++) timers.shift()!();
  };
  const fromParent = (data: unknown) => (listeners.message ?? []).forEach((cb) => cb({ source: parent, data }));
  type Res = { status: string; data: Record<string, unknown>[]; error?: string };
  const dash = win.dash as { calc: (n: string, s: unknown) => void; data: (n: string) => Res; onData: (cb: () => void) => () => void; params: () => Record<string, unknown>; setParams: (p: unknown) => void; setLink: (t: unknown) => void; colors: string[] };
  return { win, dash, posted, flush, fromParent, listeners, docListeners, attrs };
}

describe("среда window.dash", () => {
  const rows = [
    { region: "Север", cnt: 10 },
    { region: "Юг", cnt: 20 },
  ];

  it("до данных всё загружается, после init наборы и расчёты готовы, расчёт один раз до смены данных", () => {
    const w = fakeWindow({ link: "osago", params: { metric: "prem", bad: { x: 1 } }, theme: "light", palettes: MARKET_PALETTES, nonce: "n1" });
    // Вкладка из адреса стоит в location.hash до кода дашборда, окно просит данные с меткой окна
    expect((w.win.location as { href: string }).href).toBe("about:srcdoc#osago");
    expect(w.posted[0]).toEqual({ type: "ready", nonce: "n1", doc: expect.stringMatching(/^[a-z0-9]{8,64}$/) });
    // Метка остаётся только в среде: в загрузочных данных её больше нет
    expect((w.win.__MARKET_BOOT__ as Record<string, unknown>).nonce).toBeUndefined();
    let calls = 0;
    w.dash.calc("total", { inputs: ["k_demo"], fn: (r: { cnt: number }[]) => (calls++, [{ cnt: r.reduce((s, x) => s + x.cnt, 0) }]) });
    expect(w.dash.data("total").status).toBe("loading");
    expect(w.dash.data("k_demo")).toEqual({ status: "loading", data: [], rows: [] });
    expect(w.dash.params()).toEqual({ metric: "prem" });
    let draws = 0;
    w.dash.onData(() => draws++);
    w.fromParent({ type: "init", version: 1, datasets: { k_demo: rows } });
    w.flush();
    expect(draws).toBe(1);
    expect(w.dash.data("k_demo")).toEqual({ status: "ok", data: rows, rows });
    expect(w.dash.data("total").data).toEqual([{ cnt: 30 }]);
    w.dash.data("total");
    expect(calls).toBe(1);
    expect(w.dash.data("nope")).toMatchObject({ status: "error" });
    // Тот же пакет повторно не перерисовывает, новый пересчитывает
    w.fromParent({ type: "init", version: 1, datasets: { k_demo: [] } });
    expect(w.dash.data("total").data).toEqual([{ cnt: 30 }]);
    w.fromParent({ type: "init", version: 2, datasets: { k_demo: [{ cnt: 1 }] } });
    expect(w.dash.data("total").data).toEqual([{ cnt: 1 }]);
    expect(calls).toBe(2);
    // Высота содержимого ушла родителю, каждое сообщение с меткой окна
    expect(w.posted).toContainEqual({ type: "height", height: 481, nonce: "n1", doc: w.posted[0]!.doc });
    expect(w.posted.every((m) => m.nonce === "n1" && m.doc === w.posted[0]!.doc)).toBe(true);
    // Каждый документ окна со своим номером; в браузере номер из crypto.getRandomValues
    expect(fakeWindow({ nonce: "n1" }).posted[0]!.doc).not.toBe(w.posted[0]!.doc);
    expect(fakeWindow({ nonce: "n1" }, { crypto: globalThis.crypto }).posted[0]!.doc).toMatch(/^[0-9a-f]{24}$/);
  });

  it("ошибка в расчёте и ответ не списком дают error, остальное работает", () => {
    const w = fakeWindow({});
    w.dash.calc("boom", { inputs: ["k_demo"], fn: () => {
      throw new Error("проверка");
    } });
    w.dash.calc("object", { inputs: ["k_demo"], fn: () => ({ a: 1 }) });
    w.dash.calc("chain", { inputs: ["boom"], fn: () => [] });
    w.dash.calc("ok", { inputs: ["k_demo", "object2"], fn: () => [] });
    expect(() => w.dash.calc("bad", {})).toThrow(/нужна функция fn/);
    w.fromParent({ type: "init", version: 1, datasets: { k_demo: rows } });
    expect(w.dash.data("boom")).toMatchObject({ status: "error", error: "проверка", data: [] });
    expect(w.dash.data("object")).toMatchObject({ status: "error" });
    expect(w.dash.data("chain")).toMatchObject({ status: "error" });
    expect(w.dash.data("ok")).toMatchObject({ status: "error" });
  });

  it("фильтры сливаются, перерисовывают и уходят родителю; вкладка уходит родителю", () => {
    const w = fakeWindow({ params: { gm: "cnt" }, nonce: "n2" });
    let draws = 0;
    w.dash.onData(() => draws++);
    w.fromParent({ type: "init", version: 1, datasets: { k_demo: rows } });
    w.flush();
    w.dash.setParams({ geo: "top4", bad: () => 1 });
    w.dash.setParams({ geo: "top4" });
    w.flush();
    expect(w.dash.params()).toEqual({ gm: "cnt", geo: "top4" });
    expect(w.posted.filter((m) => m.type === "params")).toMatchObject([{ type: "params", params: { gm: "cnt", geo: "top4" }, nonce: "n2" }]);
    expect(draws).toBe(2);
    w.dash.setLink("o-insurers");
    w.dash.setLink("javascript:alert(1)");
    expect(w.posted.filter((m) => m.type === "link")).toMatchObject([{ type: "link", link: "o-insurers", nonce: "n2" }]);
    expect((w.win.location as { href: string }).href).toBe("about:srcdoc#o-insurers");
  });

  it("сообщения не от родителя не читаются; тема меняет палитру на месте", () => {
    const w = fakeWindow({ theme: "light", palettes: MARKET_PALETTES });
    const colors = w.dash.colors;
    expect(colors[0]).toBe(MARKET_PALETTES.light[0]);
    (w.listeners.message ?? []).forEach((cb) => cb({ source: {}, data: { type: "init", version: 1, datasets: { k_demo: rows } } }));
    expect(w.dash.data("k_demo").status).toBe("loading");
    w.fromParent({ type: "theme", theme: "dark" });
    expect(w.dash.colors).toBe(colors);
    expect(colors).toEqual([...MARKET_PALETTES.dark]);
    expect(w.attrs["data-theme"]).toBe("dark");
  });

  it("после перезагрузки документа init возвращает текущие тему, вкладку и фильтры, а не вшитые в srcdoc", () => {
    // srcdoc собран со светлой темой, вкладкой kasko и фильтром cnt; человек с тех пор переключил всё
    const w = fakeWindow({ theme: "light", link: "kasko", params: { metric: "cnt" }, palettes: MARKET_PALETTES });
    expect((w.win.location as { href: string }).href).toBe("about:srcdoc#kasko");
    w.fromParent({ type: "init", version: 1, datasets: { k_demo: rows }, params: { metric: "prem" }, link: "osago", theme: "dark" });
    expect(w.attrs["data-theme"]).toBe("dark");
    expect(w.dash.colors).toEqual([...MARKET_PALETTES.dark]);
    expect(w.dash.params()).toEqual({ metric: "prem" });
    expect((w.win.location as { href: string }).href).toBe("about:srcdoc#osago");
    // Непонятные вкладка и тема не применяются
    const v = fakeWindow({ theme: "light", link: "kasko", palettes: MARKET_PALETTES });
    v.fromParent({ type: "init", version: 1, datasets: { k_demo: rows }, link: "javascript:alert(1)", theme: "neon" });
    expect(v.attrs["data-theme"]).toBe("light");
    expect((v.win.location as { href: string }).href).toBe("about:srcdoc#kasko");
  });

  it("после своего load документ ещё раз просит данные, если их ещё нет", () => {
    const w = fakeWindow({ nonce: "n3" });
    const before = w.posted.filter((m) => m.type === "ready").length;
    (w.listeners.load ?? []).forEach((cb) => cb({}));
    expect(w.posted.filter((m) => m.type === "ready")).toHaveLength(before + 1);
    w.fromParent({ type: "init", version: 1, datasets: { k_demo: rows } });
    (w.listeners.load ?? []).forEach((cb) => cb({}));
    expect(w.posted.filter((m) => m.type === "ready")).toHaveLength(before + 1);
  });

  it("окно никуда не уходит: щелчок по ссылке не на якорь гасится, window.open ничего не открывает", () => {
    const w = fakeWindow({});
    const click = (href: string | null, attr = "href") => {
      let prevented = false;
      const a = { getAttribute: (name: string) => (name === attr ? href : null) };
      const event = { target: { closest: (sel: string) => (sel === "a, area" ? a : null) }, preventDefault: () => (prevented = true) };
      for (const cb of w.docListeners.click ?? []) cb(event);
      return prevented;
    };
    expect(click("https://evil.example/steal")).toBe(true);
    expect(click("//evil.example")).toBe(true);
    expect(click("javascript:alert(1)")).toBe(true);
    expect(click("other.html")).toBe(true);
    expect(click("https://evil.example", "xlink:href")).toBe(true);
    // Якоря внутри страницы и ссылки без адреса работают как обычно
    expect(click("#osago")).toBe(false);
    expect(click(null)).toBe(false);
    // Щелчок не по ссылке не трогается
    let prevented = false;
    for (const cb of w.docListeners.click ?? []) cb({ target: { closest: () => null }, preventDefault: () => (prevented = true) });
    expect(prevented).toBe(false);
    // Средняя кнопка тоже
    expect(w.docListeners.auxclick).toHaveLength(1);
    expect((w.win.open as () => unknown)()).toBeNull();
  });
});

describe("оформление окна", () => {
  // Окно не видит стилей приложения: его токены повторяют tokens.css. Если токен приложения сменится, тест напомнит
  const tokens = readFileSync("src/styles/tokens.css", "utf8");
  const block = (selector: string) => tokens.slice(tokens.indexOf(selector), tokens.indexOf("}", tokens.indexOf(selector)));
  const value = (css: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim().toUpperCase();
  const frame = (theme: "light" | "dark") => {
    const css = MARKET_THEME_CSS;
    return theme === "light" ? css.slice(css.indexOf(":root {"), css.indexOf("@media")) : css.slice(css.indexOf(':root[data-theme="dark"]'));
  };
  const PAIRS: [string, string][] = [
    ["--color-bg", "--color-page"],
    ["--color-panel", "--color-surface"],
    ["--color-fg", "--color-text"],
    ["--color-fg-muted", "--color-text-secondary"],
    ["--color-ok", "--color-success-text"],
    ["--color-bad", "--color-danger-text"],
  ];

  it("цвета окна совпадают с токенами приложения в обеих темах, палитра начинается с рядов графиков", () => {
    for (const [theme, selector] of [["light", ":root {"], ["dark", '[data-theme="dark"] {']] as const) {
      const app = block(selector);
      for (const [mine, theirs] of PAIRS) expect(value(frame(theme), mine), `${theme} ${mine}`).toBe(value(app, theirs));
      expect(MARKET_PALETTES[theme][0]).toBe(value(app, "--color-chart-1"));
      expect(MARKET_PALETTES[theme][1]).toBe(value(app, "--color-chart-2"));
    }
  });

  it("заголовок дашборда в окне меньше заголовка страницы приложения (этап 59)", () => {
    const px = (css: string, name: string) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(css)?.[1]);
    const title = px(MARKET_THEME_CSS, "--cds-font-size-title");
    expect(title).toBeGreaterThan(0);
    // Первое значение --text-page в tokens.css: заголовок страницы на ноутбуке (28 px); на телефоне и проекторе свои
    expect(title).toBeLessThan(px(tokens, "--text-page"));
    // Правило сильнее стилей пакета: через #dash-root, и для заголовка первого уровня, и для .kx-title. В настоящем
    // пакете .kx-title это заголовок дашборда («Рынок КАСКО» под переключателем КАСКО и ОСАГО, serif, размер
    // заголовка), а не подпись плитки: уменьшается именно он
    expect(MARKET_THEME_CSS).toMatch(/#dash-root h1, #dash-root \.kx-title \{ font-size: var\(--cds-font-size-title\)/);
  });
});

describe("доступ к рынку", () => {
  const access = marketAccessOf({ people: ["reva", "reva", 5] });

  it("личный вход: владелец и люди из списка при включённом профиле", () => {
    expect(access).toEqual({ people: ["reva"] });
    expect(canSeeMarketWith({ slug: "muradyan", role: "OWNER", via: "PASSWORD" }, access)).toBe(true);
    expect(canSeeMarketWith({ slug: "muradyan", role: "OWNER", via: null }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "muradyan", role: "OWNER", via: undefined }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "reva", role: "EMPLOYEE", via: "EMAIL" }, access)).toBe(true);
    expect(canSeeMarketWith({ slug: "reva", role: "EMPLOYEE", via: "INVITE", active: false }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "golovkin", role: "ADMIN", via: "PASSWORD" }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "loginova", role: "LEADER", via: "PASSWORD" }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "ceo", role: "OBSERVER", via: "PASSWORD" }, access)).toBe(false);
    // Новый владелец без списка видит сразу: правило по роли, а не по списку
    expect(canSeeMarketWith({ slug: "golovkin", role: "OWNER", via: "PASSWORD" }, { people: [] })).toBe(true);
  });

  it("этап 72: общий логин видит раздел любым выбранным профилем, кроме выключенного", () => {
    for (const [slug, role] of [["muradyan", "OWNER"], ["reva", "LEADER"], ["loginova", "LEADER"], ["golovkin", "ADMIN"], ["ceo", "OBSERVER"], ["ivanov", "EMPLOYEE"]] as const) {
      expect(canSeeMarketWith({ slug, role, via: "TEAM" }, access), slug).toBe(true);
      expect(canSeeMarketWith({ slug, role, via: "TEAM" }, { people: [] }), slug).toBe(true);
    }
    expect(canSeeMarketWith({ slug: "loginova", role: "LEADER", via: "TEAM", active: false }, access)).toBe(false);
  });

  it("загружает владелец при личном входе; команды встречи по умолчанию топ-команда", () => {
    expect(canUploadMarket({ role: "OWNER", via: "PASSWORD" })).toBe(true);
    expect(canUploadMarket({ role: "OWNER", via: "EMAIL" })).toBe(true);
    // Общий логин раздел видит, но не загружает (этап 72 загрузку не меняет)
    expect(canUploadMarket({ role: "OWNER", via: "TEAM" })).toBe(false);
    expect(canUploadMarket({ role: "OWNER", via: null })).toBe(false);
    expect(canUploadMarket({ role: "ADMIN", via: "PASSWORD" })).toBe(false);
    expect(canUploadMarket({ role: "LEADER", via: "TEAM" })).toBe(false);
    expect(marketMeetingOf(undefined)).toEqual({ teamIds: ["top"] });
    expect(marketMeetingOf({ teamIds: [] })).toEqual({ teamIds: [] });
  });

  it("пункт меню «Рынок» только тем, кому открыт раздел", () => {
    const hrefs = (market: boolean) => visibleGroups({ market }).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(true)).toContain("/market");
    expect(hrefs(false)).not.toContain("/market");
    expect(hrefs(false)).toContain("/news");
  });
});

describe("пункт повестки", () => {
  it("итоги прошлого месяца, год только у январской встречи", () => {
    expect(marketAgendaTitle("2026-10-06")).toBe("Рынок КАСКО и ОСАГО: итоги сентября");
    expect(marketAgendaTitle("2027-01-05")).toBe("Рынок КАСКО и ОСАГО: итоги декабря 2026");
  });

  it("подпись говорит, свежие ли данные для этого месяца, без цифр", () => {
    expect(marketAgendaNote("2026-10-13", new Date("2026-10-02T07:00:00Z"))).toBe("Данные рынка от 2 октября.");
    expect(marketAgendaNote("2026-11-03", new Date("2026-10-31T22:30:00Z"))).toBe("Данные рынка от 1 ноября.");
    expect(marketAgendaNote("2026-11-03", new Date("2026-10-22T10:00:00Z"))).toBe("Свежий пакет рынка в этом месяце ещё не загружали: данные от 22 октября.");
  });

  it("пункт рынка в своём блоке первым", () => {
    expect(blockOf("market")).toBe("market");
    expect(AGENDA_BLOCKS[0]!.code).toBe("market");
  });
});

describe("загрузка пакета мимо proxy", () => {
  // Шаблон proxy так, как его собирает сам Next: загрузка пакета рынка идёт мимо proxy, остальное за входом
  const [compiled] = getMiddlewareMatchers(proxyConfig.matcher, {});
  const gated = new RegExp(compiled!.regexp);

  it("обработчик загрузки исключён из proxy, данные рынка и страницы по-прежнему за входом", () => {
    expect(gated.test("/api/market/upload")).toBe(false);
    expect(gated.test("/api/market/upload/")).toBe(false);
    for (const path of ["/api/market/data", "/api/market/uploads", "/api/market/upload-x", "/market", "/", "/me", "/api/events", "/settings"]) expect(gated.test(path), path).toBe(true);
  });

  it("предел тела для proxy по умолчанию: настройка убрана", () => {
    const experimental = (nextConfig.experimental ?? {}) as Record<string, unknown>;
    expect(experimental.proxyClientMaxBodySize).toBeUndefined();
    expect(experimental.middlewareClientMaxBodySize).toBeUndefined();
  });
});

describe("скрипт сборки пакета", () => {
  const SCRIPT = join(process.cwd(), "scripts", "market-bundle.mjs");
  const run = (args: string[]) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  /** Выгрузка дашборда-артефакта с выдуманными цифрами во временной папке вне репозитория */
  const exportDir = () => {
    const root = mkdtempSync(join(tmpdir(), "market-export-"));
    mkdirSync(join(root, "files"));
    mkdirSync(join(root, "datasets"));
    mkdirSync(join(root, "blobs"));
    writeFileSync(join(root, "files", "index.html"), "<p>Проверка</p>");
    writeFileSync(join(root, "datasets", "k_demo.json"), JSON.stringify({ title: "Проверка", source: { url: "/_blob/b1" } }));
    writeFileSync(join(root, "blobs", "b1.json"), JSON.stringify([{ cnt: 1 }]));
    writeFileSync(join(root, "d3.min.js"), "window.d3 = {};");
    return root;
  };

  it("--out внутри репозитория не принимается, и через ссылку на папку тоже; вне репозитория пакет собирается", () => {
    const src = exportDir();
    try {
      const inside = join(process.cwd(), "market-bundle-test.json");
      const r1 = run([src, "--out", inside, "--d3", join(src, "d3.min.js")]);
      expect(r1.status).toBe(1);
      expect(r1.stderr).toContain("внутри репозитория");
      expect(r1.stderr).toContain("цифры рынка не должны попасть в git");
      expect(existsSync(inside)).toBe(false);
      // Ссылка вне репозитория, ведущая в репозиторий
      const link = join(src, "repo-link");
      symlinkSync(process.cwd(), link);
      const r2 = run([src, "--out", join(link, "tests", "market-bundle-test.json"), "--d3", join(src, "d3.min.js")]);
      expect(r2.status).toBe(1);
      expect(r2.stderr).toContain("внутри репозитория");
      expect(existsSync(join(process.cwd(), "tests", "market-bundle-test.json"))).toBe(false);

      // Папка с именем, похожим на выход наверх («..данные»), внутри репозитория: тоже внутри
      const dotted = join(process.cwd(), "..market-bundle-test");
      mkdirSync(dotted, { recursive: true });
      try {
        const r3 = run([src, "--out", join(dotted, "bundle.json"), "--d3", join(src, "d3.min.js")]);
        expect(r3.status).toBe(1);
        expect(r3.stderr).toContain("внутри репозитория");
        expect(existsSync(join(dotted, "bundle.json"))).toBe(false);
      } finally {
        rmSync(dotted, { recursive: true, force: true });
      }
      // --out уже существует и это ссылка (вне репозитория, ведёт в репозиторий): запись пошла бы по ссылке, отказ
      const target = join(process.cwd(), "tests", "market-bundle-link-target.json");
      const outLink = join(src, "out-link.json");
      symlinkSync(target, outLink);
      const r4 = run([src, "--out", outLink, "--d3", join(src, "d3.min.js")]);
      expect(r4.status).toBe(1);
      expect(r4.stderr).toContain("это ссылка");
      expect(existsSync(target)).toBe(false);

      const out = join(src, "bundle.json");
      const ok = run([src, "--out", out, "--d3", join(src, "d3.min.js")]);
      expect(ok.status, ok.stderr).toBe(0);
      const b = parseBundle(readFileSync(out, "utf8"));
      expect(Object.keys(b.files).sort()).toEqual(["d3.min.js", "index.html"]);
      expect(b.rowsTotal).toBe(1);
    } finally {
      rmSync(src, { recursive: true, force: true });
    }
  });
});
