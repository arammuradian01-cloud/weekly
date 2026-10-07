import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, resetDatabase, sql } from "./helpers";

// Этап 21б: «Заблокирована» со ссылкой на человека или задачу, «Есть риск» с фразой, связи задач и передача задачи.
// Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-b-${name}.png`, fullPage: true });
}

async function revaTasks(): Promise<number[]> {
  const rows = await sql(
    `SELECT t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t.status = 'IN_PROGRESS' AND t."archivedAt" IS NULL ORDER BY t.number LIMIT 2`,
  );
  return rows.map((r) => Number(r.number));
}

async function setState(page: Page, label: string) {
  await page.getByRole("button", { name: /^Состояние: .*Изменить$/ }).first().click();
  await page.getByRole("menuitem", { name: label }).click();
}

test("блокировка ждёт человека, затем задачу; риск с фразой", async ({ page }) => {
  const [number, other] = await revaTasks();
  await enter(page, "Рева Тарас");
  await page.goto(`/tasks/${number}`);

  // Заблокирована: ждёт человека, ему уходит просьба
  await setState(page, "Заблокирована");
  const dialog = page.getByRole("dialog", { name: `Задача ${number} заблокирована` });
  await dialog.getByRole("radio", { name: "Ждёт человека" }).click();
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Выберите, кого ждёт задача");
  await dialog.getByLabel("Кого ждёт").selectOption("loginova");
  await dialog.getByLabel("Что нужно от человека").fill("Согласовать данные по убыткам");
  await dialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText(`Задача ${number} заблокирована, просьба ушла`)).toBeVisible();
  await expect(page.getByText("Ждёт ответа: Логинова Светлана")).toBeVisible();
  await expect(page.locator("li").filter({ hasText: "Согласовать данные по убыткам" }).getByText("Ждёт ответа")).toBeVisible();

  // Связь с другой задачей из блока связей
  await page.getByRole("button", { name: "Ждёт задачу" }).click();
  const link = page.getByRole("dialog", { name: `Задача ${number} ждёт задачу` });
  await link.getByLabel("Номер задачи").fill(String(number));
  await link.getByRole("button", { name: "Связать" }).click();
  await expect(link.getByRole("alert")).toContainText("сама себя");
  await link.getByLabel("Номер задачи").fill(String(other));
  await link.getByRole("button", { name: "Связать" }).click();
  await expect(page.getByText(`Задача ${number} ждёт задачу ${other}`)).toBeVisible();
  await expect(page.getByText("Эта задача ждёт")).toBeVisible();
  await shot(page, "blocked");

  // Есть риск: без фразы нельзя
  await setState(page, "Есть риск");
  const risk = page.getByRole("dialog", { name: `Задача ${number}: есть риск` });
  await risk.getByRole("button", { name: "Сохранить" }).click();
  await expect(risk.getByRole("alert")).toContainText("что вернёт задачу в график");
  await risk.getByLabel("Что вернёт задачу в график").fill("Договоримся с Логиновой о данных до пятницы");
  await risk.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Есть риск. Что вернёт задачу в график")).toBeVisible();
  await expect(page.getByText("Договоримся с Логиновой о данных до пятницы")).toBeVisible();
});

test("ответственный передаёт задачу коллеге с комментарием", async ({ page }) => {
  const [number] = await revaTasks();
  await enter(page, "Рева Тарас");
  await page.goto(`/tasks/${number}`);
  await page.getByRole("button", { name: "Передать" }).click();
  const dialog = page.getByRole("dialog", { name: `Передать задачу ${number}` });
  await dialog.getByLabel("Кому передать").selectOption("fatyanov");
  await dialog.getByRole("button", { name: "Передать" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Напишите, почему передаёте");
  await dialog.getByLabel("Почему передаёте").fill("Это зона КАСКО");
  await dialog.getByRole("button", { name: "Передать" }).click();
  await expect(page.getByText(`Задача ${number} передана: Евгений Ф.`)).toBeVisible();
  // Прежний ответственный остался соисполнителем, «Передать» у него больше нет
  await expect(page.getByRole("button", { name: "Передать" })).toHaveCount(0);
  await shot(page, "handover");
  const [{ owner }] = await sql(`SELECT p.slug AS owner FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE t.number = $1`, [number]);
  expect(owner).toBe("fatyanov");
});
