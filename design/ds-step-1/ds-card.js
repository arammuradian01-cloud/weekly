/* Загрузчик карточек дизайн-системы: подхватывает компоненты из .jsx напрямую (через Babel), без сборки.
   dsLoad(['components/core/Button.jsx', ...]) -> Promise<{Button, ...}>; пути относительно корня проекта. */
(function () {
  var cache = {};
  var root = (function () {
    var s = document.querySelector('script[src$="ds-card.js"]');
    var src = s ? s.getAttribute('src') : 'ds-card.js';
    return src.replace(/ds-card\.js$/, '');
  })();
  function norm(p) {
    var parts = [];
    p.split('/').forEach(function (seg) {
      if (seg === '..') parts.pop(); else if (seg !== '.' && seg !== '') parts.push(seg);
    });
    return parts.join('/');
  }
  function dir(p) { return p.split('/').slice(0, -1).join('/'); }
  function load(path) {
    path = norm(path);
    if (cache[path]) return cache[path];
    cache[path] = fetch(root + path).then(function (r) {
      if (!r.ok) throw new Error('Не загрузился ' + path);
      return r.text();
    }).then(function (code) {
      var out = Babel.transform(code, { presets: [['react', { runtime: 'classic' }], ['env', { modules: 'commonjs' }]], filename: path }).code;
      var deps = [];
      out.replace(/require\(["']([^"']+)["']\)/g, function (m, d) { deps.push(d); return m; });
      var local = deps.filter(function (d) { return d[0] === '.'; });
      return Promise.all(local.map(function (d) { return load(dir(path) + '/' + d); })).then(function (mods) {
        var map = {};
        local.forEach(function (d, i) { map[d] = mods[i]; });
        var module = { exports: {} };
        var req = function (d) {
          if (d === 'react') return window.React;
          if (d === 'react-dom' || d === 'react-dom/client') return window.ReactDOM;
          if (map[d]) return map[d];
          throw new Error('Неизвестный модуль ' + d + ' в ' + path);
        };
        new Function('require', 'module', 'exports', 'React', out)(req, module, module.exports, window.React);
        return module.exports;
      });
    });
    return cache[path];
  }
  window.dsLoad = function (paths) {
    return Promise.all(paths.map(load)).then(function (mods) {
      var all = {};
      mods.forEach(function (m) { Object.assign(all, m); });
      return all;
    });
  };
  window.dsMount = function (paths, render) {
    var el = document.getElementById('root');
    return window.dsLoad(paths).then(function (C) {
      ReactDOM.createRoot(el).render(render(C));
    }).catch(function (e) { el.textContent = String(e); console.error(e); });
  };
})();
