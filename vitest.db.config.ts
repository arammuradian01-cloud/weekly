import "dotenv/config";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Тесты правил задач на настоящей PostgreSQL: отдельная база weekly_test рядом с рабочей
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? (process.env.DATABASE_URL ?? "postgresql://localhost:5432/weekly").replace(/\/[^/?]+(\?|$)/, "/weekly_test$1");

process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    // Одна база на всех: файлы идут по очереди
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      SESSION_SECRET: "db-test-secret-0123456789-0123456789-abcdef",
      BORD_IMPORT: "off",
    },
  },
});
