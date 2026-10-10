// Линтер в проверках (этап 38, М17): правила Next.js с упором на Core Web Vitals, TypeScript, хуки React и
// доступность. Запускается в CI вместе с типами и тестами: npm run lint
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Подчёркивание в начале имени: переменная нарочно не используется (отбросить поле при разборе объекта)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // Правила React Compiler. Сам компилятор в проекте не включён, поэтому найденное здесь не ошибки, а лишние
      // перерисовки и приёмы, которые компилятор не умеет. Это предупреждения с бюджетом в npm run lint: новых не
      // добавляем, старые убираем по мере правки компонентов
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "next-env.d.ts", "src/generated/**", "design/**", "test-results/**", "playwright-report/**", ".tmp-upload/**", "coverage/**", ".local/**"]),
]);
