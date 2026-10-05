// За чужим прокси (например, GitHub Codespaces) Next.js отклоняет отправку форм с другого домена.
// Разрешённые домены задаются переменной SERVER_ACTIONS_ALLOWED_ORIGINS через запятую
const allowedOrigins = (process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  experimental: allowedOrigins.length ? { serverActions: { allowedOrigins } } : {},
  serverExternalPackages: ["pg", "pg-boss"],
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
    ];
  },
};

export default nextConfig;
