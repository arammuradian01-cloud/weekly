import { test, expect } from "@playwright/test";
import { enterPersonal, enterManagement, resetDatabase, sql } from "./helpers";

test.beforeEach(async () => {
  await resetDatabase();
  await sql(`INSERT INTO people (id, slug, "fullName", "shortName", zone, role, active, "updatedAt") VALUES
    ('r93-audit', 'r93-audit', 'Отдельный Редактор', 'Редактор', '', 'EMPLOYEE', false, now()),
    ('r93-history', 'r93-history', 'Тестовый Историк', 'Историк', '', 'EMPLOYEE', false, now()),
    ('r93-hidden', 'r93-hidden', 'Закрытый Незнакомец', 'Незнакомец', '', 'ADMIN', false, now()),
    ('r93-active', 'r93-active', 'Действующий Коллега', 'Коллега', '', 'ADMIN', true, now())`);
  await sql(`INSERT INTO teams (id, name, kind, "updatedAt") VALUES ('r93-secret-team', 'Скрытая команда для проверки 93', 'CUSTOM', now())`);
});
test.afterEach(async () => {
  await sql(`DELETE FROM task_comments WHERE id = 'r93-comment'`);
  await sql(`DELETE FROM teams WHERE id = 'r93-secret-team'`);
  await sql(`DELETE FROM people WHERE slug LIKE 'r93-%'`);
});

test("публичный ответ скрывает роли и чужие команды, история сохраняет имя автора", async ({ page, browser }) => {
  const [task] = await sql(`SELECT t.id, t.number FROM tasks t JOIN people p ON p.id = t."ownerId" WHERE p.slug = 'reva' AND t."archivedAt" IS NULL LIMIT 1`);
  expect(task).toBeTruthy();
  await sql(`INSERT INTO task_comments (id, "taskId", "authorId", text) VALUES ('r93-comment', $1, 'r93-history', 'Комментарий прежнего сотрудника 93')`, [task!.id]);
  const historyField = `Историческая правка 93 ${test.info().project.name}`;
  await sql(`INSERT INTO audit_log ("actorId", action, entity, "entityId", field) VALUES ('r93-audit', 'task.update', 'task', $1, $2)`, [String(task!.number), historyField]);
  await enterPersonal(page, "reva");
  const publicResponse = await page.request.get("/people/structure");
  expect(publicResponse.ok()).toBe(true);
  const publicHtml = (await publicResponse.text()).replaceAll("\\", "");
  expect(publicHtml).toContain("Действующий Коллега");
  expect(publicHtml).not.toContain("Закрытый Незнакомец");
  expect(publicHtml).not.toContain("Скрытая команда для проверки 93");
  expect(publicHtml).not.toContain('"role":"ADMIN"');
  expect(publicHtml).not.toContain("Отдельный Редактор");
  const hiddenTeam = await page.request.get("/people/teams?team=r93-secret-team");
  expect(await hiddenTeam.text()).not.toContain("Скрытая команда для проверки 93");

  await page.goto(`/tasks/${task!.number}`);
  await expect(page.getByText("Комментарий прежнего сотрудника 93", { exact: true })).toBeVisible();
  await expect(page.getByText("Историк Т.", { exact: true })).toBeVisible();

  await page.getByRole("radio", { name: /История/ }).click();
  await expect(page.getByText(historyField, { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ has: page.getByText(historyField, { exact: true }) }).getByText(/Редактор О\./)).toBeVisible();

  const owner = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const ownerPage = await owner.newPage();
    await enterPersonal(ownerPage, "muradyan");
    await enterManagement(ownerPage, "owner");
    // Оба запроса выполняются одновременно: управление не расширяет чужой ответ.
    const [mine, managed] = await Promise.all([page.request.get("/people/structure"), ownerPage.request.get("/people/structure")]);
    const [mineHtml, managedHtml] = await Promise.all([mine.text(), managed.text()]);
    expect(mineHtml).not.toContain("Закрытый Незнакомец");
    expect(mineHtml).not.toContain("Скрытая команда для проверки 93");
    expect(managedHtml).toContain("Закрытый Незнакомец");
    expect(managedHtml).toContain("Скрытая команда для проверки 93");
  } finally {
    await owner.close();
  }
});
