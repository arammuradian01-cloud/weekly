// Среда окна дашборда рынка (этап 62). Код дашборда написан для среды артефакта и ждёт объект window.dash:
// dash.calc регистрирует расчёт по наборам данных, dash.data(name) отдаёт набор или расчёт со статусом,
// dash.onData подписывает на перерисовку, dash.params и dash.setParams держат фильтры, dash.setLink вкладку,
// dash.colors палитру. Здесь эта среда собрана заново: строка JavaScript встаёт в srcdoc изолированного окна
// перед кодом дашборда.
//
// Как работает:
// - данные приходят от родителя сообщением {type:"init", version, datasets, params, link, theme} в ответ на ready;
//   до него всё «loading». Вкладка, фильтры и тема в init текущие: после перезагрузки документа окна вернутся они,
//   а не те, что вшиты в srcdoc при его сборке;
// - расчёт считается лениво при первом обращении и хранится до смены данных; исключение в расчёте даёт «error»;
// - setParams сливает фильтры, перерисовывает через подписчиков onData и сообщает родителю: он пишет их в адрес;
// - setLink сообщает родителю вкладку; при открытии окна вкладка из адреса ставится в location.hash до кода дашборда;
// - высоту содержимого окно сообщает родителю ({type:"height"}), ResizeObserver следит за изменениями;
// - смена ширины окна перерисовывает графики; тема приходит сообщением {type:"theme"};
// - каждое сообщение родителю несёт одноразовую метку окна (nonce из __MARKET_BOOT__) и случайный номер документа:
//   родитель читает только сообщения со своей меткой и отдаёт данные каждому документу один раз. Среда запоминает
//   метку и убирает её из объекта __MARKET_BOOT__, но в тексте встроенного скрипта страницы окна она остаётся: метка
//   отсекает чужие окна и страницу, на которую окно ушло бы по ссылке, а не код самого пакета;
// - окно никуда не уходит по ссылкам: щелчок по ссылке не на якорь (#...) гасится, window.open ничего не открывает.
// Родитель принимает сообщения только от этого окна и проверяет их схему. Окно без allow-same-origin: у него
// непрозрачный источник, cookies и API приложения ему недоступны, сеть закрыта политикой CSP.
//
// Код написан как функция от window: в браузере она вызывается сразу, в тестах на поддельном окне (node:vm).
// Синтаксис ES2019 без сборки: строка попадает в окно как есть.

export const MARKET_RUNTIME_FACTORY = String.raw`function (win) {
  "use strict";
  var doc = win.document;
  var boot = win.__MARKET_BOOT__ || {};
  // Метка окна: из объекта загрузочных данных убирается (в тексте встроенного скрипта она остаётся)
  var nonce = typeof boot.nonce === "string" ? boot.nonce : "";
  try {
    delete boot.nonce;
  } catch (e) {}
  var docId = randomId();
  var KEY = /^[A-Za-z0-9_]{1,40}$/;
  var LINK = /^[A-Za-z0-9_-]{1,60}$/;
  var palettes = boot.palettes || {};
  var theme = boot.theme === "dark" ? "dark" : "light";
  var colors = (palettes[theme] || []).slice();
  var datasets = null;
  var version = null;
  var calcs = Object.create(null);
  var cache = Object.create(null);
  var busy = Object.create(null);
  var listeners = [];
  var redrawTimer = 0;
  var heightTimer = 0;
  var lastHeight = -1;
  var lastWidth = win.innerWidth || 0;
  var resizeTimer = 0;
  var pings = 0;
  var pingTimer = 0;

  function clean(raw) {
    var out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    var keys = Object.keys(raw).slice(0, 50);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var v = raw[k];
      if (!KEY.test(k)) continue;
      if (typeof v === "string") out[k] = v.slice(0, 200);
      else if ((typeof v === "number" && isFinite(v)) || typeof v === "boolean" || v === null) out[k] = v;
    }
    return out;
  }

  var params = clean(boot.params);
  var link = typeof boot.link === "string" && LINK.test(boot.link) ? boot.link : "";

  function randomId() {
    var out = "";
    try {
      var bytes = new Uint8Array(12);
      win.crypto.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
    } catch (e) {
      while (out.length < 24) out += Math.random().toString(36).slice(2);
      out = out.replace(/[^a-z0-9]/g, "").slice(0, 24);
    }
    return out;
  }

  function post(msg) {
    msg.nonce = nonce;
    msg.doc = docId;
    try {
      win.parent.postMessage(msg, "*");
    } catch (e) {}
  }

  function report(what, e) {
    try {
      if (win.console) win.console.error("Рынок: " + what, e);
    } catch (x) {}
  }

  function loading() {
    return { status: "loading", data: [], rows: [] };
  }

  function failed(message) {
    return { status: "error", data: [], rows: [], error: message };
  }

  function compute(name) {
    var hit = cache[name];
    if (hit) return hit;
    if (busy[name]) return failed("Расчёт " + name + " ссылается сам на себя");
    busy[name] = true;
    var spec = calcs[name];
    var res = null;
    try {
      var args = [];
      for (var i = 0; i < spec.inputs.length; i++) {
        var input = data(spec.inputs[i]);
        if (input.status === "loading") {
          res = loading();
          break;
        }
        if (input.status !== "ok") {
          res = failed("Не посчитался вход " + spec.inputs[i]);
          break;
        }
        args.push(input.data);
      }
      if (!res) {
        var out = spec.fn.apply(null, args);
        res = Array.isArray(out) ? { status: "ok", data: out, rows: out } : failed("Расчёт " + name + " вернул не список строк");
      }
    } catch (e) {
      report("расчёт " + name + " не прошёл", e);
      res = failed(String((e && e.message) || e));
    }
    busy[name] = false;
    if (res.status !== "loading") cache[name] = res;
    return res;
  }

  function data(name) {
    name = String(name);
    if (datasets === null) return loading();
    if (Object.prototype.hasOwnProperty.call(datasets, name)) {
      var rows = datasets[name];
      return { status: "ok", data: rows, rows: rows };
    }
    if (calcs[name]) return compute(name);
    return failed("Нет набора данных " + name);
  }

  function calc(name, spec) {
    if (!spec || typeof spec.fn !== "function") throw new Error("dash.calc(" + name + "): нужна функция fn");
    calcs[String(name)] = {
      inputs: Array.isArray(spec.inputs) ? spec.inputs.map(String) : [],
      fn: spec.fn,
      title: String(spec.title || name),
      description: String(spec.description || "")
    };
    cache = Object.create(null);
  }

  function fire() {
    redrawTimer = 0;
    if (datasets === null) return;
    var list = listeners.slice();
    for (var i = 0; i < list.length; i++) {
      try {
        list[i]();
      } catch (e) {
        report("перерисовка не прошла", e);
      }
    }
    measureSoon();
  }

  function redrawSoon() {
    if (!redrawTimer) redrawTimer = win.setTimeout(fire, 0);
  }

  function onData(cb) {
    if (typeof cb !== "function") return function () {};
    listeners.push(cb);
    if (datasets !== null) redrawSoon();
    return function () {
      listeners = listeners.filter(function (x) {
        return x !== cb;
      });
    };
  }

  function same(a, b) {
    var ka = Object.keys(a);
    var kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false;
    return true;
  }

  function getParams() {
    var out = {};
    for (var k in params) out[k] = params[k];
    return out;
  }

  function setParams(patch) {
    var next = getParams();
    var add = clean(patch);
    for (var k in add) next[k] = add[k];
    if (same(next, params)) return;
    params = next;
    post({ type: "params", params: getParams() });
    redrawSoon();
  }

  function setHash(value) {
    try {
      win.history.replaceState(win.history.state, "", String(win.location.href).split("#")[0] + "#" + value);
    } catch (e) {
      try {
        win.location.hash = value;
      } catch (x) {}
    }
  }

  /** Вкладка от родителя после перезагрузки документа: в адрес окна и событием hashchange для кода дашборда */
  function showLink(value) {
    link = value;
    setHash(value);
    try {
      win.dispatchEvent(new win.HashChangeEvent("hashchange"));
    } catch (e) {}
  }

  function setLink(value) {
    value = String(value == null ? "" : value);
    if (!LINK.test(value)) return;
    link = value;
    setHash(value);
    post({ type: "link", link: value });
  }

  function measure() {
    heightTimer = 0;
    var root = doc.getElementById("dash-root") || doc.body;
    if (!root) return;
    var rect = root.getBoundingClientRect();
    var height = Math.ceil(rect.bottom + (win.scrollY || 0));
    if (Math.abs(height - lastHeight) < 1) return;
    lastHeight = height;
    post({ type: "height", height: height });
  }

  function measureSoon() {
    if (!heightTimer) heightTimer = win.setTimeout(measure, 30);
  }

  function applyTheme(next) {
    theme = next === "dark" ? "dark" : "light";
    doc.documentElement.setAttribute("data-theme", theme);
    var list = palettes[theme] || [];
    colors.length = 0;
    for (var i = 0; i < list.length; i++) colors.push(list[i]);
  }

  function ping() {
    if (datasets !== null || pings >= 30) return;
    pings++;
    post({ type: "ready" });
    pingTimer = win.setTimeout(ping, 400);
  }

  win.addEventListener("message", function (event) {
    if (event.source !== win.parent) return;
    var msg = event.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "init") {
      if (!msg.datasets || typeof msg.datasets !== "object") return;
      if (datasets !== null && msg.version === version) return;
      datasets = msg.datasets;
      version = msg.version;
      cache = Object.create(null);
      if (msg.params && typeof msg.params === "object") params = clean(msg.params);
      if (msg.theme === "dark" || msg.theme === "light") applyTheme(msg.theme);
      if (typeof msg.link === "string" && LINK.test(msg.link) && msg.link !== link) showLink(msg.link);
      if (pingTimer) win.clearTimeout(pingTimer);
      redrawSoon();
    } else if (msg.type === "theme") {
      applyTheme(msg.theme);
      redrawSoon();
    }
  });

  win.addEventListener("resize", function () {
    var width = win.innerWidth || 0;
    if (width === lastWidth) return;
    lastWidth = width;
    if (resizeTimer) win.clearTimeout(resizeTimer);
    resizeTimer = win.setTimeout(function () {
      resizeTimer = 0;
      fire();
    }, 150);
  });

  // После своего load документ ещё раз просит данные: родитель отдаёт их только в ответ на ready с меткой
  win.addEventListener("load", function () {
    measureSoon();
    if (datasets === null) post({ type: "ready" });
  });

  // Окно никуда не уходит: ссылки только на якоря внутри страницы, новые окна не открываются
  function stayHere(event) {
    var t = event.target;
    var a = t && typeof t.closest === "function" ? t.closest("a, area") : null;
    if (!a) return;
    var href = a.getAttribute("href");
    if (href === null) href = a.getAttribute("xlink:href");
    if (href === null) return;
    if (String(href).charAt(0) !== "#") event.preventDefault();
  }
  doc.addEventListener("click", stayHere, true);
  doc.addEventListener("auxclick", stayHere, true);
  try {
    win.open = function () {
      return null;
    };
  } catch (e) {}

  if (typeof win.ResizeObserver === "function") {
    var observer = new win.ResizeObserver(measureSoon);
    var watch = function () {
      var root = doc.getElementById("dash-root");
      if (root) observer.observe(root);
      else win.setTimeout(watch, 50);
    };
    watch();
  }

  applyTheme(theme);
  if (link) setHash(link);

  win.dash = {
    calc: calc,
    data: data,
    onData: onData,
    params: getParams,
    setParams: setParams,
    setLink: setLink,
    colors: colors,
    version: function () {
      return version;
    }
  };
  ping();
  return win.dash;
}`;

/** Строка для окна: функция вызывается сразу на настоящем window */
export const MARKET_RUNTIME_JS = `(${MARKET_RUNTIME_FACTORY})(window);`;
