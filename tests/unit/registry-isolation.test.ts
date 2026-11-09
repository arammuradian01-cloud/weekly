import { Writable } from "node:stream";
import { createElement, use } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createRegistryLookup, extendRegistryLookup } from "@/domain/registry-lookup";
import { RegistryContext, useRegistry } from "@/domain/registry-context";
import type { RegistrySnapshot } from "@/domain/registry";
import { dtoPersonLabels } from "@/domain/person-labels";
import { personLabelsOf } from "@/lib/person-labels";

const snapshot = (name: string): RegistrySnapshot => ({
  version: name, staleDays: 14,
  people: [{ slug: "reader", fullName: name, shortName: name, selectable: true }],
  teams: [{ id: "same", name, kind: "CUSTOM", leader: "reader", parent: null, members: ["reader"], active: true }],
  dicts: { DIRECTION: [], WEEKLY_BLOCK: [], ENTRY_TYPE: [], TASK_SOURCE: [] },
});

describe("изоляция справочников", () => {
  it("два незавершённых серверных рендера сохраняют свои подписи после возобновления", async () => {
    function render(name: string) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      function Probe() {
        use(gate);
        const lookup = useRegistry();
        return createElement("p", null, `${lookup.personOf("reader").fullName}/${lookup.teamName("same")}`);
      }
      const result = new Promise<string>((resolve, reject) => {
        let html = "";
        const out = new Writable({ write(chunk, _encoding, done) { html += chunk.toString(); done(); } });
        out.on("finish", () => resolve(html));
        out.on("error", reject);
        const stream = renderToPipeableStream(createElement(RegistryContext.Provider, { value: createRegistryLookup(snapshot(name)) }, createElement(Probe)), {
          onAllReady() { stream.pipe(out); },
          onError(error) { reject(error); },
        });
      });
      return { result, release };
    }
    const a = render("Первая команда");
    const b = render("Вторая команда");
    b.release();
    const second = await b.result;
    a.release();
    const first = await a.result;
    expect(first).toContain("Первая команда/Первая команда");
    expect(first).not.toContain("Вторая команда");
    expect(second).toContain("Вторая команда/Вторая команда");
    expect(second).not.toContain("Первая команда");
  });

  it("историческая подпись не становится кандидатом для назначения и не содержит роли", () => {
    const labels = personLabelsOf({ author: { slug: "past", fullName: "Прежний Автор", shortName: "Автор", role: "ADMIN", active: false, email: "private@example.test" } });
    expect(labels).toEqual([{ slug: "past", fullName: "Прежний Автор", shortName: "Автор" }]);
    const a = createRegistryLookup(snapshot("Читатель"), labels);
    expect(a.personOf("past").fullName).toBe("Прежний Автор");
    expect(a.personOf("past")).not.toHaveProperty("role");
    expect(a.personOf("past")).not.toHaveProperty("active");
    expect(a.PEOPLE.some((p) => p.slug === "past")).toBe(false);
    expect(a.allPeople().some((p) => p.slug === "past")).toBe(false);
    expect(createRegistryLookup(snapshot("Другой")).personOf("past").fullName).toBe("past");
  });

  it("клиент использует только явные подписи DTO и очищает дополнительные поля", () => {
    expect(dtoPersonLabels({ author: { slug: "private", fullName: "Не подпись", shortName: "Нет" } })).toEqual([]);
    expect(dtoPersonLabels({ entry: { peopleLabels: [{ slug: "a", fullName: "Автор", shortName: "А", active: false }] } })).toEqual([{ slug: "a", fullName: "Автор", shortName: "А" }]);
  });
  it("локальные подписи не копируют и не изменяют общий список кандидатов", () => {
    const parent = createRegistryLookup(snapshot("Читатель"));
    const child = extendRegistryLookup(parent, [{ slug: "old", fullName: "Прежний Автор", shortName: "Автор" }]);
    expect(child.PEOPLE).toBe(parent.PEOPLE);
    expect(child.allPeople()).toBe(parent.allPeople());
    expect(child.compactName("old")).toBe("Автор П.");
    expect(parent.personOf("old").fullName).toBe("old");
    expect(extendRegistryLookup(child, [{ slug: "old", fullName: "Повтор", shortName: "Повтор" }])).toBe(child);
  });

});
