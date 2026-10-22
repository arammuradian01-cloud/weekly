import { serverActionOrigins } from "./src/lib/app-origins.mjs";

// За чужим прокси (например, GitHub Codespaces) Next.js отклоняет отправку форм с другого домена.
// Разрешённые домены задаются переменной SERVER_ACTIONS_ALLOWED_ORIGINS через запятую.
// Этап 69: сюда же сами попадают хосты адресов ресурса, основного из APP_URL и дополнительных из APP_ALIASES (только
// точные адреса http и https, шаблоны со звёздочкой отбрасываются). Обычно Next и без них видит адрес запроса в Host
// или X-Forwarded-Host, но если прокси хостинга подменит заголовок, формы на своём домене не начнут отказывать.
// Конфиг читается при запуске сервера, поэтому новые переменные действуют после перезапуска
const allowedOrigins = serverActionOrigins(process.env);

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // next dev не дописывает в репозиторий свои AGENTS.md и CLAUDE.md
  agentRules: false,
  // Предел тела запроса для proxy не поднимаем: обработчик загрузки пакета рынка (этап 62) исключён из proxy
  // (src/proxy.ts) и сам проверяет вход, права и размер до чтения тела
  experimental: {
    ...(allowedOrigins.length ? { serverActions: { allowedOrigins } } : {}),
  },
  serverExternalPackages: ["pg", "pg-boss", "nodemailer"],
  // Прежние адреса страниц про людей (до этапа 41): постоянное перенаправление на страницу «Люди» до отрисовки,
  // параметры адреса (?team=) переносятся сами
  async redirects() {
    return [
      { source: "/team", destination: "/people", permanent: true },
      { source: "/my-teams", destination: "/people/leader", permanent: true },
      { source: "/structure", destination: "/people/structure", permanent: true },
      { source: "/analytics", destination: "/people/analytics", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Ресурс закрыт от поисковиков и не встраивается в чужие страницы
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        // Служебный обработчик (этап 26): браузер всегда проверяет свежую версию, иначе после выкладки жил бы старый
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
