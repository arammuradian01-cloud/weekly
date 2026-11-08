import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/unit/setup-people.ts"],
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 20000,
  },
});
