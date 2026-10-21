// Замок на имена листов (этап 51): вкладки в таблице-связке создаёт Apps Script scripts/sheets/svyazka-lrf.gs, а
// читает их ресурс по именам из spec.ts и partners.ts. Имена живут в двух местах по природе дела: скрипт работает
// внутри Google и импортировать код ресурса не может. Тест сверяет списки, чтобы переименование не разъехалось

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHEETS } from "@/lib/plan/spec";
import { PARTNER_PNL_SHEET, PARTNER_SHEETS } from "@/lib/plan/partners";

const script = readFileSync(new URL("../../scripts/sheets/svyazka-lrf.gs", import.meta.url), "utf8");

/** Строка списка REQUIRED для одного источника: из неё достаём имена листов в кавычках */
function required(source: "LRF" | "B2B"): string[] {
  const line = new RegExp(`\\[${source}\\]: \\[(.*)\\],`).exec(script);
  if (!line) throw new Error(`В скрипте связки нет списка REQUIRED для ${source}`);
  return [...line[1]!.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
}

describe("скрипт таблицы-связки", () => {
  it("связывает первыми те листы LRF, которые читает прогноз", () => {
    expect(required("LRF").sort()).toEqual([...SHEETS].sort());
  });

  it("связывает первыми те листы партнёрского канала, которые читает прогноз", () => {
    const want = [...PARTNER_SHEETS.map((s) => s.name), PARTNER_PNL_SHEET];
    expect(required("B2B").sort()).toEqual([...want].sort());
  });
});
