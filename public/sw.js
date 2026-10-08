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

/** Неизменяемые файлы: сборка Next с отпечатком в имени, шрифты, значки, логотип */
function isStatic(url) {
  return url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/logo/"));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Переход по странице: всегда в сеть. Сети нет: страница «Нет сети», а не ошибка браузера
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (isStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
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
          return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target.href) : undefined));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
