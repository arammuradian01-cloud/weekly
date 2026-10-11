// Линтер в проверках (этап 38, М17): правила Next.js с упором на Core Web Vitals, TypeScript, хуки React и
// базовые правила доступности из конфига Next. Запускается в CI вместе с типами и тестами: npm run lint.
// Предупреждений не допускается (--max-warnings 0). Старые находки правил React Compiler записаны в
// eslint-suppressions.json: новые сверх записанного по файлу и правилу дают ошибку, а исправленные нужно убрать
// из файла командой npm run lint:prune, иначе линтер тоже падает. Так список старых находок только уменьшается.
// Новые записи в этот файл вручную (--suppress-all, --suppress-rule) не добавляем: новую находку исправляем.
// eslint-config-next обновлять вместе с next, версии совпадают
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Отключение правила, которое больше ничего не отключает, считается ошибкой
    linterOptions: { reportUnusedDisableDirectives: "error" },
    // Плагин TypeScript подключён для всех файлов, поэтому эти правила действуют и в .cjs
    rules: {
      // Подчёркивание в начале имени: переменная нарочно не используется (отбросить поле при разборе объекта)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // Выражения без действия: сейчас нарушений нет, держим так
      "@typescript-eslint/no-unused-expressions": "error",
    },
  },
  {
    // Те же расширения, что у плагинов Next: иначе файл .cjs уронит весь прогон («не найден плагин react-hooks»)
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // Зависимости эффектов: сейчас нарушений нет, держим так
      "react-hooks/exhaustive-deps": "error",
      // Правила React Compiler. Сам компилятор в проекте не включён, поэтому найденное здесь не поломки, а лишние
      // перерисовки и приёмы, которые компилятор не умеет. Новые находки запрещены, старые записаны в
      // eslint-suppressions.json и убираются по мере правки компонентов
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/refs": "error",
      "react-hooks/immutability": "error",
    },
  },
  {
    // В CommonJS require и есть способ подключения
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "next-env.d.ts",
    "src/generated/**",
    "design/**",
    "test-results/**",
    "playwright-report/**",
    ".tmp-upload/**",
    "coverage/**",
    ".local/**",
    "backups/**",
    "data/**",
  ]),
]);
