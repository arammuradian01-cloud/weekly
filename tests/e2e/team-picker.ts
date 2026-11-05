// Выбор команды в шапке (этап 74): раньше это был системный список и `selectOption`, теперь окно с поиском.
// Помощники держат этот способ в одном месте: специй по командам три, и повторять разметку в каждой незачем.
// Отдельный файл, а не helpers.ts: тот занят открытыми PR.

import { expect, type Page } from "@playwright/test";

/** Кнопка переключателя: на телефоне свой экземпляр в шапке раздела */
export function teamSwitcher(page: Page, phone: boolean) {
  return page.locator(phone ? "#team-switcher-m" : "#team-switcher");
}

/** Какая команда выбрана сейчас: раньше это была `toHaveValue` у `select` */
export async function expectTeam(page: Page, phone: boolean, id: string) {
  await expect(teamSwitcher(page, phone)).toHaveAttribute("data-team", id);
}

/**
 * Сменить команду: открыть окно, при необходимости найти команду поиском и выбрать её. query: что набрать в поиске,
 * когда команда не на виду. Проверяем, что окно закрылось и выбор поменялся
 */
export async function pickTeam(page: Page, phone: boolean, id: string, query?: string) {
  await teamSwitcher(page, phone).click();
  const picker = page.getByTestId("team-picker");
  await expect(picker).toBeVisible();
  if (query) await picker.getByRole("combobox").fill(query);
  // Команда бывает сразу в «Ваших командах» и в «Все команды»: берём первый подходящий пункт
  await picker.locator(`[role="option"][data-team="${id}"]`).first().click();
  await expect(picker).toHaveCount(0);
  await expectTeam(page, phone, id);
}

/** Открыть окно выбора и уйти по ссылке «Управлять командами»: команду она не меняет (этап 64) */
export async function openTeamsScreen(page: Page, phone: boolean) {
  await teamSwitcher(page, phone).click();
  const picker = page.getByTestId("team-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("link", { name: "Управлять командами" }).click();
}
