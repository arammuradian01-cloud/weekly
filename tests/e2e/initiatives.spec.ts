import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase } from "./helpers";

// Этап 30: шкала готовности крупных инициатив. Владелец заводит инициативу, ответственный узнаёт о ней в «Мне» и
// переводит в «Уже делаем» с заметкой, владелец видит и закрывает. Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });
const phone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-in-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

test("владелец заводит инициативу, ответственный переводит её в «Уже делаем», владелец закрывает", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  if (phone()) {
    await page.getByRole("button", { name: /^Профиль:/ }).click();
    await page.getByRole("menuitem", { name: "Инициативы" }).click();
  } else await page.getByRole("link", { name: "Инициативы" }).locator("visible=true").first().click();
  await expect(page.getByRole("heading", { name: "Крупные инициативы", level: 1 })).toBeVisible();
  await expect(page.getByText("Крупных инициатив пока нет.")).toBeVisible();

  await page.getByRole("button", { name: "Новая инициатива" }).click();
  const create = page.getByRole("dialog", { name: "Новая инициатива" });
  await create.getByLabel("Инициатива").fill("Подписка ОСАГО в приложении");
  await create.getByLabel("Зачем").fill("Страховые переводят розницу на подписку");
  await create.getByLabel("Ответственный").selectOption({ label: "Рева Тарас" });
  await create.getByRole("button", { name: "Завести инициативу" }).click();
  await expect(page.getByText("Инициатива заведена")).toBeVisible();
  const searching = page.getByRole("region", { name: /Ещё ищем, как сделать/ });
  const card = searching.getByRole("article", { name: "Подписка ОСАГО в приложении" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Заметки пока нет")).toBeVisible();
  await expect(card.getByText("Ищем меньше недели")).toBeVisible();
  await shot(page, "owner-new");

  // Рева узнаёт из «Мне» и переходит к карточке. Деление шкалы меняют при личном входе
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: phone(), hasTouch: phone() });
  const reva = await ctx.newPage();
  await enterByLink(reva, "reva");
  await reva.goto("/me");
  await reva.getByRole("link", { name: "Крупная инициатива" }).click();
  await expect(reva).toHaveURL(/\/initiatives#i-/);
  const mine = reva.getByRole("article", { name: "Подписка ОСАГО в приложении" });
  await expect(mine).toBeVisible();
  // Ответственный не правит и не закрывает: только деление и заметка
  await expect(mine.getByRole("button", { name: /^Закрыть/ })).toHaveCount(0);
  await mine.getByRole("button", { name: "Уже делаем: Подписка ОСАГО в приложении" }).click();
  const dialog = reva.getByRole("dialog", { name: "Инициатива в работе" });
  await expect(dialog.getByRole("button", { name: "Отметить «Уже делаем»" })).toBeDisabled();
  await dialog.getByLabel("Что делаем и когда первый результат").fill("Пилот с одной страховой, первый результат в ноябре");
  await dialog.getByRole("button", { name: "Отметить «Уже делаем»" }).click();
  await expect(reva.getByText("Инициатива в работе").first()).toBeVisible();
  const doing = reva.getByRole("region", { name: /Уже делаем/ });
  await expect(doing.getByRole("article", { name: "Подписка ОСАГО в приложении" }).getByText("Пилот с одной страховой, первый результат в ноябре", { exact: true })).toBeVisible();
  await shot(reva, "owner-doing");
  await ctx.close();

  // Владелец видит перемену и историю, закрывает с итогом
  await page.reload();
  const done = page.getByRole("region", { name: /Уже делаем/ }).getByRole("article", { name: "Подписка ОСАГО в приложении" });
  await expect(done.getByText(/Делаем с/)).toBeVisible();
  await done.getByText("История").click();
  await expect(done.getByText(/Уже делаем: Пилот с одной страховой/)).toBeVisible();
  await done.getByRole("button", { name: "Закрыть: Подписка ОСАГО в приложении" }).click();
  const close = page.getByRole("dialog", { name: "Закрыть инициативу" });
  await close.getByLabel("Сделали").check();
  await close.getByLabel("Итог одной фразой").fill("Подписка запущена у одной страховой");
  await close.getByRole("button", { name: "Закрыть инициативу" }).click();
  await expect(page.getByText("Инициатива закрыта")).toBeVisible();
  await page.getByText("Закрытые инициативы (1)").click();
  await expect(page.getByText(/Сделали .+: Подписка запущена у одной страховой\./)).toBeVisible();
  await shot(page, "closed");

  // Ссылка из «Мне» на закрытую инициативу раскрывает свёрнутый список закрытых. Страница грузится заново: с главной
  const id = await page.locator("li[id^='i-']").first().getAttribute("id");
  await page.goto("/");
  await page.goto(`/initiatives#${id}`);
  await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.locator(`#${id}`)).toHaveClass(/outline-2/);
  await page.getByRole("button", { name: "Вернуть в работу: Подписка ОСАГО в приложении" }).click();
  await expect(page.getByText("Инициатива снова в работе")).toBeVisible();
  await expect(page.getByRole("region", { name: /Уже делаем/ }).getByRole("article", { name: "Подписка ОСАГО в приложении" })).toBeVisible();
});

test("по общему логину ответственный видит инициативу, но деление не меняет", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await enterManagement(page, "owner");
  await page.goto("/initiatives");
  await page.getByRole("button", { name: "Новая инициатива" }).click();
  const create = page.getByRole("dialog", { name: "Новая инициатива" });
  await create.getByLabel("Инициатива").fill("Скоринг в выдаче");
  await create.getByLabel("Ответственный").selectOption({ label: "Рева Тарас" });
  await create.getByRole("button", { name: "Завести инициативу" }).click();
  await expect(page.getByText("Инициатива заведена")).toBeVisible();
  await page.context().clearCookies();
  await enter(page, "Рева Тарас");
  await page.goto("/initiatives");
  const card = page.getByRole("article", { name: "Скоринг в выдаче" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /Уже делаем|Обновить заметку|Вернуть в поиск/ })).toHaveCount(0);
});

test("без режима управления инициативу не завести", async ({ page }) => {
  await enter(page, "Рева Тарас");
  await page.goto("/initiatives");
  await expect(page.getByRole("heading", { name: "Крупные инициативы", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Новая инициатива" })).toHaveCount(0);
});
