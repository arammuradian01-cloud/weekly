// Согласование задач (этап 54): департамент человека по структуре и чтение настройки
import { describe, expect, it } from "vitest";
import { approvalSettingOf, departmentOf } from "@/lib/tasks/approval";

const units = new Map(
  [
    { id: "co", kind: "COMPANY", parentId: null, headId: "ceo", name: "Сравни" },
    { id: "fin", kind: "DEPARTMENT", parentId: "co", headId: "cfo", name: "Финансовый департамент" },
    { id: "acc", kind: "MANAGEMENT", parentId: "fin", headId: "ka", name: "Управление учёта" },
    { id: "sec", kind: "SECTOR", parentId: "acc", headId: null, name: "Сектор" },
    { id: "cc", kind: "MANAGEMENT", parentId: "co", headId: "ev", name: "Управление клиентским сервисом" },
    { id: "ccs", kind: "DIVISION", parentId: "cc", headId: null, name: "Отдел поддержки" },
    { id: "old", kind: "DEPARTMENT", parentId: null, headId: "am", name: "Департамент без компании" },
    { id: "oldm", kind: "MANAGEMENT", parentId: "old", headId: null, name: "Управление" },
  ].map((u) => [u.id, u]),
);

describe("департамент человека", () => {
  it("уровень «департамент» выше по дереву, подразделение прямо под компанией считается своим департаментом", () => {
    expect(departmentOf(units, "sec")?.id).toBe("fin");
    expect(departmentOf(units, "fin")?.id).toBe("fin");
    expect(departmentOf(units, "ccs")?.id).toBe("cc");
    expect(departmentOf(units, "cc")?.id).toBe("cc");
    expect(departmentOf(units, "co")?.id).toBe("co");
    expect(departmentOf(units, "oldm")?.id).toBe("old");
    expect(departmentOf(units, null)).toBeNull();
    expect(departmentOf(units, "нет")).toBeNull();
  });

  it("настройка: неизвестные значения отбрасываются, по умолчанию информирование", () => {
    expect(approvalSettingOf(null)).toEqual({ default: "inform", departments: {} });
    expect(approvalSettingOf({ default: "approve", departments: { a: "off", b: "что-то" } })).toEqual({ default: "approve", departments: { a: "off" } });
    expect(approvalSettingOf({ default: "всегда" }).default).toBe("inform");
  });
});
