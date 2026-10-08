import type { MetadataRoute } from "next";

/**
 * Приложение на экране «Домой» (этап 26, модуль М11). Открывается без адресной строки, как отдельное приложение.
 * Файл открыт без входа: браузер запрашивает его без cookie
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Weekly · Страхование и инвестиции",
    short_name: "Weekly",
    description: "Weekly, задачи и просьбы команды «Страхование и инвестиции»",
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6f5f4",
    theme_color: "#002a3a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Мне", short_name: "Мне", url: "/me", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Сдать weekly", short_name: "Weekly", url: "/weekly/submit", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Мои задачи", short_name: "Задачи", url: "/tasks/mine", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
