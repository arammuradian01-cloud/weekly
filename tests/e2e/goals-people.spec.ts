import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, resetDatabase, sql } from "./helpers";

// Цели по сотрудникам: карточки по людям, «Мои цели», выбор нескольких людей и цели без владельца. Отбор живёт в адресе
// (?people=slug,slug и ?group=team), переживает перезагрузку и смену квартала, а выбранных, которых в новом квартале нет,
// не остаётся. Данные выдуманы. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const Q4 = "2026-Q4";
const Q3 = "2026-Q3";
const Q2 = "2026-Q2";
const TEAM = "Команда страхования и инвестиций";
const phone = () => test.info().project.name === "phone";

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  // Q4: у Арама две цели, у Влада одна, одна без владельца. Q3: Влада нет. Q2: ни у одной цели нет владельца
  await sql(`INSERT INTO goals (id, quarter, code, title, "teamId", "ownerId", "updatedAt")
    SELECT 'gp-' || v.code, v.quarter, v.code, v.title, 'top', p.id, now()
    FROM (VALUES
      ('${Q4}', 'M1', 'Маржа моей команды', 'muradyan'),
      ('${Q4}', 'M2', 'Конверсия моей команды', 'muradyan'),
      ('${Q4}', 'G1', 'Маржа партнёров', 'golovkin'),
      ('${Q4}', 'N1', 'Общая цель без владельца', NULL),
      ('${Q3}', 'S1', 'Итоги третьего квартала', 'muradyan'),
      ('${Q3}', 'S2', 'Общая цель третьего квартала', NULL),
      ('${Q2}', 'O1', 'Цель второго квартала без владельца', NULL)
    ) v(quarter, code, title, slug)
    LEFT JOIN people p ON p.slug = v.slug`);
});

const who = (page: Page) => page.getByRole("radiogroup", { name: "Чьи цели" });
const radio = (page: Page, name: string | RegExp) => who(page).getByRole("radio", { name });
const picked = (page: Page) => radio(page, /^Выбранные/);
const goalCards = (page: Page) => page.getByTestId("goals-cards").locator("li[id^=goal-]");
const shown = (page: Page) => page.getByTestId("goals-shown");
const item = (page: Page, name: string | RegExp) => page.getByRole("menu").getByRole("menuitemcheckbox", { name });

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("цели разделены по людям, мои и несколько сотрудников сочетаются с поиском, таблица читает тот же отбор", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto(`/goals?q=${Q4}`);
  const cards = page.getByTestId("goals-cards");

  // Группы по людям: по алфавиту, «Без владельца» последней
  await expect(cards.getByRole("heading", { level: 3 })).toHaveText([/^Головкин Владислав/, /^Мурадян Арам/, /^Без владельца/]);
  const mine = cards.getByRole("region", { name: /Мурадян Арам/ });
  const other = cards.getByRole("region", { name: /Головкин Владислав/ });
  await expect(mine.getByTestId("goal-card-gp-M1")).toBeVisible();
  await expect(mine.getByTestId("goal-card-gp-M2")).toBeVisible();
  await expect(mine.getByTestId("goal-card-gp-G1")).toHaveCount(0);
  await expect(other.getByTestId("goal-card-gp-G1")).toBeVisible();
  await expect(cards.getByRole("region", { name: /Без владельца/ }).getByTestId("goal-card-gp-N1")).toBeVisible();
  await expect(radio(page, "Все сотрудники")).toHaveAttribute("aria-checked", "true");
  await expect(shown(page)).toHaveText("Показано целей: 4 из 4");

  // Группа уже называет владельца, поэтому в карточке его нет, а команда есть
  await expect(mine.getByTestId("goal-card-gp-M1")).not.toContainText("Мурадян Арам");
  await expect(mine.getByTestId("goal-card-gp-M1")).toContainText(TEAM);

  // «Мои цели»: взаимоисключающее состояние, адрес и счётчик обновились
  await radio(page, "Мои цели").click();
  await expect(radio(page, "Мои цели")).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "Все сотрудники")).toHaveAttribute("aria-checked", "false");
  await expect(goalCards(page)).toHaveCount(2);
  await expect(other).toHaveCount(0);
  await expect(shown(page)).toHaveText("Показано целей: 2 из 4");
  await expect(page).toHaveURL(/people=muradyan/);
  await page.getByLabel("Поиск цели").fill("маржа");
  await expect(goalCards(page)).toHaveCount(1);

  // «Выбранные» открывают меню; Мурадян уже отмечен, добавляем Головкина
  await picked(page).click();
  await expect(item(page, "Мурадян Арам")).toBeChecked();
  await item(page, "Головкин Владислав").click();
  await expect(item(page, "Головкин Владислав")).toBeChecked();
  await expect(item(page, "Мурадян Арам")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(picked(page)).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "Мои цели")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("goals-people-selected")).toHaveText("Выбраны: Головкин Владислав, Мурадян Арам");
  await expect(page.getByLabel("Поиск цели")).toHaveValue("маржа");
  await expect(goalCards(page)).toHaveCount(2);
  await expect(other).toBeVisible();
  await expect(page).toHaveURL(/people=muradyan,golovkin/);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-goals-people.png`, fullPage: true });
  await noHorizontalScroll(page);

  // Таблица берёт тот же отбор и тот же порядок групп
  await page.getByRole("radiogroup", { name: "Вид", exact: true }).getByRole("radio", { name: "Таблица", exact: true }).click();
  await expect(page.getByTestId("goal-row-M1")).toBeVisible();
  await expect(page.getByTestId("goal-row-G1")).toBeVisible();
  await expect(page.getByTestId("goal-row-M2")).toHaveCount(0);
  await page.getByLabel("Поиск цели").fill("");
  await expect(page.getByTestId("goal-row-M2")).toBeVisible();
  await expect(page.getByTestId("goal-row-N1")).toHaveCount(0);
  await expect(page.getByTestId("goals-table").getByRole("row", { name: /: целей \d+$/ })).toHaveText(["Головкин Владислав: целей 1", "Мурадян Арам: целей 2"]);
  await radio(page, "Все сотрудники").click();
  await expect(page.getByTestId("goal-row-N1")).toBeVisible();
  // «Без владельца» последней и в таблице
  await expect(page.getByTestId("goals-table").getByRole("row", { name: /: целей \d+$/ })).toHaveText(["Головкин Владислав: целей 1", "Мурадян Арам: целей 2", "Без владельца: целей 1"]);

  // По командам: группа называется командой, а в карточке остаётся владелец, команды в ней нет
  await page.getByRole("radiogroup", { name: "Группы" }).getByRole("radio", { name: "По командам" }).click();
  await expect(page.getByTestId("goals-table").getByRole("row", { name: `${TEAM}: целей 4` })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Вид", exact: true }).getByRole("radio", { name: "Карточки", exact: true }).click();
  const team = page.getByTestId("goals-cards").getByRole("region", { name: new RegExp(TEAM) });
  await expect(team.getByTestId("goal-card-gp-M1")).toContainText("Мурадян Арам");
  await expect(team.getByTestId("goal-card-gp-M1")).not.toContainText(TEAM);
  await expect(page).toHaveURL(/group=team/);
});

test("клавиатура в меню выбора: открыть, переходить по людям, отмечать пробелом и Enter, Escape возвращает фокус", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto(`/goals?q=${Q4}`);
  const trigger = picked(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  // «Очистить выбор» при пустом выборе недоступен: Home ведёт к первому человеку по алфавиту
  await expect(page.getByRole("menuitem", { name: "Очистить выбор" })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Home");
  await expect(item(page, "Головкин Владислав")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "Мурадян Арам")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(item(page, "Мурадян Арам")).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, /^Без владельца/)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(item(page, /^Без владельца/)).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/people=muradyan,_none/);
  await expect(goalCards(page)).toHaveCount(3);
  await expect(page.getByTestId("goals-people-selected")).toHaveText("Выбраны: Мурадян Арам, Без владельца");

  // Снова открыть и очистить выбор пунктом меню: меню закрывается, видны все цели, адрес чистый
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Очистить выбор" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(radio(page, "Все сотрудники")).toHaveAttribute("aria-checked", "true");
  await expect(goalCards(page)).toHaveCount(4);
  await expect(page).not.toHaveURL(/people=/);
});

test("отбор и группировка в адресе: ссылка, перезагрузка и «Назад» возвращают тот же вид", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  // Ссылка с готовым отбором
  await page.goto(`/goals?q=${Q4}&people=golovkin,muradyan&group=team`);
  await expect(picked(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("goals-people-selected")).toHaveText("Выбраны: Головкин Владислав, Мурадян Арам");
  await expect(page.getByRole("radiogroup", { name: "Группы" }).getByRole("radio", { name: "По командам" })).toHaveAttribute("aria-checked", "true");
  await expect(goalCards(page)).toHaveCount(3);
  await expect(page.getByTestId("goals-cards").getByRole("heading", { level: 3 })).toHaveText([new RegExp(`^${TEAM}`)]);

  // Свой выбор попадает в адрес и переживает перезагрузку
  await radio(page, "Все сотрудники").click();
  await expect(page).not.toHaveURL(/people=/);
  await radio(page, "Мои цели").click();
  await expect(page).toHaveURL(/people=muradyan/);
  await expect(page).toHaveURL(/group=team/);
  await page.reload();
  await expect(radio(page, "Мои цели")).toHaveAttribute("aria-checked", "true");
  await expect(goalCards(page)).toHaveCount(2);
  await expect(shown(page)).toHaveText("Показано целей: 2 из 4");

  // «Назад» и «Вперёд»: адрес и экран остаются согласованными. Выбор меняется без новой записи в истории,
  // поэтому «Назад» уходит с экрана, а «Вперёд» возвращает на него с тем же отбором
  await page.goto("/tasks");
  await page.goBack();
  await expect(page).toHaveURL(/people=muradyan/);
  await expect(radio(page, "Мои цели")).toHaveAttribute("aria-checked", "true");
  await expect(goalCards(page)).toHaveCount(2);

  // Слаг из ссылки, которого нет среди владельцев целей, молча отбрасывается
  await page.goto(`/goals?q=${Q4}&people=reva`);
  await expect(radio(page, "Все сотрудники")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("goals-people-selected")).toHaveCount(0);
  await expect(goalCards(page)).toHaveCount(4);
});

test("у человека нет целей в квартале: «Мои цели» выключены с пояснением, остальное работает", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto(`/goals?q=${Q4}`);
  const mine = radio(page, "Мои цели");
  await expect(mine).toBeDisabled();
  await expect(mine).toHaveAttribute("title", "У вас нет целей в этом квартале");
  await expect(page.getByTestId("goals-people-filter")).toContainText("У вас нет целей в этом квартале, поэтому «Мои цели» недоступны");
  await expect(radio(page, "Все сотрудники")).toHaveAttribute("aria-checked", "true");
  await picked(page).click();
  await item(page, "Головкин Владислав").click();
  await page.keyboard.press("Escape");
  await expect(goalCards(page)).toHaveCount(1);
  // Чужие цели выбраны, но это не «мои»: переключатель на «Выбранные»
  await expect(picked(page)).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "Мои цели")).toHaveAttribute("aria-checked", "false");
  await noHorizontalScroll(page);
});

test("смена квартала: выбранных, которых в новом квартале нет, не остаётся, остальные сохраняются", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  // Влада нет среди владельцев целей Q3: выбор пустеет, список полный, на кнопке нет «(1)»
  await page.goto(`/goals?q=${Q4}&people=golovkin`);
  await expect(goalCards(page)).toHaveCount(1);
  await page.getByLabel("Квартал").selectOption(Q3);
  await expect(page).toHaveURL(new RegExp(`q=${Q3}`));
  await expect(radio(page, "Все сотрудники")).toHaveAttribute("aria-checked", "true");
  await expect(picked(page)).toHaveAttribute("aria-checked", "false");
  await expect(picked(page)).not.toContainText("1");
  await expect(page.getByTestId("goals-people-selected")).toHaveCount(0);
  await expect(goalCards(page)).toHaveCount(2);
  await expect(shown(page)).toHaveText("Показано целей: 2 из 2");
  await picked(page).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Головкин Владислав" })).toHaveCount(0);
  await expect(item(page, "Мурадян Арам")).not.toBeChecked();
  await page.keyboard.press("Escape");

  // Арам есть в обоих кварталах: остаётся только он, и это уже «Мои цели»
  await page.goto(`/goals?q=${Q4}&people=golovkin,muradyan`);
  await expect(goalCards(page)).toHaveCount(3);
  await page.getByLabel("Квартал").selectOption(Q3);
  await expect(page).toHaveURL(new RegExp(`q=${Q3}`));
  await expect(radio(page, "Мои цели")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("goals-people-selected")).toHaveText("Выбраны: Мурадян Арам");
  await expect(goalCards(page)).toHaveCount(1);
  await expect(page.getByTestId("goal-card-gp-S1")).toBeVisible();
  // Снять выбор можно: «Все сотрудники» показывает и цели без владельца
  await radio(page, "Все сотрудники").click();
  await expect(goalCards(page)).toHaveCount(2);
  await expect(page.getByTestId("goal-card-gp-S2")).toBeVisible();
});

test("«Без владельца (цели команд)»: отдельный пункт меню, сочетается с людьми, пустое состояние меню", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto(`/goals?q=${Q4}`);
  await picked(page).click();
  await expect(page.getByRole("menu")).toContainText("Можно выбрать нескольких");
  await item(page, "Без владельца (цели команд)").click();
  await expect(item(page, "Без владельца (цели команд)")).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(goalCards(page)).toHaveCount(1);
  await expect(page.getByTestId("goal-card-gp-N1")).toBeVisible();
  await expect(page.getByTestId("goals-cards").getByRole("heading", { level: 3 })).toHaveText([/^Без владельца/]);
  await expect(page.getByTestId("goals-people-selected")).toHaveText("Выбраны: Без владельца");
  await expect(page).toHaveURL(/people=_none/);

  // Вместе с человеком: его цели и цели без владельца, «Без владельца» последней
  await picked(page).click();
  await item(page, "Головкин Владислав").click();
  await page.keyboard.press("Escape");
  await expect(goalCards(page)).toHaveCount(2);
  await expect(page.getByTestId("goals-people-selected")).toHaveText("Выбраны: Головкин Владислав, Без владельца");
  await expect(page.getByTestId("goals-cards").getByRole("heading", { level: 3 })).toHaveText([/^Головкин Владислав/, /^Без владельца/]);

  // Квартал, где владельцев нет совсем: в меню пояснение, выбрать можно только «Без владельца»
  await page.goto(`/goals?q=${Q2}`);
  await picked(page).click();
  await expect(page.getByRole("menu")).toContainText("У целей этого квартала нет владельцев: выбирать некого");
  await expect(page.getByRole("menuitemcheckbox")).toHaveCount(1);
  await expect(item(page, "Без владельца (цели команд)")).toBeVisible();
});

test("дерево целей: при уходе в дерево отбор людей сбрасывается, кнопка шкалы не ведёт в невидимый отбор", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto(`/goals?q=${Q4}&people=golovkin`);
  await expect(goalCards(page)).toHaveCount(1);
  const bar = page.getByTestId("goals-quarter-bar");
  await expect(bar.getByRole("button", { name: /^Все\s*1$/ })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Вид", exact: true }).getByRole("radio", { name: "Дерево", exact: true }).click();
  // В дереве фильтров нет, отбор сброшен и в адресе, шкала считает все цели
  await expect(who(page)).toHaveCount(0);
  await expect(page).not.toHaveURL(/people=/);
  await expect(bar.getByRole("button", { name: /^Все\s*4$/ })).toBeVisible();

  // Кнопка шкалы ведёт в карточки, где видно ровно столько целей, сколько на кнопке
  await bar.getByRole("button", { name: /^Без задач\s*4$/ }).click();
  await expect(radio(page, "Все сотрудники")).toHaveAttribute("aria-checked", "true");
  await expect(goalCards(page)).toHaveCount(4);
});

test("цели нажатия: пилюли шкалы, переключатель «Чьи цели» и пункты меню не ниже 44 px на телефоне", async ({ page }) => {
  test.skip(!phone(), "Размеры для пальца проверяются на телефоне");
  await enter(page, "Мурадян Арам");
  await page.goto(`/goals?q=${Q4}`);
  const height = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!.height;
  for (const name of ["Все сотрудники", "Мои цели"]) expect(await height(radio(page, name)), name).toBeGreaterThanOrEqual(44);
  expect(await height(picked(page)), "Выбранные").toBeGreaterThanOrEqual(44);
  expect(await height(page.getByTestId("goals-quarter-bar").getByRole("button", { name: /^Все\s*4$/ })), "пилюля шкалы").toBeGreaterThanOrEqual(44);
  await picked(page).click();
  for (const person of ["Головкин Владислав", "Мурадян Арам", /^Без владельца/]) expect(await height(item(page, person)), String(person)).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Escape");
  await noHorizontalScroll(page);
});
