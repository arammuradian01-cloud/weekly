import { pickerList } from "./search-picker";
import { expect, test, type Page } from "@playwright/test";
import { enter, enterManagement, resetDatabase, sql } from "./helpers";

async function personForm(page: Page) {
  await resetDatabase({ weekly: false });
  await sql(`INSERT INTO org_units (id, name, kind, "updatedAt") VALUES ('picker-root', 'Компания', 'COMPANY', now())`);
  await sql(`INSERT INTO org_units (id, name, kind, "parentId", "updatedAt")
    SELECT 'picker-unit-' || n, 'Подразделение ' || lpad(n::text, 2, '0'), 'DIVISION', 'picker-root', now()
    FROM generate_series(1, 18) AS n`);
  await sql(`UPDATE people SET "unitId" = 'picker-unit-1' WHERE slug = 'reva'`);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/people/structure");
  await page.getByRole("radio", { name: "Подразделения", exact: true }).click();
  const expand = page.getByRole("button", { name: "Развернуть: Подразделение 01", exact: true });
  if (await expand.count()) await expand.click();
  await page.getByRole("button", { name: "Изменить: Рева Тарас", exact: true }).click();
  return page.getByRole("dialog", { name: "Рева Тарас", exact: true });
}


test("список подразделений не меняет высоту формы и положение кнопок", async ({ page }) => {
  const form = await personForm(page);
  const field = form.getByRole("combobox", { name: "Подразделение", exact: true });
  const save = form.getByRole("button", { name: "Сохранить", exact: true });
  const before = await save.boundingBox();
  const height = await form.evaluate((el) => el.scrollHeight);
  await field.click();
  await expect(await pickerList(field)).toBeVisible();
  const after = await save.boundingBox();
  expect(await form.evaluate((el) => el.scrollHeight)).toBe(height);
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(form).toBeVisible();
  await expect(field).toHaveAttribute("aria-expanded", "false");
});

test("список у края окна остаётся доступным, выбор и Отмена работают", async ({ page }) => {
  const form = await personForm(page);
  const field = form.getByRole("combobox", { name: "Функциональный руководитель" });
  await field.click();
  const list = await pickerList(field);
  await expect(list).toBeVisible();
  const option = list.getByRole("option", { name: "Нет", exact: true });
  await expect(option).toBeInViewport({ ratio: 1 });
  if (test.info().project.name === "phone") await option.tap();
  else await option.click();
  await expect(field).toHaveValue("Нет");
  await field.click();
  await form.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(form).toHaveCount(0);
});

test("стрелки прокручивают длинный список без сдвига формы, Enter сохраняет выбор", async ({ page }) => {
  const form = await personForm(page);
  const field = form.getByRole("combobox", { name: "Подразделение", exact: true });
  await field.click();
  const list = await pickerList(field);
  await expect(list.getByRole("option")).toHaveCount(19);
  const before = await form.boundingBox();
  const scroll = await form.evaluate((el) => el.scrollTop);
  for (let i = 0; i < 18; i++) await field.press("ArrowDown");
  const last = list.getByRole("option").last();
  await expect(last).toBeInViewport({ ratio: 1 });
  await expect(last).toHaveAttribute("aria-selected", "true");
  expect(await form.evaluate((el) => el.scrollTop)).toBe(scroll);
  expect((await form.boundingBox())!.y).toBe(before!.y);
  await expect(field).toBeFocused();
  await field.press("Enter");
  await expect(field).toHaveValue("Подразделение 18");
  await field.fill("несуществующее");
  await field.press("Tab");
  await expect(field).toHaveValue("Подразделение 18");
  await expect(field).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Shift+Tab");
  await expect(field).toBeFocused();
  await field.press("Escape");
  await expect(form).toBeVisible();
  await expect(field).toHaveValue("Подразделение 18");
  await field.press("Escape");
  await expect(form).toHaveCount(0);
});

test("список следует за полем при прокрутке окна и уменьшении экрана", async ({ page }) => {
  const form = await personForm(page);
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 460 });
  const field = form.getByRole("combobox", { name: "Подразделение", exact: true });
  await field.click();
  const list = await pickerList(field);
  const menu = list.locator("..");
  const assertPosition = async () => {
    await expect.poll(async () => {
      const input = (await field.boundingBox())!;
      const popup = (await menu.boundingBox())!;
      return Math.min(Math.abs(popup.y - input.y - input.height - 4), Math.abs(input.y - popup.y - popup.height - 4));
    }).toBeLessThanOrEqual(1);
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height - 7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
  };
  await assertPosition();
  // Прокрутка именно контейнера окна, поле остаётся видимым.
  await form.evaluate((el) => { el.scrollTop = 35; });
  await assertPosition();
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 400 });
  await assertPosition();
  await field.fill("Подразделение 18");
  const option = list.getByRole("option").first();
  if (test.info().project.name === "phone") await option.tap();
  else await option.click();
  await expect(field).toHaveValue("Подразделение 18");
  await expect(form).toBeVisible();
});

test("длинный список прокручивается указателем, не выбирая пункт во время жеста", async ({ page }) => {
  const form = await personForm(page);
  const field = form.getByRole("combobox", { name: "Подразделение", exact: true });
  await field.click();
  const list = await pickerList(field);
  const menu = list.locator("..");
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height - 25;
  const formScroll = await form.evaluate((el) => el.scrollTop);
  if (test.info().project.name === "phone") {
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let delta = 20; delta <= 160; delta += 20) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - delta }] });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, 240);
  }
  await expect.poll(() => menu.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
  await expect(field).toHaveAttribute("data-value", "picker-unit-1");
  await expect(field).toHaveAttribute("aria-expanded", "true");
  expect(await form.evaluate((el) => el.scrollTop)).toBe(formScroll);
});

test("Сохранить с открытым списком срабатывает одним нажатием", async ({ page }) => {
  const form = await personForm(page);
  const field = form.getByRole("combobox", { name: "Функциональный руководитель" });
  await field.fill("Мурадян");
  await (await pickerList(field)).getByRole("option").first().click();
  await field.click();
  await expect(field).toHaveAttribute("aria-expanded", "true");
  const save = form.getByRole("button", { name: "Сохранить", exact: true });
  if (test.info().project.name === "phone") await save.tap();
  else await save.click();
  await expect(form).toHaveCount(0);
  await expect.poll(async () => (await sql(`SELECT m.slug FROM people p JOIN people m ON m.id = p."functionalManagerId" WHERE p.slug = 'reva'`))[0]?.slug).toBe("muradyan");
});
