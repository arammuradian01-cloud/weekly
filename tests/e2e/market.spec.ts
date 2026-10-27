import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { enter, enterByLink, enterManagement, resetDatabase, sql } from "./helpers";

// Этап 62: рынок КАСКО и ОСАГО. Владелец при личном входе загружает пакет рынка (синтетический
// tests/fixtures/market/bundle.json, цифры выдуманные), дашборд работает в изолированном окне: расчёты, фильтр и
// вкладка внутри окна, вкладка и фильтр в адресе страницы. Владелец открывает раздел Реве в настройках, Рева видит
// пункт меню и дашборд. Логинова не из списка при личном входе: пункта меню нет, раздел закрыт, данных нет.
// Этап 72 (решения Арама 23.10): по общему логину раздел открыт любому выбранному профилю, в режиме управления любому
// (в том числе администратору не из списка): меню, страница, данные, командная строка, кнопка на встрече. Загрузка
// пакета по-прежнему только у владельца при личном входе. В настройках
// под людьми строка «Не сохранено» с «Сохранить доступ» и «Отменить», уход со страницы с правками переспрашивается.
// На первой встрече месяца первым пунктом разбор рынка, кнопка «Открыть рынок» и подпись пункта (от какого дня
// данные) только у тех, кому раздел открыт. Этап 82: ответ с данными сжат и помечен отпечатком версии пакета,
// повторный запрос с этим отпечатком получает 304; вкладка и фильтр пишутся в адрес без перезагрузки страницы.
// Этап 59: заголовок дашборда внутри окна меньше заголовка страницы, двух заголовков первого уровня подряд нет.
// Ноутбук 1440 и телефон 360 без горизонтальной прокрутки

const SHOTS = "tests/e2e/screenshots";
mkdirSync(SHOTS, { recursive: true });

const BUNDLE = "tests/fixtures/market/bundle.json";
const FRAME = '[data-testid="market-frame"]';

const isPhone = () => test.info().project.name === "phone";

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-market-${name}.png`, fullPage: true });
}

async function personal(browser: Browser, page: Page, slug: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enterByLink(p, slug);
  return p;
}

async function teamLogin(browser: Browser, page: Page, fullName: string) {
  const p = await (await browser.newContext({ viewport: page.viewportSize()!, isMobile: isPhone(), hasTouch: isPhone() })).newPage();
  await enter(p, fullName);
  return p;
}

/** Ссылка «Рынок» в меню: на ноутбуке в боковом меню, на телефоне в панели «Ещё» */
async function marketLinks(page: Page) {
  if (isPhone()) {
    await page.getByRole("button", { name: "Ещё" }).click();
    return page.getByRole("dialog", { name: "Разделы" }).getByRole("link", { name: "Рынок", exact: true });
  }
  return page.getByRole("navigation", { name: "Разделы" }).filter({ visible: true }).first().getByRole("link", { name: "Рынок", exact: true });
}

/** Пакет загружается тем же обработчиком, что и кнопкой: тело запроса файл пакета */
async function upload(page: Page) {
  return page.request.post("/api/market/upload", { headers: { "Content-Type": "application/json" }, data: readFileSync(BUNDLE) });
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("владелец загружает пакет, вкладка и фильтр работают внутри окна и живут в адресе, Рева из списка видит раздел", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await enterByLink(page, "muradyan");
  await page.goto("/market");
  await expect(page.getByRole("heading", { name: "Рынок КАСКО и ОСАГО", level: 1 })).toBeVisible();
  await expect(page.getByText("Данных рынка пока нет")).toBeVisible();
  await shot(page, "empty");

  await page.getByTestId("market-upload-input").setInputFiles(BUNDLE);
  await expect(page.getByText("Пакет рынка загружен: 2 набора данных, 6 строк").first()).toBeVisible();
  await expect(page.getByTestId("market-meta")).toContainText("загрузил Мурадян Арам");
  await expect(page.getByTestId("market-meta")).toContainText("Данные от ");
  // Окно изолировано: только скрипты, без своего источника
  await expect(page.locator(FRAME)).toHaveAttribute("sandbox", "allow-scripts");
  const frame = page.frameLocator(FRAME);
  await expect(frame.locator("#k-total")).toHaveText("42");
  // Расчёт с исключением даёт ошибку, остальное работает; d3 из пакета подключён до кода страницы
  await expect(frame.locator("#k-status")).toHaveText("Расчёт с ошибкой: error, d3: заглушка");
  // Блок обновления данных внутри дашборда спрятан: обновление у нас загрузкой пакета
  await expect(frame.locator("#c-import")).toBeHidden();

  // Ответ только для вошедшего, с отпечатком версии пакета; с этим отпечатком второй раз приходит 304 без цифр
  const data = await page.request.get("/api/market/data");
  expect(data.status()).toBe(200);
  expect(data.headers()["cache-control"]).toContain("private");
  const etag = data.headers()["etag"];
  expect(etag).toMatch(/^"m\d+-\d+"$/);
  expect(await data.json()).toMatchObject({ ok: true, version: 1 });
  const again = await page.request.get("/api/market/data", { headers: { "If-None-Match": etag! } });
  expect(again.status()).toBe(304);
  expect(await again.text()).toBe("");

  // Метка в окне страницы: если адрес меняется перезагрузкой, она пропадёт
  await page.evaluate(() => ((window as unknown as { kept?: boolean }).kept = true));
  // Фильтр внутри окна пересчитывает и попадает в адрес
  await frame.locator("#metric").selectOption("prem");
  await expect(frame.locator("#k-total")).toHaveText("6");
  await expect(page).toHaveURL(/[?&]metric=prem/);
  // Вкладка ОСАГО внутри окна и в адресе
  await frame.getByRole("tab", { name: "ОСАГО" }).click();
  await expect(frame.locator("#o-count")).toHaveText("2");
  await expect(page).toHaveURL(/[?&]tab=osago/);
  // Страница не перезагружалась: адрес сменился через router.replace
  expect(await page.evaluate(() => (window as unknown as { kept?: boolean }).kept === true)).toBe(true);
  // Заголовок дашборда ниже заголовка страницы: размер раздела (22 px, на телефоне 20 px), а не второй заголовок страницы
  const fontSize = (el: Element) => parseFloat(getComputedStyle(el).fontSize);
  const pageTitle = await page.getByRole("heading", { name: "Рынок КАСКО и ОСАГО", level: 1 }).evaluate(fontSize);
  const dashTitle = await frame.getByRole("heading", { name: "Проверочный рынок ОСАГО" }).evaluate(fontSize);
  expect(dashTitle, "заголовок дашборда не меньше заголовка страницы").toBeLessThan(pageTitle);
  expect(dashTitle).toBeLessThanOrEqual(isPhone() ? 20 : 22);
  await shot(page, "owner");

  // Ссылкой открывается та же вкладка с тем же фильтром
  await page.reload();
  await expect(frame.getByRole("tab", { name: "ОСАГО" })).toHaveAttribute("aria-selected", "true");
  await expect(frame.locator("#o-count")).toHaveText("2");
  await frame.getByRole("tab", { name: "КАСКО" }).click();
  await expect(frame.locator("#k-total")).toHaveText("6");
  await expect(frame.locator("#metric")).toHaveValue("prem");

  // В журнале только счёт наборов и строк
  const [log] = await sql(`SELECT after, via FROM audit_log WHERE action = 'market.upload' ORDER BY id DESC LIMIT 1`);
  expect(log).toMatchObject({ after: "Наборов 2, строк 6, файлов кода 3" });
  expect(log!.via).not.toBe("TEAM");

  // Владелец открывает раздел Реве в настройках
  await enterManagement(page, "owner");
  await page.goto("/settings#market");
  const section = page.getByTestId("market-settings");
  await expect(section.getByRole("heading", { name: "Рынок КАСКО и ОСАГО" })).toBeVisible();
  await section.getByLabel("Люди с доступом").fill("Рева");
  await page.getByRole("option", { name: /Рева Тарас/ }).click();
  const unsaved = section.getByTestId("market-people-unsaved");
  await expect(unsaved).toContainText("Не сохранено: добавить 1");
  await unsaved.getByRole("button", { name: "Сохранить доступ" }).click();
  await expect(page.getByText("Доступ к рынку сохранён: при личном входе раздел видят 2 человека").first()).toBeVisible();
  await expect(unsaved).toHaveCount(0);
  await expect(section.getByTestId("market-settings-count")).toHaveText("Сейчас раздел видят 2 человека, из них владельцев 1, плюс администраторы в режиме управления и все, кто входит по общему логину.");
  await shot(page, "settings");
  const [setting] = await sql(`SELECT value FROM settings WHERE key = 'market.access'`);
  expect(setting!.value).toEqual({ people: ["reva"] });

  // Рева при личном входе: пункт меню, дашборд с данными, без кнопки загрузки
  const reva = await personal(browser, page, "reva");
  const link = await marketLinks(reva);
  await expect(link).toBeVisible();
  await link.click();
  await expect(reva).toHaveURL(/\/market$/);
  const revaFrame = reva.frameLocator(FRAME);
  await expect(revaFrame.locator("#k-total")).toHaveText("42");
  await revaFrame.getByRole("tab", { name: "ОСАГО" }).click();
  await expect(revaFrame.locator("#o-count")).toHaveText("2");
  await expect(reva).toHaveURL(/\/market\?tab=osago$/);
  await expect(reva.getByTestId("market-upload")).toHaveCount(0);
  await shot(reva, "reva");
});

test("человек не из списка при личном входе: пункта меню нет, раздел закрыт; режим управления и общий логин видят раздел, но не загружают", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = await personal(browser, page, "muradyan");
  expect((await upload(owner)).status()).toBe(200);
  await sql(`INSERT INTO settings (key, value, "updatedAt") VALUES ('market.access', '{"people": ["reva"]}'::jsonb, now())`);

  // Логинова при личном входе
  await enterByLink(page, "loginova");
  await expect(await marketLinks(page)).toHaveCount(0);
  await page.goto("/market");
  await expect(page.getByTestId("market-closed")).toHaveText("Раздел открыт отдельным людям, доступ даёт владелец.");
  await expect(page.locator(FRAME)).toHaveCount(0);
  await expect(page.getByTestId("market-upload")).toHaveCount(0);
  const data = await page.request.get("/api/market/data");
  expect(data.status()).toBe(403);
  expect(await data.text()).not.toContain("k_demo");
  expect((await upload(page)).status()).toBe(403);
  await shot(page, "closed");

  // Этап 72: Головкин (администратор, не из списка) без режима управления раздела не видит, в режиме видит, но не
  // загружает
  const admin = await personal(browser, page, "golovkin");
  await expect(await marketLinks(admin)).toHaveCount(0);
  if (isPhone()) await admin.keyboard.press("Escape");
  expect((await admin.request.get("/api/market/data")).status()).toBe(403);
  await enterManagement(admin, "admin");
  const adminLink = await marketLinks(admin);
  await expect(adminLink).toBeVisible();
  await adminLink.click();
  await expect(admin).toHaveURL(/\/market$/);
  await expect(admin.frameLocator(FRAME).locator("#k-total")).toHaveText("42");
  await expect(admin.getByTestId("market-upload")).toHaveCount(0);
  expect((await admin.request.get("/api/market/data")).status()).toBe(200);
  expect((await upload(admin)).status()).toBe(403);

  // Этап 72: Логинова по общему логину (её нет в списке): пункт меню, дашборд с данными, без загрузки
  const team = await teamLogin(browser, page, "Логинова Светлана");
  const link = await marketLinks(team);
  await expect(link).toBeVisible();
  await link.click();
  await expect(team).toHaveURL(/\/market$/);
  await expect(team.getByRole("heading", { name: "Рынок КАСКО и ОСАГО", level: 1 })).toBeVisible();
  await expect(team.getByTestId("market-closed")).toHaveCount(0);
  await expect(team.frameLocator(FRAME).locator("#k-total")).toHaveText("42");
  await expect(team.getByTestId("market-upload")).toHaveCount(0);
  const teamData = await team.request.get("/api/market/data");
  expect(teamData.status()).toBe(200);
  expect(teamData.headers()["cache-control"]).toBe("no-store");
  expect(await teamData.json()).toMatchObject({ ok: true, version: 1 });
  expect((await upload(team)).status()).toBe(403);
  await shot(team, "team");

  // Командная строка тоже ведёт в раздел
  await team.goto("/");
  if (isPhone()) await team.getByRole("button", { name: "Поиск и действия" }).click();
  else await team.keyboard.press("Control+k");
  const palette = team.getByRole("combobox", { name: "Поиск и действия" });
  await expect(palette).toBeFocused();
  await palette.fill("рынок");
  await team.getByRole("option", { name: /Открыть: Рынок КАСКО и ОСАГО/ }).click();
  await expect(team).toHaveURL(/\/market$/);

  // Владелец по общему логину видит раздел, но загрузка только при личном входе
  const teamOwner = await teamLogin(browser, page, "Мурадян Арам");
  await teamOwner.goto("/market");
  await expect(teamOwner.frameLocator(FRAME).locator("#k-total")).toHaveText("42");
  await expect(teamOwner.getByTestId("market-upload")).toHaveCount(0);
  expect((await upload(teamOwner)).status()).toBe(403);
});

test("настройки: «Не сохранено» под людьми, «Отменить» возвращает, «Сохранить доступ» сохраняет; уход с правками переспрашивается", async ({ page }) => {
  test.setTimeout(120_000);
  await enterByLink(page, "muradyan");
  await enterManagement(page, "owner");
  await page.goto("/settings#market");
  const section = page.getByTestId("market-settings");
  const count = section.getByTestId("market-settings-count");
  await expect(count).toHaveText("Сейчас раздел видит 1 человек, из них владельцев 1, плюс администраторы в режиме управления и все, кто входит по общему логину.");
  await expect(section.getByText("Владельцы, все в режиме управления и все, кто входит по общему логину, видят раздел «Рынок» всегда.", { exact: false })).toBeVisible();
  const add = async (query: string, name: RegExp) => {
    // Точное имя: список плашек подписан «Люди с доступом к рынку»
    await section.getByLabel("Люди с доступом", { exact: true }).fill(query);
    await page.getByRole("option", { name }).click();
  };
  const unsaved = section.getByTestId("market-people-unsaved");
  const leaving = () => page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

  // Двое добавлены и не сохранены: строка сразу под плашками
  await add("Рева", /Рева Тарас/);
  await add("Логинова", /Логинова Светлана/);
  await expect(unsaved).toBeVisible();
  await expect(section.getByTestId("market-people-unsaved-text")).toHaveText("Не сохранено: добавить 2");
  // Строка видна без прокрутки к нижней кнопке: она ниже плашек и выше списка команд
  const chips = await section.getByTestId("market-settings-people").boundingBox();
  const bar = await unsaved.boundingBox();
  const bottom = await section.getByTestId("market-settings-save").boundingBox();
  expect(bar!.y).toBeGreaterThan(chips!.y);
  expect(bar!.y).toBeLessThan(bottom!.y);
  for (const name of ["Сохранить доступ", "Отменить"]) {
    const box = await unsaved.getByRole("button", { name }).boundingBox();
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width, name).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await shot(page, "settings-unsaved");

  // Уход со страницы: браузер переспрашивает, ссылка внутри приложения спрашивает подтверждение и остаётся на месте
  expect(await leaving()).toBe(true);
  const dialog = page.waitForEvent("dialog");
  // Меню разделов по точному имени: оглавление настроек называется «Разделы страницы» и на телефоне стоит выше
  const tasksLink = page.getByRole("navigation", { name: "Разделы", exact: true }).filter({ visible: true }).first().getByRole("link", { name: "Задачи", exact: true });
  // Щелчок ждёт ответа на вопрос: сначала вопрос, потом сам щелчок
  const clicking = tasksLink.click();
  const asked = await dialog;
  expect(asked.type()).toBe("confirm");
  expect(asked.message()).toBe("Настройка рынка не сохранена. Уйти со страницы без сохранения?");
  await asked.dismiss();
  await clicking;
  await expect(page).toHaveURL(/\/settings/);
  await expect(unsaved).toBeVisible();

  // «Отменить» возвращает сохранённый список: только владельцы, в базе ничего
  await unsaved.getByRole("button", { name: "Отменить" }).click();
  await expect(unsaved).toHaveCount(0);
  await expect(section.getByText("Пока только владельцы.")).toBeVisible();
  expect(await leaving()).toBe(false);
  expect(await sql(`SELECT value FROM settings WHERE key = 'market.access'`)).toEqual([]);

  // Команды разбора: своя строка и своя отмена
  const top = section.getByRole("checkbox", { name: "Команда страхования и инвестиций" });
  await top.uncheck();
  const teams = section.getByTestId("market-teams-unsaved");
  await expect(section.getByTestId("market-teams-unsaved-text")).toHaveText("Не сохранено: убрать 1");
  await teams.getByRole("button", { name: "Отменить" }).click();
  await expect(teams).toHaveCount(0);
  await expect(top).toBeChecked();

  // «Сохранить доступ»: уведомление, новый счётчик, в базе люди, команды не тронуты
  await add("Рева", /Рева Тарас/);
  await top.uncheck();
  await unsaved.getByRole("button", { name: "Сохранить доступ" }).click();
  await expect(page.getByText("Доступ к рынку сохранён: при личном входе раздел видят 2 человека").first()).toBeVisible();
  await expect(unsaved).toHaveCount(0);
  await expect(count).toHaveText("Сейчас раздел видят 2 человека, из них владельцев 1, плюс администраторы в режиме управления и все, кто входит по общему логину.");
  await expect.poll(async () => (await sql(`SELECT value FROM settings WHERE key = 'market.access'`))[0]?.value).toEqual({ people: ["reva"] });
  expect(await sql(`SELECT value FROM settings WHERE key = 'market.meeting'`)).toEqual([]);
  // Несохранённой осталась только правка команд
  await expect(teams).toBeVisible();
  await teams.getByRole("button", { name: "Отменить" }).click();
  expect(await leaving()).toBe(false);

  // Нижняя кнопка тоже сохраняет людей и пишет то же уведомление
  await section.getByRole("button", { name: "Убрать доступ: Рева Тарас" }).click();
  await expect(section.getByTestId("market-people-unsaved-text")).toHaveText("Не сохранено: убрать 1");
  await section.getByTestId("market-settings-save").click();
  await expect(page.getByText("Доступ к рынку сохранён: при личном входе раздел видит 1 человек").first()).toBeVisible();
  await expect(unsaved).toHaveCount(0);
  await expect.poll(async () => (await sql(`SELECT value FROM settings WHERE key = 'market.access'`))[0]?.value).toEqual({ people: [] });

  // Без правок ссылка уводит сразу, без вопросов
  await tasksLink.click();
  await expect(page).toHaveURL(/\/tasks/);
});

test("первая встреча месяца начинается с разбора рынка; кнопку видят только те, кому раздел открыт", async ({ page, browser }) => {
  test.setTimeout(150_000);
  await enterByLink(page, "muradyan");
  expect((await upload(page)).status()).toBe(200);
  await enterManagement(page, "owner");
  await page.goto("/weekly/meeting");
  await page.getByRole("button", { name: "Собрать повестку" }).click();
  await expect(page.getByText("Повестка собрана").first()).toBeVisible();

  // Встреч топ-команды раньше в этом месяце нет (база с чистого листа): первым пунктом рынок
  const [first] = await sql(`SELECT a.kind, a.title FROM agenda_items a JOIN meetings m ON m.id = a."meetingId" WHERE m."teamId" = 'top' ORDER BY a."sortOrder" LIMIT 1`);
  expect(first!.kind).toBe("MARKET");
  expect(first!.title).toMatch(/^Рынок КАСКО и ОСАГО: итоги [а-я]+( \d{4})?$/);
  await expect(page.getByRole("heading", { level: 2, name: first!.title })).toBeVisible();
  await expect(page.getByTestId("agenda-market-open")).toHaveAttribute("href", "/market");
  // Подпись пункта считается при показе из текущего пакета (встреча может быть уже в следующем месяце: тогда
  // подпись предупреждает, что свежий пакет в этом месяце ещё не загружали)
  await expect(page.getByText(/^(Данные рынка от|Свежий пакет рынка в этом месяце ещё не загружали: данные от) \d{1,2} [а-я]+\.$/)).toBeVisible();
  const [{ note }] = await sql(`SELECT note FROM agenda_items WHERE kind = 'MARKET'`);
  expect(note).toBeNull();
  await shot(page, "meeting");

  // Пересборка повестки пункт не дублирует
  await page.getByRole("button", { name: "Обновить повестку" }).click();
  await expect(page.getByText("Повестка обновлена").first()).toBeVisible();
  const [{ n }] = await sql(`SELECT count(*)::int AS n FROM agenda_items WHERE kind = 'MARKET'`);
  expect(n).toBe(1);

  // Логинова видит пункт, но рынок ей закрыт
  const loginova = await personal(browser, page, "loginova");
  await loginova.goto("/weekly/meeting");
  await expect(loginova.getByRole("heading", { level: 2, name: first!.title })).toBeVisible();
  await expect(loginova.getByTestId("agenda-market-closed")).toHaveText("Разбор рынка: открывают участники с доступом");
  await expect(loginova.getByTestId("agenda-market-open")).toHaveCount(0);
  // Подписи с датой данных у неё нет
  await expect(loginova.getByText(/Данные рынка от|Свежий пакет рынка/)).toHaveCount(0);
  await shot(loginova, "meeting-closed");

  // Этап 72: та же Логинова по общему логину видит кнопку «Открыть рынок» и подпись пункта
  const team = await teamLogin(browser, page, "Логинова Светлана");
  await team.goto("/weekly/meeting");
  await expect(team.getByRole("heading", { level: 2, name: first!.title })).toBeVisible();
  await expect(team.getByTestId("agenda-market-open")).toHaveAttribute("href", "/market");
  await expect(team.getByTestId("agenda-market-closed")).toHaveCount(0);
  await expect(team.getByText(/^(Данные рынка от|Свежий пакет рынка в этом месяце ещё не загружали: данные от) \d{1,2} [а-я]+\.$/)).toBeVisible();
});
