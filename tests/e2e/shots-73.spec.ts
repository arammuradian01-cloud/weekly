import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 73: снимки экранов weekly для разбора «было и стало». Не проверка, а фотоаппарат: путь к папке задаёт SHOTS73_DIR.
// Ноутбук 1440 и телефон 360, данные e2e сида.

const DIR = process.env.SHOTS73_DIR ?? "test-results/shots-73";
mkdirSync(DIR, { recursive: true });

async function snap(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.screenshot({ path: `${DIR}/${test.info().project.name}-${name}.png`, fullPage: true });
}

function monday(): string {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("снимки weekly", async ({ page, browser }) => {
  test.setTimeout(300_000);
  await enter(page, "Головкин Владислав");
  await page.goto("/weekly");
  await snap(page, "01-feed");
  await page.getByRole("radio", { name: "По блокам" }).click().catch(() => undefined);
  await snap(page, "02-feed-blocks");
  await page.goto("/weekly?week=2026-09-14");
  await snap(page, "03-feed-38");
  await page.goto("/weekly/meeting");
  await snap(page, "04-meeting");
  const [entry] = await sql(`SELECT id FROM weekly_entries ORDER BY "createdAt" LIMIT 1`);
  await page.goto(`/weekly/entry/${entry!.id}`);
  await snap(page, "05-entry");
  await page.goto("/weekly/submit");
  await page.getByLabel("Главное одной фразой").fill("Договорились с двумя дилерами о пилоте");
  await page.getByRole("button", { name: "Добавить запись" }).click();
  await page.getByLabel("Что произошло").fill("Два дилера готовы к пилоту в ноябре");
  await page.getByRole("button", { name: "Сохранить запись" }).click();
  await page.waitForTimeout(1500);
  await snap(page, "06-submit");
  await page.goto("/weekly/team-report");
  await snap(page, "07-team-report");

  const owner = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: test.info().project.name === "phone", hasTouch: test.info().project.name === "phone" })).newPage();
  await enterByLink(owner, "muradyan");
  await enterManagement(owner, "owner");
  await owner.goto("/weekly");
  await snap(owner, "08-feed-owner");
  await owner.goto(`/ceo-report?week=${monday()}`);
  await snap(owner, "09-ceo-report");
  await owner.goto("/weekly/meeting");
  await snap(owner, "10-meeting-owner");
  await owner.emulateMedia({ colorScheme: "dark" });
  await owner.goto("/weekly?week=2026-09-21");
  await snap(owner, "11-feed-dark");
  await owner.close();
});
