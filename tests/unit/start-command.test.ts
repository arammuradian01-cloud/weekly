import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Запуск контейнера на маленьком сервере (1 ядро, 1 ГБ): без npx и TypeScript на старте, куча сайта ограничена
const dockerfile = readFileSync("Dockerfile", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string>; devDependencies: Record<string, string> };
const cmd = (JSON.parse(dockerfile.match(/^CMD (\[.*\])$/m)![1]!) as string[])[2]!;

describe("команда запуска контейнера", () => {
  it("не компилирует TypeScript и не зовёт npx", () => {
    expect(cmd).not.toMatch(/\bnpx\b/);
    expect(cmd).not.toMatch(/\btsx\b/);
  });

  it("шаги идут по порядку: подготовка, миграции с пределом времени, стартовые данные, сайт", () => {
    const steps = ["dist/start/scripts/migrate-prepare.mjs", "timeout -k 10 ${MIGRATE_TIMEOUT}", "prisma/build/index.js migrate deploy", "dist/start/prisma/seed.mjs", "next/dist/bin/next start"];
    const at = steps.map((s) => cmd.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("собранные скрипты лежат там, куда смотрит команда запуска", () => {
    const build = pkg.scripts["build:start"]!;
    expect(build).toContain("scripts/migrate-prepare.ts");
    expect(build).toContain("prisma/seed.ts");
    expect(build).toContain("--outdir=dist/start");
    expect(build).toContain("--out-extension:.js=.mjs");
    expect(pkg.devDependencies.esbuild).toBeTruthy();
    expect(dockerfile).toMatch(/npm run build \\\n\s+&& npm run build:start/);
  });

  it("куча сайта ограничена, предел задаётся переменной", () => {
    expect(dockerfile).toMatch(/NODE_HEAP_MB=\d+/);
    expect(cmd).toContain('NODE_OPTIONS="--max-old-space-size=${NODE_HEAP_MB}" exec node');
  });
});
