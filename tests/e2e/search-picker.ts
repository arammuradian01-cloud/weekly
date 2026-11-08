import { expect, type Locator } from "@playwright/test";

/** Список связан с полем через aria-controls, но находится в портале вне формы. */
export async function pickerList(field: Locator) {
  const id = await field.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  return field.page().locator(`[id=${JSON.stringify(id)}]`);
}
