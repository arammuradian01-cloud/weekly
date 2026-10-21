// Этап 57: подчинённые на схеме по подразделениям ветки на всю глубину, без повтора вида в подписи
import { describe, expect, it } from "vitest";
import { groupReports, unitTitle } from "@/lib/org/tree-groups";
import type { TreePerson, TreeUnit } from "@/lib/org/people-tree";

const unit = (id: string, name: string, kind: string, parentId: string | null, head: string | null, order: number): TreeUnit => ({ id, name, kind, parentId, head, order });
const person = (slug: string, unitId: string | null, extra: Partial<TreePerson> = {}): TreePerson => ({
  slug,
  fullName: slug,
  position: null,
  unit: null,
  unitId,
  manager: null,
  functional: null,
  reports: [],
  total: 0,
  depth: 0,
  leads: [],
  memberOf: [],
  vacancies: [],
  work: true,
  weekly: true,
  ...extra,
});

const units: Record<string, TreeUnit> = {
  dep: unit("dep", "Департамент страхования и инвестиций", "DEPARTMENT", null, "aram", 0),
  biz: unit("biz", "Управление бизнес развития", "MANAGEMENT", "dep", "golovkin", 1),
  sales: unit("sales", "Отдел по развитию бизнеса", "DIVISION", "biz", null, 2),
  tele: unit("tele", "Сектор Телемаркетинга", "SECTOR", "sales", null, 3),
  partners: unit("partners", "Сектор партнёрских продаж", "SECTOR", "sales", "lead", 4),
  fin: unit("fin", "Отдел финансовой координации", "DIVISION", null, null, 5),
};

describe("подчинённые по подразделениям", () => {
  it("раскладывает прямых подчинённых по отделам и секторам ветки, прочих отдельно", () => {
    const people: Record<string, TreePerson> = {
      golovkin: person("golovkin", "biz", { reports: ["a", "b", "c", "lead", "d", "x"] }),
      a: person("a", "tele"),
      b: person("b", "tele"),
      c: person("c", "sales"),
      lead: person("lead", "partners", { total: 4 }),
      d: person("d", "biz"),
      x: person("x", "fin"),
    };
    const g = groupReports(people.golovkin!, { people, units })!;
    expect(g.root.id).toBe("biz");
    expect(g.direct).toEqual(["d"]);
    expect(g.other).toEqual(["x"]);
    expect(g.groups.map((x) => x.unit.id)).toEqual(["sales"]);
    const sales = g.groups[0]!;
    expect(sales.people).toEqual(["c"]);
    expect(sales.children.map((x) => [x.unit.id, x.people, x.total])).toEqual([
      ["tele", ["a", "b"], 2],
      // Руководитель сектора и четверо под ним
      ["partners", ["lead"], 5],
    ]);
    expect(sales.total).toBe(8);
  });

  it("нечего раскладывать: все в одном подразделении или подразделение не известно", () => {
    const people = { boss: person("boss", "tele", { reports: ["a", "b"] }), a: person("a", "tele"), b: person("b", "tele") };
    expect(groupReports(people.boss, { people, units })).toBeNull();
    const lost = { boss: person("boss", null, { reports: ["a"] }), a: person("a", "tele") };
    expect(groupReports(lost.boss, { people: lost, units })).toBeNull();
  });

  it("из нескольких подразделений руководителя берётся самое верхнее", () => {
    const both = { ...units, tele: { ...units.tele!, head: "aram" } };
    const people = { aram: person("aram", "dep", { reports: ["a", "g"] }), a: person("a", "tele"), g: person("g", "biz") };
    const g = groupReports(people.aram, { people, units: both })!;
    expect(g.root.id).toBe("dep");
    expect(g.groups[0]!.unit.id).toBe("biz");
  });
});

describe("подпись подразделения", () => {
  it("вид не повторяется, если он уже в названии", () => {
    expect(unitTitle({ name: "Функция: аналитика", kind: "FUNCTION" })).toEqual({ kind: null, name: "Функция: аналитика" });
    expect(unitTitle({ name: "Финансовый департамент", kind: "DEPARTMENT" })).toEqual({ kind: null, name: "Финансовый департамент" });
    expect(unitTitle({ name: "Сектор Телемаркетинга", kind: "SECTOR" })).toEqual({ kind: null, name: "Сектор Телемаркетинга" });
    expect(unitTitle({ name: "Аналитика", kind: "FUNCTION" })).toEqual({ kind: "Функция", name: "Аналитика" });
  });
});
