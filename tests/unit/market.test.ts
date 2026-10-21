// Этап 62: рынок КАСКО и ОСАГО. Проверка пакета рынка, параметры в адресе и сообщения окна, страница окна (srcdoc),
// среда window.dash на поддельном окне (node:vm), уровень доступа и пункт повестки. Пакет синтетический:
// tests/fixtures/market/bundle.json, цифры выдуманные
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { MARKET_MAX_BYTES, MarketBundleError, linkedFiles, parseBundle, validateBundle } from "@/lib/market/bundle";
import { cleanParams, readFrameMessage, searchFromState, stateFromSearch } from "@/lib/market/params";
import { MARKET_CSP, buildSrcdoc, inlineJson, inlinePage, scriptText } from "@/lib/market/srcdoc";
import { MARKET_RUNTIME_JS } from "@/lib/market/runtime";
import { MARKET_PALETTES, MARKET_THEME_CSS } from "@/lib/market/theme";
import { canSeeMarketWith, canUploadMarket, marketAccessOf, marketMeetingOf } from "@/lib/market/access";
import { marketAgendaNote, marketAgendaTitle } from "@/lib/market/meeting";
import { visibleGroups } from "@/components/shell/nav";
import { AGENDA_BLOCKS, blockOf } from "@/domain/meeting";

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

  it("сообщения окна по схеме, остальное отбрасывается", () => {
    expect(readFrameMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(readFrameMessage({ type: "height", height: 812.4 })).toEqual({ type: "height", height: 812 });
    expect(readFrameMessage({ type: "height", height: 1e9 })).toEqual({ type: "height", height: 20000 });
    expect(readFrameMessage({ type: "height", height: "800" })).toBeNull();
    expect(readFrameMessage({ type: "params", params: { gm: "prem", "x y": "1" } })).toEqual({ type: "params", params: { gm: "prem" } });
    expect(readFrameMessage({ type: "params", params: [] })).toBeNull();
    expect(readFrameMessage({ type: "link", link: "insurers" })).toEqual({ type: "link", link: "insurers" });
    expect(readFrameMessage({ type: "link", link: "javascript:alert(1)" })).toBeNull();
    expect(readFrameMessage({ type: "navigate", url: "https://example.com" })).toBeNull();
    expect(readFrameMessage("ready")).toBeNull();
    expect(readFrameMessage(null)).toBeNull();
  });
});

describe("страница окна", () => {
  const f = fixture();
  const doc = buildSrcdoc(f.files, { link: "osago", params: { metric: "prem" }, theme: "dark" });

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
  });

  it("закрывающий тег и HTML-комментарий в коде не ломают разбор страницы", () => {
    expect(scriptText('var s = "</script><script>alert(1)</script>"; var c = "<!--";')).toBe('var s = "<\\/script><script>alert(1)<\\/script>"; var c = "<\\!--";');
    expect(inlineJson({ q: "</script><b>" })).toBe('{"q":"\\u003c/script>\\u003cb>"}');
    const page = inlinePage('<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://example.com"><title>x</title><link rel="stylesheet" href="a.css"><link rel="icon" href="i.png"></head><body><p>Привет</p><script>var t = "<body>";</script><script src="a.js"></script></body></html>', {
      "a.js": "var x = '</script>';",
      "a.css": "p { color: red } </style>",
    });
    expect(page).toBe('<style>p { color: red } <\\/style></style><p>Привет</p><script>var t = "<body>";</script><script>var x = \'<\\/script>\';</script>');
  });
});

/** Поддельное окно для среды window.dash: сообщения родителю, таймеры по команде, события */
function fakeWindow(boot: Record<string, unknown>) {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
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
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) }, getElementById: (id: string) => (id === "dash-root" ? root : null), body: root },
    addEventListener: (type: string, cb: (e: unknown) => void) => (listeners[type] ??= []).push(cb),
    setTimeout: (cb: () => void) => timers.push(cb),
    clearTimeout: () => undefined,
    history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => ((win.location as { href: string }).href = url) },
    location: { href: "about:srcdoc" },
    console: { error: () => undefined },
  };
  vm.runInNewContext(MARKET_RUNTIME_JS, { window: win });
  const flush = () => {
    for (let i = 0; i < 50 && timers.length; i++) timers.shift()!();
  };
  const fromParent = (data: unknown) => (listeners.message ?? []).forEach((cb) => cb({ source: parent, data }));
  type Res = { status: string; data: Record<string, unknown>[]; error?: string };
  const dash = win.dash as { calc: (n: string, s: unknown) => void; data: (n: string) => Res; onData: (cb: () => void) => () => void; params: () => Record<string, unknown>; setParams: (p: unknown) => void; setLink: (t: unknown) => void; colors: string[] };
  return { win, dash, posted, flush, fromParent, listeners, attrs };
}

describe("среда window.dash", () => {
  const rows = [
    { region: "Север", cnt: 10 },
    { region: "Юг", cnt: 20 },
  ];

  it("до данных всё загружается, после init наборы и расчёты готовы, расчёт один раз до смены данных", () => {
    const w = fakeWindow({ link: "osago", params: { metric: "prem", bad: { x: 1 } }, theme: "light", palettes: MARKET_PALETTES });
    // Вкладка из адреса стоит в location.hash до кода дашборда, окно просит данные
    expect((w.win.location as { href: string }).href).toBe("about:srcdoc#osago");
    expect(w.posted[0]).toEqual({ type: "ready" });
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
    // Высота содержимого ушла родителю
    expect(w.posted).toContainEqual({ type: "height", height: 481 });
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
    const w = fakeWindow({ params: { gm: "cnt" } });
    let draws = 0;
    w.dash.onData(() => draws++);
    w.fromParent({ type: "init", version: 1, datasets: { k_demo: rows } });
    w.flush();
    w.dash.setParams({ geo: "top4", bad: () => 1 });
    w.dash.setParams({ geo: "top4" });
    w.flush();
    expect(w.dash.params()).toEqual({ gm: "cnt", geo: "top4" });
    expect(w.posted.filter((m) => m.type === "params")).toEqual([{ type: "params", params: { gm: "cnt", geo: "top4" } }]);
    expect(draws).toBe(2);
    w.dash.setLink("o-insurers");
    w.dash.setLink("javascript:alert(1)");
    expect(w.posted.filter((m) => m.type === "link")).toEqual([{ type: "link", link: "o-insurers" }]);
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
});

describe("доступ к рынку", () => {
  const access = marketAccessOf({ people: ["reva", "reva", 5] });

  it("владелец и люди из списка, только при личном входе и включённом профиле", () => {
    expect(access).toEqual({ people: ["reva"] });
    expect(canSeeMarketWith({ slug: "muradyan", role: "OWNER", via: "PASSWORD" }, access)).toBe(true);
    expect(canSeeMarketWith({ slug: "muradyan", role: "OWNER", via: "TEAM" }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "muradyan", role: "OWNER", via: null }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "reva", role: "EMPLOYEE", via: "EMAIL" }, access)).toBe(true);
    expect(canSeeMarketWith({ slug: "reva", role: "EMPLOYEE", via: "INVITE", active: false }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "golovkin", role: "ADMIN", via: "PASSWORD" }, access)).toBe(false);
    expect(canSeeMarketWith({ slug: "loginova", role: "LEADER", via: "PASSWORD" }, access)).toBe(false);
  });

  it("загружает владелец при личном входе; команды встречи по умолчанию топ-команда", () => {
    expect(canUploadMarket({ role: "OWNER", via: "PASSWORD" })).toBe(true);
    expect(canUploadMarket({ role: "OWNER", via: "TEAM" })).toBe(false);
    expect(canUploadMarket({ role: "ADMIN", via: "PASSWORD" })).toBe(false);
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
