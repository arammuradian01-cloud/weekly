import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { enter, enterByLink, resetDatabase, sql } from "./helpers";

// Этап 36: визуальная система разделов, волна 1. Ключевые цифры плитками под заголовком, таблицы вместо сплошного
// текста, пустые экраны с действием. Каждый раздел открывается без горизонтальной прокрутки, цифры ведут на отбор.
// Ноутбук 1440 и телефон 360

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-vs-${name}.png`, fullPage: true });
}

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
});

test("задачи: цифры под заголовком ведут на список с фильтром, по людям таблицей, изменения журналом", async ({ page }) => {
  // «Изменилось за неделю» берётся из журнала, а журнал только дописывается: каждый resetDatabase заново импортирует
  // задачи Bord и добавляет записи «Импорт из таблицы». К концу прогона на странице до 500 новых задач, на телефоне это
  // около 100 000 px, и снимок всей страницы идёт секунд двадцать. Проверки те же, времени на тест больше
  test.setTimeout(90_000);
  await enter(page, "Рева Тарас");
  await page.goto("/tasks");
  const figures = page.getByRole("list", { name: "Задачи в цифрах" });
  await expect(figures).toBeVisible();
  const overdue = page.getByTestId("tasks-fig-overdue");
  const count = Number((await overdue.locator(".sv-figure__value").textContent())!.trim());
  expect(count).toBeGreaterThan(0);
  await shot(page, "tasks");
  await overdue.getByRole("link").click();
  await expect(page).toHaveURL(/\/tasks\?f=overdue/);
  await expect(page.getByText(`Показано ${count} по фильтрам`)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Просроченные/ })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/tasks/people");
  await expect(page.getByTestId("task-people")).toBeVisible();
  await expect(page.getByTestId("task-people-reva")).toContainText("Рева Тарас");
  await shot(page, "tasks-people");

  await page.goto("/tasks/changes");
  await expect(page.getByRole("list", { name: "Задачи в цифрах" })).toBeVisible();
  await shot(page, "tasks-changes");
});

test("люди: команда и руководителю: цифры и таблицы", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto("/people");
  await expect(page.getByRole("list", { name: "Команда в цифрах" })).toBeVisible();
  await expect(page.getByTestId("team-fig-weekly")).toContainText(/\d+ из \d+/);
  const table = page.getByTestId("team-summary");
  await expect(table.getByText("Вся команда")).toBeVisible();
  // Этап 45: имя открывает карточку человека, общую со структурой
  await table.getByRole("button", { name: /^Рева Тарас/ }).click();
  const card = page.getByRole("dialog", { name: "Рева Тарас" });
  await expect(card.getByText("Карточка человека")).toBeVisible();
  await expect(card.getByRole("link", { name: "Разбор на встрече" })).toHaveAttribute("href", "/tasks/review?person=reva");
  // Структура в этой базе не загружена: ссылки «В структуре» нет (она проверяется в structure.spec)
  await expect(card.getByRole("link", { name: "В структуре" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await shot(page, "team");

  await page.goto("/people/leader");
  await expect(page.getByRole("list", { name: /в цифрах/ })).toBeVisible();
  await expect(page.getByTestId("mt-team-cards")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Требует внимания/ })).toBeVisible();
  await shot(page, "my-teams");
});

test("инициативы и решения: цифры, таблица решений, пустой поиск", async ({ page }) => {
  await enter(page, "Мурадян Арам");
  await page.goto("/initiatives");
  // Инициатив нет: цифр нет, понятная фраза и кнопка заведения у управления
  await expect(page.getByText("Крупных инициатив пока нет.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Инициативы в цифрах" })).toHaveCount(0);
  await shot(page, "initiatives-empty");

  await page.goto("/decisions");
  await expect(page.getByRole("heading", { name: "Решений пока нет" }).or(page.getByTestId("decisions-table"))).toBeVisible();
  await page.getByPlaceholder("Поиск по словам").fill("несуществующее словосочетание");
  await expect(page.getByText("Ничего не нашлось", { exact: true })).toBeVisible();
  await shot(page, "decisions");
});

test("моя неделя: «Ждёт вас», счётчики ведут к группам очереди на той же странице", async ({ page }) => {
  // У Головкина всё разобрано и сроков нет: счётчиков нет, нули не нужны, одна пустая очередь. Сроки задач из выгрузки
  // Bord со временем проходят, поэтому его открытые задачи сдвигаем на месяц вперёд
  await sql(`UPDATE tasks SET due = CURRENT_DATE + 30 WHERE "ownerId" = (SELECT id FROM people WHERE slug = 'golovkin') AND status IN ('IN_PROGRESS', 'CLARIFY', 'PROPOSED')`);
  await enterByLink(page, "golovkin");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Всё разобрано" })).toBeVisible();
  await expect(page.getByTestId("my-attention-figures")).toHaveCount(0);
  // У Ревы просроченные задачи: счётчик ведёт к группе «Срок прошёл» (этап 44, с этапа 76 на «Моей неделе»), в строке
  // статус и перенос срока
  await page.context().clearCookies();
  await enterByLink(page, "reva");
  await page.goto("/");
  const figures = page.getByTestId("my-attention-figures");
  await expect(figures).toBeVisible();
  const lateLink = figures.getByRole("link", { name: /срок прошёл/ });
  await expect(lateLink).not.toContainText(/^0/);
  await lateLink.click();
  await expect(page).toHaveURL(/\/#me-late$/);
  const late = page.getByTestId("me-late");
  await expect(late.getByRole("heading", { name: /Срок прошёл/ })).toBeVisible();
  await expect(late.getByRole("button", { name: /^Статус задачи \d+/ }).first()).toBeVisible();
  await expect(late.getByRole("button", { name: /^Перенести срок задачи \d+/ }).first()).toBeVisible();
  // Главная 2:1 (этап 44): «Сейчас» с одной кнопкой, «Ждёт вас» одним списком, встреча справа
  await expect(page.getByRole("heading", { name: /Мой weekly за неделю/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Сдать weekly|Продолжить weekly|Открыть мой weekly/ })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: /^Ждёт вас/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Открыть подготовку к встрече" })).toBeVisible();
  await shot(page, "home");
});

