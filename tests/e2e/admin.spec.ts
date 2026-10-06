import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, statSync } from "node:fs";
import { E2E_PASSWORDS } from "./global-setup";
import { enter, enterManagement, resetDatabase } from "./helpers";

// Этап 5: настройки на сервере, права по ролям, журнал с фильтрами, архив, выгрузка в Excel. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  // Ширина из настроек проекта, а не window.innerWidth: на телефоне широкая страница растягивает окно и прокрутку не видно
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-a-${name}.png`, fullPage: true });
}

test("владелец добавляет человека, тот выбирает себя и сразу в команде", async ({ page, browser }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Люди и роли" })).toBeVisible();
  await page.getByRole("button", { name: "Добавить человека" }).click();
  await page.getByLabel("Фамилия и имя").fill("Новикова Анна");
  await page.getByLabel("Зона ответственности").fill("Ипотечное страхование");
  await page.locator("#new-person-dir").selectOption("red");
  await page.getByRole("button", { name: "Добавить в команду" }).click();
  await expect(page.getByText("Новикова Анна добавлен").first()).toBeVisible();
  await expect(page.getByText("Лидер. Ипотечное страхование")).toBeVisible();
  await shot(page, "settings-owner");

  // Новый человек виден в выборе ответственного у задачи без перезапуска сервера
  await page.goto("/tasks");
  await page.keyboard.press("n");
  const dialog = page.getByRole("dialog", { name: "Новая задача" });
  await expect(dialog.getByLabel("Ответственный").locator("option", { hasText: "Новикова Анна" })).toHaveCount(1);
  await page.keyboard.press("Escape");

  // Она выбирает себя на общем входе и видит свою неделю
  const anna = await (await browser.newContext()).newPage();
  await enter(anna, "Новикова Анна");
  await expect(anna.getByText(/Мой weekly за неделю/)).toBeVisible();
  await anna.close();

  // Выключенный человек пропадает из выбора себя
  await page.goto("/settings");
  await page.getByRole("button", { name: "Выключить: Новикова Анна" }).click();
  await expect(page.getByText("Новикова Анна выключен").first()).toBeVisible();
  const again = await (await browser.newContext()).newPage();
  await again.goto("/login");
  await again.getByLabel("Логин").fill("team");
  await again.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await again.getByRole("button", { name: "Войти" }).click();
  await expect(again).toHaveURL(/\/choose$/);
  await expect(again.getByRole("button", { name: /Новикова Анна/ })).toHaveCount(0);
  await again.close();
});

test("администратор правит справочник, лидер видит новое значение; людей и выгрузку администратор не видит", async ({ page, browser }) => {
  await enter(page, "Головкин Владислав");
  await enterManagement(page, "admin");
  await page.goto("/settings");
  await expect(page.getByText("Люди, роли, пароли и выгрузка данных открываются паролем владельца.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Люди и роли" })).toHaveCount(0);
  await page.getByLabel("Новое значение: Направления").fill("Страхование жизни");
  await page.getByLabel("Новое значение: Направления").press("Enter");
  await expect(page.getByText("«Страхование жизни» добавлено").first()).toBeVisible();
  await page.getByRole("button", { name: "Скрыть «КАСКО»" }).click();
  await expect(page.getByText("«КАСКО» скрыто").first()).toBeVisible();
  await shot(page, "settings-admin");

  // Выгрузка только у владельца: администратора возвращает на стартовый экран
  await page.goto("/settings/export");
  await expect(page).toHaveURL(/\/$/);

  const leader = await (await browser.newContext()).newPage();
  await enter(leader, "Рева Тарас");
  await leader.goto("/weekly/submit");
  await leader.getByRole("button", { name: "Добавить запись" }).click();
  const direction = leader.getByLabel("Направление");
  await expect(direction.locator("option", { hasText: "Страхование жизни" })).toHaveCount(1);
  await expect(direction.locator("option", { hasText: "КАСКО" })).toHaveCount(0);
  // Лидеру настройки и журнал закрыты
  for (const path of ["/settings", "/journal", "/ceo-report", "/sync"]) {
    await leader.goto(path);
    await expect(leader).toHaveURL(/\/$/);
  }
  await leader.close();
});

test("журнал: правка ритма недели видна с тем, что было и что стало; фильтры в адресе", async ({ page }) => {
  await enter(page, "Головкин Владислав");
  await enterManagement(page, "admin");
  await page.goto("/settings");
  await page.getByLabel("Без обновлений, дней").fill("21");
  await page.getByRole("button", { name: "Сохранить ритм недели" }).click();
  await expect(page.getByText("Ритм недели сохранён").first()).toBeVisible();

  await page.goto("/journal");
  await page.getByLabel("Тип события").selectOption("settings");
  await expect(page).toHaveURL(/kind=settings/);
  const row = page.getByText("было «14»").filter({ visible: true }).first();
  await expect(row).toBeVisible();
  await expect(page.getByText("Давно не обновлялась, дней").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("«21»").filter({ visible: true }).first()).toBeVisible();
  await page.getByLabel("Кто").selectOption("golovkin");
  await expect(page).toHaveURL(/who=golovkin/);
  await expect(page.getByText("Ритм недели").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "journal");

  // Источник «таблица»: перенос из Insurance&Invest Bord
  await page.goto("/journal?source=sheet&period=all");
  await expect(page.getByLabel("Источник")).toHaveValue("sheet");
  await expect(page.getByText("Задача перенесена из Insurance&Invest Bord").filter({ visible: true }).first()).toBeVisible();
});

test("архив: владелец видит задачи в архиве и возвращает их", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/tasks/13");
  await page.getByRole("button", { name: "В архив" }).first().click();
  await expect(page.getByText("Задача 13 в архиве").first()).toBeVisible();
  await page.goto("/tasks");
  await page.getByLabel(/^Архив \(1\)/).check();
  await expect(page.getByText("Задачи в архиве.")).toBeVisible();
  await expect(page.getByText("Договориться с ВСК о лучших условиях").filter({ visible: true }).first()).toBeVisible();
  await shot(page, "archive");
  await page.getByText("Договориться с ВСК о лучших условиях").filter({ visible: true }).first().click();
  await page.getByRole("button", { name: "Вернуть из архива" }).click();
  await expect(page.getByText("Задача 13 возвращена из архива").first()).toBeVisible();
});

test("владелец выгружает всё в Excel одним файлом", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Выгрузить всё в Excel" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^weekly-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const path = await download.path();
  expect(statSync(path).size).toBeGreaterThan(20_000);
  await page.goto("/journal?kind=settings");
  await expect(page.getByText("Выгрузка в Excel").filter({ visible: true }).first()).toBeVisible();
});

test("инструкция «Как работать» из меню и плашка пилота, которую включает владелец (этап 7)", async ({ page, browser }) => {
  // Лидер находит инструкцию в меню профиля, сроки в ней из настроек
  const leader = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await enter(leader, "Рева Тарас");
  await leader.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
  await leader.getByRole("menuitem", { name: "Как работать" }).click();
  await expect(leader).toHaveURL(/\/help$/);
  await expect(leader.getByRole("heading", { name: "Как работать в Weekly" })).toBeVisible();
  await expect(leader.getByText(/до понедельника 18:00 по Москве, встреча команды во вторник/)).toBeVisible();
  await expect(leader.getByText("Тестовый стенд.")).toBeVisible();
  await shot(leader, "help");

  // Владелец включает плашку пилота: у лидера она ведёт к инструкции
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Плашка над страницами" }).getByRole("radio", { name: "Пилот" }).click();
  await expect(page.getByText("Плашка сохранена")).toBeVisible();
  await leader.reload();
  await expect(leader.getByText("Пилот.")).toBeVisible();
  await expect(leader.getByText(/Замечания и ошибки присылайте владельцу ресурса \(Мурадян Арам\)/)).toBeVisible();
  await expect(leader.getByRole("link", { name: "Как работать" })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Плашка над страницами" }).getByRole("radio", { name: "Без плашки" }).click();
  await expect(page.getByText("Плашка сохранена")).toBeVisible();
  await leader.reload();
  await expect(leader.getByText("Пилот.")).toHaveCount(0);
  await expect(leader.getByText("Тестовый стенд.")).toHaveCount(0);
  await leader.close();
});

