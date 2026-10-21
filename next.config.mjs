// За чужим прокси (например, GitHub Codespaces) Next.js отклоняет отправку форм с другого домена.
// Разрешённые домены задаются переменной SERVER_ACTIONS_ALLOWED_ORIGINS через запятую
const allowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
