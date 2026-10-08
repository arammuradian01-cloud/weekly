/* Служебный обработчик ресурса Weekly (этап 26, модуль М11).
 *
 * - Уведомления в браузере: показывает «кто и что» и открывает предмет по нажатию.
 * - Без сети: вместо пустого экрана показывает страницу «Нет сети».
 * - Страницы с данными и ответы сервера НЕ кэшируются: на общем устройстве после выхода чужие данные не всплывут.
 *   Кэшируются только неизменяемые файлы сборки (в имени отпечаток содержимого), шрифты, значки и страница «Нет сети».
 */

const VERSION = "weekly-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/badge-96.png", "/logo/sravni_sign.svg"];
/** Файлы сборки меняются с каждой выкладкой: держим только последние, старые вытесняются */
const MAX_STATIC = 250;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Неизменяемые файлы сборки Next: отпечаток содержимого в имени, шрифты */
function isBuild(url) {
  return url.pathname.startsWith("/_next/static/");
}

/** Значки и логотип: имя не меняется, поэтому показываем из кэша и тут же обновляем */
function isBrand(url) {
  return url.pathname.startsWith("/icons/") || url.pathname.startsWith("/logo/");
}

async function trim(cache) {
  const keys = await cache.keys();
  const build = keys.filter((k) => new URL(k.url).pathname.startsWith("/_next/static/"));
  // Порядок ключей: порядок добавления. Удаляем самые старые
  for (const k of build.slice(0, Math.max(0, build.length - MAX_STATIC))) await cache.delete(k);
}

const offlinePage = () =>
  caches.match(OFFLINE_URL).then((hit) => hit || new Response("Нет сети", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Переход по странице: всегда в сеть. Сети нет: страница «Нет сети», а не ошибка браузера
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(offlinePage));
    return;
  }

  if (isBuild(url) || isBrand(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const fresh = fetch(request).then(async (res) => {
          if (res.ok) {
            await cache.put(request, res.clone());
            if (isBuild(url)) await trim(cache);
          }
          return res;
        });
        if (hit) {
          // Значки обновляются в фоне, файлы сборки не меняются вовсе
          if (isBrand(url)) event.waitUntil(fresh.catch(() => undefined));
          return hit;
        }
        return fresh;
      }),
    );
  }
  // Остальное (данные, действия, живые обновления) идёт мимо: браузер сам ходит в сеть
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Weekly";
  const options = {
    body: data.body || "Новое событие в «Мне»",
    tag: data.tag || "inbox",
    renotify: true,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    lang: "ru",
    data: { url: data.url || "/me" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/me", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Ресурс уже открыт: переходим в той же вкладке, не плодим окна
      for (const client of list) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          // Вкладка не под обработчиком (жёсткая перезагрузка): перейти в ней нельзя, открываем новую
          return client
            .focus()
            .then((c) => (c && "navigate" in c ? c.navigate(target.href) : null))
            .then((c) => c || self.clients.openWindow(target.href))
            .catch(() => self.clients.openWindow(target.href));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
