// Токены оформления (этап 10): экраны берут цвета, размеры шрифта и тени только из globals.css.
// Тест не даёт вернуть зашитые значения: новый дизайн меняет токены, а не сотни мест в экранах.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANIMATIONS, CONTAINERS, LEADINGS, RADII, SHADOWS, TEXT_ROLES, TEXT_SIZES } from "@/lib/design-tokens";
import { cn } from "@/lib/cn";

const css = readFileSync("src/app/globals.css", "utf8");
const tokens = readFileSync("src/styles/tokens.css", "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : files(path);
    return /\.(tsx|ts)$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN: [RegExp, string][] = [
  [/\btext-\[\d+(\.\d+)?(px|rem)\]/, "размер шрифта числом: возьмите text-caption, text-body и другие из globals.css"],
  [/-\[#[0-9a-fA-F]{3,8}\]/, "цвет числом в классе: заведите токен --color-* в globals.css"],
  [/\bshadow-\[/, "тень числами: возьмите shadow-menu, shadow-modal и другие"],
  [/\banimate-\[/, "анимация числами: возьмите animate-fade-in и другие"],
  [/\bleading-\[/, "межстрочный интервал числом: заведите токен --leading-*"],
];

/** Где цвет числом уместен: образец компонентов показывает значения, браузеру нужен цвет шапки (layout) и цвета приложения на экране «Домой» (manifest, этап 26) */
const HEX_ALLOWED = new Set(["src/components/ui-sample/ui-sample.tsx", "src/app/layout.tsx", "src/app/manifest.ts"]);

describe("токены оформления", () => {
  it("каждая роль шрифта из списка ведёт к роли дизайн-системы с тем же размером и своим межстрочным", () => {
    for (const [name, px] of Object.entries(TEXT_SIZES)) {
      // Имя Tailwind ссылается на роль токенов, и у роли в tokens.css стоит именно этот размер для ноутбука
      const m = new RegExp(`--text-${name}: var\\(--text-([a-z-]+)\\);`).exec(css);
      expect(m, `--text-${name}`).not.toBeNull();
      const role = m![1]!;
      expect(tokens, `роль ${role}`).toMatch(new RegExp(`--text-${role}: ${px}px;`));
      expect(css, `межстрочный ${name}`).toMatch(new RegExp(`--text-${name}--line-height: var\\(--leading-${role}\\);`));
      expect(TEXT_ROLES[role], `роль ${role} в списке`).toBeDefined();
      expect(tokens).toMatch(new RegExp(`--leading-${role}: ${TEXT_ROLES[role]!.leading}px;`));
    }
    for (const name of SHADOWS) expect(css).toMatch(new RegExp(`--shadow-${name}: `));
    for (const name of RADII) expect(css).toMatch(new RegExp(`--radius-${name}: `));
    for (const name of LEADINGS) expect(css).toMatch(new RegExp(`--leading-${name}: `));
    for (const name of CONTAINERS) expect(css).toMatch(new RegExp(`--container-${name}: `));
    for (const name of ANIMATIONS) expect(css).toMatch(new RegExp(`--animate-${name}: `));
  });

  it("в экранах нет зашитых размеров, цветов, теней и анимаций", () => {
    const problems: string[] = [];
    for (const file of files("src")) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const [re, hint] of FORBIDDEN) if (re.test(line)) problems.push(`${file}:${i + 1}: ${hint}`);
        const code = line.replace(/\/\/.*$/, "");
        if (!HEX_ALLOWED.has(file) && /["'`][^"'`]*#[0-9a-fA-F]{6}\b/.test(code)) problems.push(`${file}:${i + 1}: цвет числом в коде: заведите токен`);
      });
    }
    expect(problems).toEqual([]);
  });

  it("склейка классов знает свои размеры: размер не теряется рядом с цветом", () => {
    expect(cn("text-caption text-muted")).toBe("text-caption text-muted");
    expect(cn("text-caption", "text-body")).toBe("text-body");
    expect(cn("shadow-menu", "shadow-modal")).toBe("shadow-modal");
    expect(cn("max-w-page", "max-w-md")).toBe("max-w-md");
    expect(cn("text-headline font-semibold sm:text-hero")).toBe("text-headline font-semibold sm:text-hero");
    expect(cn("rounded-lg", "rounded-control")).toBe("rounded-control");
  });
});
