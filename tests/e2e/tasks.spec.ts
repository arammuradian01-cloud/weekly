import { expect, test } from "@playwright/test";
import { enter, enterManagement, resetDatabase } from "./helpers";

// Этап 3: задачи живут в базе. Правка видна после перезагрузки и другому человеку, права проверяет сервер

test.beforeEach(async () => {
  await resetDatabase();
});

test("«где сейчас» сохраняется в базе и попадает в историю задачи", async ({ page }) => {
  await enter(page, "Фатьянов Евгений");
  await page.goto("/tasks/13");
  await page.getByLabel("Где сейчас").fill("Встреча с ВСК назначена на 07.10");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("«Где сейчас» обновлено");

  await page.reload();
  await expect(page.getByLabel("Где сейчас")).toHaveValue("Встреча с ВСК назначена на 07.10");
  await page.getByRole("radio", { name: /История/ }).click();
  await expect(page.getByText("Встреча с ВСК назначена на 07.10").last()).toBeVisible();
  await expect(page.getByText("Задача перенесена из Insurance&Invest Bord")).toBeVisible();
});

test("предложенную лидером задачу принимает администратор в режиме управления", async ({ page, browser }) => {
  await enter(page, "Логинова Светлана");
  await page.goto("/tasks");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Новая задача" });
  await dialog.getByLabel("Задача", { exact: true }).fill("Сверить тарифы ВЗР с партнёрами");
  await dialog.getByLabel("Что нужно сделать").fill("Таблица тарифов по трём партнёрам");
  await dialog.getByLabel("Ответственный").selectOption("sakhibullina");
  await dialog.getByRole("button", { name: "Предложить задачу" }).click();
  await expect(page).toHaveURL(/task=52/);

  // Второй человек в другом браузере видит задачу из базы и подтверждает её
  const admin = await (await browser.newContext()).newPage();
  await enter(admin, "Головкин Владислав");
  await enterManagement(admin, "admin");
  await admin.goto("/tasks/52");
  await expect(admin.getByRole("heading", { name: /Сверить тарифы ВЗР с партнёрами/ })).toBeVisible();
  await admin.getByRole("button", { name: "Принять в работу" }).click();
  await expect(admin.getByRole("button", { name: /^Статус: В работе/ })).toBeVisible();
  await admin.close();

  await page.reload();
  await expect(page.getByRole("dialog").getByText("В работе").first()).toBeVisible();
});

test("тот, кто поставил задачу, меняет её название и добавляет ссылку", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/tasks");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Новая задача" });
  await dialog.getByLabel("Задача", { exact: true }).fill("Отчёт по ошибкам СК");
  await dialog.getByLabel("Что нужно сделать").fill("Таблица ошибок по каждой СК");
  await dialog.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(page).toHaveURL(/task=52/);

  const card = page.getByRole("dialog");
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Изменить задачу 52" });
  await edit.getByLabel("Задача", { exact: true }).fill("Отчёт по ошибкам СК в разрезе сегментов");
  await edit.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /Отчёт по ошибкам СК в разрезе сегментов/ })).toBeVisible();

  await page.getByRole("button", { name: "Добавить ссылку" }).click();
  await page.getByLabel("Адрес").fill("https://datalens.example/errors");
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(page.getByRole("link", { name: "datalens.example" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: "datalens.example" })).toBeVisible();
});

test("чужую задачу лидер не меняет: на экране только чтение", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/tasks/13");
  await expect(page.getByRole("button", { name: /^Статус:/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Перенести срок" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Изменить", exact: true })).toHaveCount(0);
  // История чужой задачи лидеру не видна (матрица раздела 2)
  await page.getByRole("radio", { name: /История/ }).click();
  await expect(page.getByText("История видна участникам задачи")).toBeVisible();
});

test("владелец отправляет задачу в архив и возвращает", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/tasks/4");
  await page.getByRole("button", { name: "В архив" }).click();
  await expect(page.getByText("Задача в архиве: её видит только владелец.")).toBeVisible();
  await page.getByRole("button", { name: "Вернуть из архива" }).click();
  await expect(page.getByRole("button", { name: "В архив" })).toBeVisible();
});
