import { expect, test } from "@playwright/test";
import { E2E_PASSWORDS } from "./global-setup";
import { resetDatabase } from "./helpers";

// Доска: перетаскивание своей карточки мышью меняет статус, отмена возвращает
test.beforeEach(async () => {
  await resetDatabase();
});

test("ответственный перетаскивает свою карточку в другую колонку", async ({ page }, info) => {
  test.skip(info.project.name === "phone", "на телефоне карточку двигают долгим нажатием, проверяем на ноутбуке");
  await page.goto("/login");
  await page.getByLabel("Логин").fill("team");
  await page.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByRole("button", { name: /Фатьянов Евгений/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/tasks/board");
  await page.getByRole("button", { name: "Только мои" }).click();

  const card = page.getByRole("button", { name: /^Задача 13:/ });
  const target = page.getByRole("region", { name: /^Требует уточнений: 0/ });
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();

  await expect(page.getByRole("region", { name: /^Требует уточнений: 1/ }).getByRole("button", { name: /^Задача 13:/ })).toBeVisible();
  await expect(page).not.toHaveURL(/task=/);
  await page.getByRole("status").getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByRole("region", { name: /^Требует уточнений: 0/ })).toBeVisible();
});
