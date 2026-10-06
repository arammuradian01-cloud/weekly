// «Нет на неделе» с замещающим (этап 9): отметка в профиле, «Моя неделя», полоса сдачи и «Команда»
import { expect, test } from "@playwright/test";
import { enter, enterManagement, resetDatabase } from "./helpers";

test.beforeEach(async () => {
  await resetDatabase();
});

test("лидер отмечает отпуск с замещающим: weekly не ждём, в полосе сдачи он серым и вне счёта", async ({ page, browser }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Нет на неделе" })).toBeVisible();
  await expect(page.getByLabel("Неделя")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await page.getByLabel("Кто замещает").selectOption({ label: "Головкин Владислав" });
  await page.getByRole("button", { name: "Отметить" }).click();
  await expect(page.getByText("Отсутствие отмечено")).toBeVisible();
  await expect(page.getByText("Замещает Влад")).toBeVisible();
  await page.screenshot({ path: `tests/e2e/screenshots/${test.info().project.name}-b-profile-absence.png`, fullPage: true });

  await page.goto("/");
  await expect(page.getByText(/На этой неделе вас нет, замещает Влад/)).toBeVisible();
  await expect(page.getByText("Нет на неделе").first()).toBeVisible();

  // Владелец видит полосу сдачи и «Команду»
  const owner = await browser.newPage({ viewport: page.viewportSize() ?? undefined });
  await enter(owner, "Мурадян Арам");
  await enterManagement(owner, "owner");
  await owner.goto("/");
  const strip = owner.getByRole("region", { name: "Кто сдал weekly" });
  await expect(strip.getByText(/нет на неделе, замещает Влад/)).toBeVisible();
  const counted = await strip.getByText(/Сдали \d+ из \d+/).textContent();
  const people = await strip.getByRole("listitem").count();
  expect(Number(counted!.match(/из (\d+)/)![1])).toBe(people - 1);
  await owner.goto("/team");
  await expect(owner.getByText("Нет на неделе").filter({ visible: true }).first()).toBeVisible();
  await owner.close();

  // Вернулся раньше: убирает отметку
  await page.goto("/profile");
  await page.getByRole("button", { name: /Убрать отсутствие: неделя \d+/ }).click();
  await expect(page.getByText("Отсутствий не отмечено.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText(/На этой неделе вас нет/)).toHaveCount(0);
});

test("владелец отмечает отсутствие коллеги в списке людей", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Отсутствие: Логинова Светлана" }).click();
  const dialog = page.getByRole("dialog", { name: "Нет на неделе: Логинова Светлана" });
  await dialog.getByLabel("Кто замещает").selectOption({ label: "Рева Тарас" });
  await dialog.getByRole("button", { name: "Отметить" }).click();
  await expect(page.getByText("Отсутствие отмечено")).toBeVisible();
  await expect(dialog.getByText("Замещает Тарас")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/Нет на неделе \d+/)).toBeVisible();
  await page.goto("/journal?kind=weekly");
  await expect(page.getByText("нет, замещает Рева Тарас").filter({ visible: true }).first()).toBeVisible();
});
