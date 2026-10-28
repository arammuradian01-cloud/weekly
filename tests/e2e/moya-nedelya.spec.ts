// Этап 76 (решения Арама 23.10.2026): «Мне» влит в «Мою неделю» блоком «Ждёт вас», «Один на один» удалён.
// Меню без убранных разделов, старые адреса ведут на «Мою неделю» к нужной группе, строка «Не сдан weekly за неделю N».
// Ноутбук 1440 и телефон 360
import { expect, test, type Page } from "@playwright/test";
import { enter, resetDatabase, sql } from "./helpers";

const SHOTS = "tests/e2e/screenshots";
const isPhone = () => test.info().project.name === "phone";

test.beforeEach(async () => {
  await resetDatabase();
});

async function shot(page: Page, name: string) {
  const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
  expect(overflow, `горизонтальная прокрутка на экране ${name}`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-76-${name}.png`, fullPage: true });
}

/** Событие очереди Ревы от Мурадяна: решение встречи, видно и по общему логину */
async function decisionEvent(id: string) {
  await sql(
    `INSERT INTO inbox_events (id, "recipientId", kind, "actorId", "actorName", subject, text, "createdAt")
     SELECT $1, r.id, 'MEETING', a.id, 'Мурадян Арам', $2, 'Вы владелец решения встречи: проверить тариф', now() FROM people r, people a WHERE r.slug = 'reva' AND a.slug = 'muradyan'`,
    [id, `decision:${id}`],
  );
}

test("меню без «Мне» и «Один на один», счётчик у «Моей недели»; командная строка по слову «мне» открывает «Мою неделю»", async ({ page }) => {
  await decisionEvent("e2e76-nav");
  await enter(page, "Рева Тарас");
  const nav = page.getByRole("navigation", { name: "Разделы" }).filter({ visible: true }).first();
  // Счётчик у пункта считает всю очередь, а не только события (правка по ревью этапа 76): сверяем его с числом
  // в заголовке блока «Ждёт вас» на той же странице, а не с единицей
  await expect(nav.getByRole("link", { name: /^Моя неделя, ждут \d+$/ })).toBeVisible();
  const menu = Number(/ждут (\d+)/.exec((await nav.getByRole("link", { name: /Моя неделя/ }).first().textContent()) ?? "")?.[1] ?? 0);
  const block = Number(/(\d+)/.exec((await page.getByRole("heading", { name: /^Ждёт вас/, level: 2 }).textContent()) ?? "")?.[1] ?? 0);
  expect(menu, "число у пункта меню и в заголовке блока").toBe(block);
  expect(menu).toBeGreaterThan(0);
  for (const name of [/^Мне/, /Один на один/]) await expect(page.getByRole("link", { name })).toHaveCount(0);
  if (isPhone()) {
    // Нижнее меню: четыре пункта и «Ещё», в «Ещё» убранных разделов тоже нет
    const bottom = page.locator("nav.fixed");
    await expect(bottom.getByRole("link")).toHaveText([/Моя неделя/, "Weekly", "Задачи", "Люди"]);
    await bottom.getByRole("button", { name: "Ещё" }).click();
    const more = page.getByRole("dialog", { name: "Разделы" });
    await expect(more.getByRole("link", { name: "Roadmap" })).toBeVisible();
    for (const name of [/^Мне/, /Один на один/, /Моя неделя/]) await expect(more.getByRole("link", { name })).toHaveCount(0);
    await shot(page, "more");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Поиск и действия" }).click();
  } else {
    await page.keyboard.press("Control+k");
  }
  const palette = page.getByRole("combobox", { name: "Поиск и действия" });
  await expect(palette).toBeFocused();
  await palette.fill("один на один");
  await expect(page.getByRole("option", { name: /Открыть: Один на один/ })).toHaveCount(0);
  await palette.fill("мне");
  await page.getByRole("option", { name: /Открыть: Моя неделя/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("/me, /me#группа, /one-on-one и вложенные ведут на «Мою неделю», к нужной группе", async ({ page, request }) => {
  await decisionEvent("e2e76-redirect");
  // Без входа: временный переход на «Мою неделю», дальше она сама отправит на вход
  for (const path of ["/me", "/one-on-one", "/one-on-one/reva", "/one-on-one?pair=x"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(new URL(res.headers().location!, "http://x").pathname, path).toBe("/");
  }
  await enter(page, "Рева Тарас");
  await page.goto("/me");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /^Ждёт вас/, level: 2 })).toBeVisible();
  // Старая ссылка на группу «Прочитать»: тот же якорь на «Моей неделе», заголовок группы виден под шапкой
  await page.goto("/me#me-read");
  await expect(page).toHaveURL(/\/#me-read$/);
  await expect(page.getByTestId("me-read").getByRole("heading", { name: /^Прочитать/ })).toBeInViewport();
  await expect(page.getByTestId("me-read").getByText("Вы владелец решения встречи: проверить тариф")).toBeVisible();
  for (const path of ["/one-on-one", "/one-on-one/muradyan"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /^Ждёт вас/, level: 2 })).toBeVisible();
  }
  await shot(page, "home");
});

test("«Не сдан weekly за неделю N»: строка прошлой открытой недели ведёт на её сдачу, закрытая неделя строки не даёт", async ({ page }) => {
  const [{ created }] = await sql(`SELECT "createdAt" AS created FROM people WHERE slug = 'reva'`);
  // Понедельник позапрошлой недели всегда раньше отчётной; срок прошёл; человек в ресурсе давно
  const [week] = await sql(
    `INSERT INTO weeks (id, start, "isoYear", "isoNumber", deadline, "meetingDate")
     SELECT 'w-e2e76', d, EXTRACT(isoyear FROM d)::int, EXTRACT(week FROM d)::int, ((d + 7)::timestamp + time '18:00') AT TIME ZONE 'Europe/Moscow', d + 8
     FROM (SELECT (date_trunc('week', now() AT TIME ZONE 'Europe/Moscow')::date - 14) AS d) x
     RETURNING start::text AS start, "isoNumber" AS number`,
  );
  try {
    await sql(`UPDATE people SET "createdAt" = '2020-01-01' WHERE slug = 'reva'`);
    await enter(page, "Рева Тарас");
    const missed = page.getByTestId("my-missed-weekly");
    const link = missed.getByRole("link", { name: `Не сдан weekly за неделю ${week!.number}` });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/weekly/submit?week=${week!.start}`);
    // Строка выше блока «Сейчас»: сначала то, что требует действия
    const missedBox = await missed.boundingBox();
    const now = await page.getByRole("heading", { name: /^Мой weekly за неделю/ }).boundingBox();
    expect(missedBox!.y).toBeLessThan(now!.y);
    await shot(page, "missed");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/weekly/submit\\?week=${week!.start}$`));
    await expect(page.getByRole("heading", { level: 1, name: /^Weekly за неделю \d+$/ })).toBeVisible();

    // Сдал за ту неделю: строки нет
    await sql(`INSERT INTO weekly_reports (id, "weekId", "authorId", headline, state, "submittedAt", "updatedAt") SELECT 'wr-e2e76', 'w-e2e76', id, 'Сдано', 'LATE', now(), now() FROM people WHERE slug = 'reva'`);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /^Ждёт вас/ })).toBeVisible();
    await expect(page.getByTestId("my-missed-weekly")).toHaveCount(0);
    // Черновик и неделю закрыли после встречи: строки тоже нет
    await sql(`UPDATE weekly_reports SET state = 'DRAFT', "submittedAt" = NULL WHERE id = 'wr-e2e76'`);
    await page.reload();
    await expect(page.getByTestId("my-missed-weekly")).toBeVisible();
    await sql(`UPDATE weeks SET "closedAt" = now() WHERE id = 'w-e2e76'`);
    await page.reload();
    await expect(page.getByRole("heading", { name: /^Ждёт вас/ })).toBeVisible();
    await expect(page.getByTestId("my-missed-weekly")).toHaveCount(0);
  } finally {
    await sql(`UPDATE people SET "createdAt" = $1 WHERE slug = 'reva'`, [created]);
    await sql(`DELETE FROM weekly_reports WHERE id = 'wr-e2e76'`);
    await sql(`DELETE FROM weeks WHERE id = 'w-e2e76'`);
  }
});
