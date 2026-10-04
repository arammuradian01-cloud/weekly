import "dotenv/config";
import { defineConfig } from "@playwright/test";

// Сквозные тесты идут на отдельной базе: E2E_DATABASE_URL, по умолчанию weekly_e2e рядом с рабочей
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? (process.env.DATABASE_URL ?? "postgresql://localhost:5432/weekly").replace(/\/[^/?]+(\?|$)/, "/weekly_e2e$1");
const PORT = 3100;

process.env.E2E_DATABASE_URL = E2E_DATABASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "laptop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    // Готовность по robots.txt: тестовая база создаётся в globalSetup уже после старта сервера
    url: `http://localhost:${PORT}/robots.txt`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: "e2e-secret-0123456789-0123456789-abcdef",
      APP_URL: `http://localhost:${PORT}`,
      TRUST_PROXY: "false",
      SETUP_TOKEN: "e2e-setup-token-0123456789",
    },
  },
});
