import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { E2E_PASSWORDS } from "./global-setup";
import { enter, enterManagement, enterPersonal, resetDatabase, sql } from "./helpers";

// Этап 71: «Сменить профиль». Владелец при личном входе находит поиском руководителя сектора не из топ-команды, входит в
// его профиль после подтверждения, ставит задачу от его имени: в журнале пометка «вошёл владелец», на каждой странице
// плашка, возврат ведёт на главную страницу владельца. Общий логин находит поиском человека вне топ-команды, людей с
// личным паролем в списке нет; владелец без пароля в списке с подписью роли, но без режима управления (поправка 23.10).
// Обычный человек при личном входе нажимает «Сменить профиль», видит
// подтверждение, выходит, входит под другим логином и попадает на главную. Ноутбук 1440 и телефон 360 без прокрутки вбок

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const STRUCTURE = [
  ["ФИО", "Должность", "Управление", "Отдел", "Сектор", "Руководитель", "Руководит"],
  ["Рева Тарас Игоревич", "CPO", "Управление развития продуктов", "", "", "Мурадян Арам", "да"],
  ["Антонов Дмитрий", "PO OSAGO", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "Рева Тарас", "да"],
  ["Чемоданова Алиса", "Product Designer", "Управление развития продуктов", "Отдел развития продуктов", "Сектор автострахования", "", ""],
]
  .map((r) => r.join("\t"))
  .join("\n");

test.beforeEach(async () => {
  await resetDatabase({ weekly: false });
  const dir = mkdtempSync(join(tmpdir(), "structure-"));
  const file = join(dir, "structure.tsv");
  writeFileSync(file, STRUCTURE);
  execSync(`npx tsx scripts/load-structure.ts ${file} --yes`, { env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL }, stdio: "ignore" });
});

// Длинный список людей для экрана выбора не остаётся следующим файлам: не все из них сбрасывают базу
test.afterEach(async () => {
  await sql(`DELETE FROM people WHERE slug LIKE 's71p%'`);
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-owner-as-${name}.png`, fullPage: true });
}

/** Меню профиля: на ноутбуке в боковой панели, на телефоне в шапке, видно ровно одно */
async function openProfileMenu(page: Page) {
  await page.getByRole("button", { name: /^Профиль:/ }).filter({ visible: true }).first().click();
}

test("возврат из чужого профиля сохраняет активный черновик weekly до окончания отправки", async ({ page }) => {
  await enterPersonal(page, "muradyan");
  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: "Сменить профиль" }).click();
  const dialog = page.getByRole("dialog", { name: "Сменить профиль" });
  await dialog.getByLabel("Поиск по ФИО, должности или подразделению").fill("Рева Тарас");
  await dialog.getByRole("button", { name: /Рева Тарас/ }).click();
  await page.getByRole("dialog", { name: /Войти в профиль Рева/ }).getByRole("button", { name: "Войти" }).click();
  await expect(page.getByTestId("owner-as-banner")).toBeVisible();
  await page.goto("/weekly/submit");
  const text = "Черновик до возврата владельца";
  const updated = `${text}, дополнено во время отправки`;
  // Ответ на сохранение задержался. Открытая форма остаётся активной, фоновая отправка её пропускает.
  let release!: () => void;
  let sending = false;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/weekly/submit*", async (route) => {
    if (route.request().method() === "POST" && route.request().postData()?.includes(text)) {
      sending = true;
      await hold;
    }
    await route.continue();
  });
  await page.getByLabel("Главное одной фразой").fill(text);
  const back = page.getByTestId("owner-as-banner").getByRole("button", { name: "Вернуться в свой профиль" });
  try {
    await expect.poll(() => sending).toBe(true);
    await page.getByLabel("Главное одной фразой").fill(updated);
    await back.click();
    await expect(page.getByTestId("owner-as-banner").getByRole("alert")).toContainText("несохранённые изменения");
    expect(await page.evaluate(() => localStorage.getItem("weekly-offline:v1:reva"))).toContain(updated);
  } finally {
    release();
  }
  await expect.poll(async () => (await sql(`SELECT headline FROM weekly_reports WHERE "authorId" = (SELECT id FROM people WHERE slug = 'reva') AND headline = $1`, [updated])).length).toBe(1);
  await back.click();
  await expect(page.getByTestId("owner-as-banner")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Арам");
});

test("владелец входит в профиль руководителя не из топ-команды, ставит задачу от его имени, журнал с пометкой, возврат на главную", async ({ page }) => {
  test.setTimeout(120_000);
  const [{ mark }] = await sql(`SELECT coalesce(max(id), 0)::text AS mark FROM audit_log`);
  const [antonov] = await sql(`SELECT id, slug, "shortName" FROM people WHERE "fullName" LIKE 'Антонов%'`);
  // Не из топ-команды: ни участник, ни руководитель
  expect(await sql(`SELECT 1 FROM team_members WHERE "teamId" = 'top' AND "personId" = $1`, [antonov!.id])).toHaveLength(0);

  await enter(page, "Мурадян Арам");
  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: "Сменить профиль" }).click();
  const dialog = page.getByRole("dialog", { name: "Сменить профиль" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Можно войти: \d+/)).toBeVisible();
  // Себя и других владельцев в списке нет
  await expect(dialog.getByRole("button", { name: /Мурадян Арам/ })).toHaveCount(0);
  await dialog.getByLabel("Поиск по ФИО, должности или подразделению").fill("PO OSAGO");
  await expect(dialog.getByText("Нашлось 1 человек")).toBeVisible();
  await shot(page, "dialog");
  await dialog.getByRole("button", { name: /Антонов Дмитрий/ }).click();

  const confirm = page.getByRole("dialog", { name: "Войти в профиль Антонов Дмитрий?" });
  await expect(confirm).toContainText("Правки будут от его имени, в журнале с пометкой «вошёл владелец Мурадян Арам»");
  await shot(page, "confirm");
  // «Отмена» возвращает к списку, вход не начинается
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await expect(dialog.getByRole("button", { name: /Антонов Дмитрий/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Антонов Дмитрий/ }).click();
  await page.getByRole("dialog", { name: "Войти в профиль Антонов Дмитрий?" }).getByRole("button", { name: "Войти" }).click();

  // Главная страница Антонова и плашка над страницей
  await expect(page).toHaveURL(/\/$/);
  const banner = page.getByTestId("owner-as-banner");
  await expect(banner).toContainText("Вы в профиле Антонов Дмитрий как владелец Мурадян Арам.");
  await expect(banner.getByRole("button", { name: "Вернуться в свой профиль" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(String(antonov!.shortName));
  await expect(page).toHaveTitle(/Профиль Антонов Дмитрий/);
  await shot(page, "home");

  // Задача от имени Антонова его специалисту
  await page.goto("/tasks");
  await expect(page.getByTestId("owner-as-banner")).toBeVisible();
  await page.keyboard.press("n");
  const create = page.getByRole("dialog", { name: "Новая задача" });
  await create.getByLabel("Задача").fill("Задача из профиля Антонова");
  await create.getByLabel("Что нужно сделать").fill("Проверить калькулятор");
  await create.getByLabel("Ответственный").selectOption({ label: "Чемоданова Алиса" });
  await create.getByRole("button", { name: "Поставить задачу" }).click();
  await expect(page.getByText(/Задача \d+ создана/).first()).toBeVisible();
  const [task] = await sql(`SELECT number, "createdById" FROM tasks WHERE title = 'Задача из профиля Антонова'`);
  expect(task!.createdById).toBe(antonov!.id);
  const rows = await sql(`SELECT action, "actorId", via::text AS via, "asOwnerName" FROM audit_log WHERE id > $1 AND "entityId" = $2 AND entity = 'task'`, [mark, String(task!.number)]);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r).toMatchObject({ actorId: antonov!.id, via: "OWNER_AS", asOwnerName: "Мурадян Арам" });

  // Учётная запись Антонова закрыта: формы пароля нет, пояснение
  await page.goto("/profile?tab=login");
  await expect(page.getByTestId("owner-as-account")).toContainText("учётная запись человека закрыта");
  await expect(page.getByRole("button", { name: /Сохранить пароль|Задать пароль/ })).toHaveCount(0);
  // Во входе нет «Сменить профиль» и режима управления, есть возврат
  await openProfileMenu(page);
  await expect(page.getByRole("menuitem", { name: "Сменить профиль" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Включить режим управления" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Вернуться в свой профиль" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Возврат с плашки: главная страница владельца, плашки нет
  await page.getByTestId("owner-as-banner").getByRole("button", { name: "Вернуться в свой профиль" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("owner-as-banner")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Арам");

  // Журнал: пометка у правки, начало и конец входа
  await enterManagement(page, "owner");
  await page.goto("/journal");
  await expect(page.getByTestId("journal-owner-as").first()).toContainText("вошёл владелец Мурадян Арам");
  await shot(page, "journal");
  await page.getByLabel("Тип события").selectOption("login");
  await expect(page.getByText("Вход владельца в профиль: Антонов Дмитрий").filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText("Возврат в свой профиль: Антонов Дмитрий").filter({ visible: true }).first()).toBeVisible();
  const [stop] = await sql(`SELECT field FROM audit_log WHERE id > $1 AND action = 'ownerAs.stop'`, [mark]);
  expect(stop!.field).toBe("Вернулся в свой профиль");
});

test("общий логин находит поиском человека вне топ-команды, людей с личным паролем в списке нет", async ({ page }) => {
  await sql(`UPDATE people SET "passwordHash" = 'x' WHERE slug = 'loginova'`);
  // Длинный список: полторы сотни человек с длинными ФИО и должностями, на экране первые 100 и поиск
  await sql(
    `INSERT INTO people (id, slug, "fullName", "shortName", role, zone, position, "updatedAt")
     SELECT 's71p' || i, 's71p' || i, 'Константинопольская-Длиннофамильная Анастасия ' || lpad(i::text, 3, '0'), 'Анастасия', 'EMPLOYEE', '', 'Ведущий специалист по развитию партнёрских продаж и сопровождению ' || i, now()
     FROM generate_series(1, 150) AS i`,
  );
  await page.goto("/login");
  await page.getByLabel("Логин").fill("team");
  await page.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/choose$/);
  await expect(page.getByText(/Можно выбрать: \d+/)).toBeVisible();
  await expect(page.getByText(/Ещё \d+: уточните поиск/)).toBeVisible();
  await shot(page, "choose");
  const search = page.getByLabel("Поиск по ФИО, должности или подразделению");
  // Человека с личным паролем поиск не находит. Владелец без личного пароля в списке есть, с подписью роли (поправка 23.10)
  await search.fill("логинова");
  await expect(page.getByText("Никого не нашли: проверьте написание")).toBeVisible();
  await search.fill("мурадян");
  await expect(page.getByRole("button", { name: /Мурадян Арам/ })).toContainText("Владелец");
  await search.fill("рева");
  await expect(page.getByRole("button", { name: /Рева Тарас/ })).toBeVisible();

  await search.fill("сопровождению 149");
  await expect(page.getByText("Нашлось 1 человек")).toBeVisible();
  await expect(page.getByRole("button", { name: /Длиннофамильная Анастасия 149/ })).toBeVisible();
  await shot(page, "choose-search");
  await search.fill("product designer");
  await expect(page.getByText("Нашлось 1 человек")).toBeVisible();
  await page.getByRole("button", { name: /Чемоданова Алиса/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Алиса");

  // «Сменить профиль» по общему логину снова открывает список
  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: "Сменить профиль" }).click();
  await expect(page).toHaveURL(/\/choose$/);
  await page.getByLabel("Поиск по ФИО, должности или подразделению").fill("чемоданова");
  await expect(page.getByRole("button", { name: /Чемоданова Алиса/ })).toContainText("Сейчас");
});

test("владелец без личного пароля выбирается по общему логину с подписью роли, но без режима управления; с паролем пропадает", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByLabel("Логин").fill("team");
  await page.getByLabel("Пароль").fill(E2E_PASSWORDS.team);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page).toHaveURL(/\/choose$/);
  await page.getByLabel("Поиск по ФИО, должности или подразделению").fill("мурадян");
  await page.getByRole("button", { name: /Мурадян Арам/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await openProfileMenu(page);
  const menu = page.getByRole("menu");
  await expect(menu).toContainText("Владелец");
  await expect(page.getByRole("menuitem", { name: "Включить режим управления" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Смотреть как…" })).toHaveCount(0);
  // «Сменить профиль» по общему логину ведёт на выбор себя, а не во вход в чужой профиль
  await page.getByRole("menuitem", { name: "Сменить профиль" }).click();
  await expect(page).toHaveURL(/\/choose$/);
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/$/);
  await shot(page, "team-owner");

  // Владелец задал себе личный пароль: в списке общего логина его больше нет
  await enterPersonal(await (await browser.newContext({ viewport: page.viewportSize()! })).newPage(), "muradyan");
  await page.goto("/choose");
  await page.getByLabel("Поиск по ФИО, должности или подразделению").fill("мурадян");
  await expect(page.getByText("Никого не нашли: проверьте написание")).toBeVisible();
});

test("обычный человек: «Сменить профиль» спрашивает, выходит, после входа под другим логином главная страница", async ({ page }) => {
  await enterPersonal(page, "reva");
  await page.goto("/tasks");
  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: "Сменить профиль" }).click();
  const confirm = page.getByRole("dialog", { name: "Точно хотите выйти из системы и сменить профиль?" });
  await expect(confirm).toBeVisible();
  await shot(page, "logout-confirm");
  await confirm.getByRole("button", { name: "Отмена" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page).toHaveURL(/\/tasks$/);

  await openProfileMenu(page);
  await page.getByRole("menuitem", { name: "Сменить профиль" }).click();
  await page.getByRole("dialog", { name: "Точно хотите выйти из системы и сменить профиль?" }).getByRole("button", { name: "Выйти и сменить" }).click();
  await expect(page).toHaveURL(/\/login$/);
  // Вход на этом устройстве завершён в базе
  const [{ open }] = await sql(`SELECT count(*)::int AS open FROM device_sessions d JOIN people p ON p.id = d."personId" WHERE p.slug = 'reva' AND d."revokedAt" IS NULL`);
  expect(open).toBe(0);

  // Вход под другим логином: главная страница, а не та, где был прежний человек
  await enterPersonal(page, "loginova");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Света");
});
