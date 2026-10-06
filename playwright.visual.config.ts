// Проверка «вид не изменился» (этап 10): снимки всех экранов до правки оформления и сравнение по пикселям после.
// npm run test:visual -- --update-snapshots   снять эталон на текущем коде (например, на main перед правкой)
// npm run test:visual                         сравнить с эталоном
// Эталоны лежат в tests/visual/__screenshots__ и в репозиторий не попадают: шрифты и сглаживание зависят от машины.
import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testDir: "tests/visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixels: 0, animations: "disabled", caret: "hide" } },
});
