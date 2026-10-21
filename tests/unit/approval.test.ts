// Согласование задач (этап 54): департамент человека по структуре и чтение настройки
import { describe, expect, it } from "vitest";
import { approvalSettingOf, departmentOf } from "@/lib/tasks/approval";
import { permissions } from "@/lib/tasks/rules";
import type { Task } from "@/domain/types";

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

describe("права на задачу, которая ждёт согласования", () => {
  const task = (approver: string | null) =>
    ({
      number: 1,
      title: "Сверка",
      outcome: "Готово",
      owner: "pogosova",
      coExecutors: [],
      direction: "department",
      priority: "medium",
      status: "proposed",
      state: "on-track",
      where: "",
      whereUpdatedAt: "2026-10-21",
      due: "2026-10-30",
      originalDue: "2026-10-30",
      transfers: [],
      source: { kind: "meeting", note: "" },
      links: [],
      comments: [],
      history: [],
      createdBy: "reva",
      createdAt: "2026-10-21",
      updatedAt: "2026-10-21",
      team: "t-reva",
      approval: { state: "pending", approver },
    }) as unknown as Task;

  it("решает согласующий или режим управления; адресат, автор, руководитель команды и наблюдатель нет", () => {
    expect(permissions(task("katsemba"), { slug: "katsemba" as never }).confirm).toBe(true);
    expect(permissions(task("katsemba"), { slug: "admin" as never, management: "ADMIN" }).confirm).toBe(true);
    expect(permissions(task("katsemba"), { slug: "pogosova" as never }).confirm).toBe(false);
    expect(permissions(task("katsemba"), { slug: "reva" as never, leads: ["t-reva"], people: ["pogosova" as never] }).confirm).toBe(false);
    expect(permissions(task("katsemba"), { slug: "obs" as never, observer: true }).confirm).toBe(false);
  });

  it("согласующего удалили: решает только режим управления", () => {
    expect(permissions(task(null), { slug: "pogosova" as never }).confirm).toBe(false);
    expect(permissions(task(null), { slug: "owner" as never, management: "OWNER" }).confirm).toBe(true);
  });
});
