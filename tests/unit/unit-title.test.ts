import { describe, expect, it } from "vitest";
import { unitTitle } from "@/lib/org/tree-groups";

// Этап 68: вид подразделения не повторяется («Функция Функция: ...»). Правило уже в unitTitle (этап 57) и стоит в
// structure-screen.tsx и people-tree.tsx; тест закрепляет случаи из разбора этапа 59

describe("unitTitle: вид подразделения не пишется дважды", () => {
  it("вид уже в названии: двоеточие, пробел, в конце, другим регистром", () => {
    expect(unitTitle({ name: "Функция: продажи ОСАГО", kind: "FUNCTION" }).kind).toBeNull();
    expect(unitTitle({ name: "Функция продаж", kind: "FUNCTION" }).kind).toBeNull();
    expect(unitTitle({ name: "Финансовый департамент", kind: "DEPARTMENT" }).kind).toBeNull();
    expect(unitTitle({ name: "отдел аналитики", kind: "DIVISION" }).kind).toBeNull();
  });

  it("вида в названии нет: подпись нужна", () => {
    expect(unitTitle({ name: "Продажи партнёрам", kind: "MANAGEMENT" }).kind).toBe("Управление");
    expect(unitTitle({ name: "Сопровождение партнёров", kind: "FUNCTION" }).kind).toBe("Функция");
    expect(unitTitle({ name: "Функциональный блок", kind: "FUNCTION" }).kind).toBe("Функция");
  });

  it("неизвестный вид не подписывается, название не меняется", () => {
    expect(unitTitle({ name: "Проектный офис", kind: "OTHER" })).toEqual({ kind: null, name: "Проектный офис" });
  });
});
