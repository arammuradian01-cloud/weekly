// Люди и справочники из базы на экранах (этап 5): снимок подменяет стартовые значения, скрытое остаётся подписью.
import { afterAll, describe, expect, it } from "vitest";
import { applyRegistry, type RegistrySnapshot } from "@/domain/registry";
import { PEOPLE, authorName, compactName, isPersonSlug, personOf } from "@/domain/people";
import { BLOCKS, DIRECTIONS, ENTRY_TYPES, directionLabel, dictOptions, entryTypeLabel } from "@/domain/dictionaries";
import { isStale, staleDays } from "@/lib/tasks/rules";
import { slugify, uniqueSlug } from "@/lib/translit";

const base = {
  people: PEOPLE.map((p) => ({ ...p, active: true })),
  dicts: {
    DIRECTION: DIRECTIONS.map((d) => ({ ...d, active: true })),
    WEEKLY_BLOCK: BLOCKS.map((d) => ({ ...d, active: true })),
    ENTRY_TYPE: ENTRY_TYPES.map((d) => ({ ...d, active: true })),
    TASK_SOURCE: [{ code: "meeting", label: "Встреча", active: true }],
  },
};
const restore: RegistrySnapshot = { version: "restore", staleDays: 14, ...structuredClone(base) };
afterAll(() => applyRegistry(restore));

describe("снимок людей и справочников", () => {
  it("новый человек виден в списках, выключенный пропадает из выбора, но подписывает старые записи", () => {
    applyRegistry({
      version: "v1",
      staleDays: 14,
      people: [
        ...base.people.filter((p) => p.slug !== "afanasyev"),
        { slug: "afanasyev", fullName: "Афанасьев Павел", shortName: "Павел", role: "LEADER", zone: "", direction: "partners", active: false },
        { slug: "novikova", fullName: "Новикова Анна", shortName: "Анна", role: "LEADER", zone: "Ипотека", direction: "red", active: true },
        { slug: "ceo", fullName: "CEO", shortName: "CEO", role: "OBSERVER", zone: "Чтение", direction: "department", active: true },
      ],
      dicts: base.dicts,
    });
    expect(PEOPLE.some((p) => p.slug === "novikova")).toBe(true);
    expect(PEOPLE.some((p) => p.slug === "afanasyev")).toBe(false);
    // Наблюдатель задач и weekly не ведёт: в списках выбора его нет
    expect(PEOPLE.some((p) => p.slug === "ceo")).toBe(false);
    expect(authorName("afanasyev", "full")).toBe("Афанасьев Павел");
    expect(compactName("novikova")).toBe("Анна Н.");
    expect(isPersonSlug("afanasyev")).toBe(true);
    // Неизвестный код не роняет экран
    expect(personOf("unknown").fullName).toBe("unknown");
  });

  it("скрытое значение не предлагается, но подписывает старые записи и остаётся у текущего выбора", () => {
    applyRegistry({
      version: "v2",
      staleDays: 14,
      people: base.people,
      dicts: {
        ...base.dicts,
        DIRECTION: [...base.dicts.DIRECTION.map((d) => (d.code === "kasko" ? { ...d, active: false } : d)), { code: "zhizn", label: "Жизнь", active: true }],
        ENTRY_TYPE: [...base.dicts.ENTRY_TYPE.map((d) => (d.code === "plan" ? { ...d, label: "План на неделю" } : d)), { code: "idea", label: "Идея", active: true }],
      },
    });
    expect(DIRECTIONS.map((d) => d.code)).not.toContain("kasko");
    expect(DIRECTIONS.map((d) => d.code)).toContain("zhizn");
    expect(directionLabel("kasko")).toBe("КАСКО");
    expect(dictOptions("DIRECTION").some((o) => o.value === "kasko")).toBe(false);
    expect(dictOptions("DIRECTION", "kasko").at(-1)).toEqual({ value: "kasko", label: "КАСКО (скрыто)" });
    expect(entryTypeLabel("plan")).toBe("План на неделю");
    // Тип вне правил отчёта CEO на экран не попадает
    expect(ENTRY_TYPES.map((t) => t.code)).toEqual(["result", "event", "risk", "plan"]);
  });

  it("порог «давно не обновлялась» приходит из настроек", () => {
    applyRegistry({ version: "v3", staleDays: 5, ...structuredClone(base) });
    expect(staleDays()).toBe(5);
    const task = { status: "in-progress", whereUpdatedAt: "2026-09-28" } as Parameters<typeof isStale>[0];
    expect(isStale(task, "2026-10-04")).toBe(true);
    applyRegistry({ version: "v4", staleDays: 14, ...structuredClone(base) });
    expect(isStale(task, "2026-10-04")).toBe(false);
  });
});

describe("коды из русских названий", () => {
  it("латиница, дефисы, свободный номер для занятого", () => {
    expect(slugify("Страхование жизни")).toBe("strakhovanie-zhizni");
    expect(slugify("Щукин Ёжик")).toBe("shchukin-ezhik");
    expect(slugify("!!!")).toBe("item");
    expect(uniqueSlug("reva", ["reva", "reva-2"])).toBe("reva-3");
    expect(uniqueSlug("novikova", ["reva"])).toBe("novikova");
  });
});
