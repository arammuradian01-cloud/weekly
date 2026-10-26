import { describe, expect, it } from "vitest";
import { MAIN_NAV, MANAGEMENT_NAV, NAV_GROUPS, mobileItems, visibleGroups } from "@/components/shell/nav";

// Этап 41: меню группами, на телефоне четыре пункта и «Ещё»

describe("меню", () => {
  it("группы и порядок разделов", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Моё", "Команда", "Бизнес"]);
    expect(MAIN_NAV.map((i) => i.href)).toEqual(["/", "/me", "/one-on-one", "/weekly", "/leader-report", "/tasks", "/roadmap", "/people", "/goals", "/initiatives", "/decisions", "/forecast", "/market", "/news"]);
    // Этап 62: «Рынок» закрытый раздел, пункт видят только те, кому он открыт
    // Этап 73: «Отчёт руководителю» вместо «Отчёта CEO», в группе «Команда»: руководителям, владельцам и получателям
    expect(MAIN_NAV.filter((i) => i.restricted).map((i) => i.href)).toEqual(["/leader-report", "/market"]);
    expect(NAV_GROUPS.find((g) => g.label === "Команда")!.items.find((i) => i.href === "/leader-report")?.label).toBe("Отчёт руководителю");
    expect(MANAGEMENT_NAV.map((i) => i.href)).toEqual(["/journal", "/sync", "/settings"]);
    // Адреса не повторяются и у каждого пункта есть подпись и иконка
    const all = [...MAIN_NAV, ...MANAGEMENT_NAV];
    expect(new Set(all.map((i) => i.href)).size).toBe(all.length);
    for (const i of all) expect(i.label.length > 0 && !!i.icon).toBe(true);
  });

  it("отчёт руководителю виден только тем, кому раздел открыт", () => {
    const team = (access: Parameters<typeof visibleGroups>[0]) => visibleGroups(access).find((g) => g.label === "Команда")!.items.map((i) => i.href);
    expect(team({ market: false })).not.toContain("/leader-report");
    expect(team({ market: false, leaderReport: true })).toContain("/leader-report");
  });

  it("нижнее меню телефона: четыре главных пункта, все из основного меню", () => {
    const items = mobileItems();
    expect(items.map((i) => i.href)).toEqual(["/", "/me", "/weekly", "/tasks"]);
    for (const i of items) expect(MAIN_NAV).toContain(i);
  });
});
