import { describe, expect, it } from "vitest";
import { COUNTER_HREF, MAIN_NAV, MANAGEMENT_NAV, NAV_GROUPS, mobileItems } from "@/components/shell/nav";

// Этап 41: меню группами, на телефоне четыре пункта и «Ещё»

describe("меню", () => {
  it("группы и порядок разделов", () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(["Моё", "Команда", "Бизнес"]);
    // Этап 76: «Мне» стало блоком «Ждёт вас» на «Моей неделе», «Один на один» удалён
    expect(MAIN_NAV.map((i) => i.href)).toEqual(["/", "/weekly", "/tasks", "/roadmap", "/people", "/goals", "/initiatives", "/decisions", "/forecast", "/market", "/news"]);
    expect(MAIN_NAV.map((i) => i.label)).not.toContain("Мне");
    expect(MAIN_NAV.map((i) => i.label)).not.toContain("Один на один");
    // Счётчик «ждут N» у пункта «Моя неделя»
    expect(COUNTER_HREF).toBe("/");
    expect(MAIN_NAV.find((i) => i.href === COUNTER_HREF)?.label).toBe("Моя неделя");
    // Этап 62: «Рынок» закрытый раздел, пункт видят только те, кому он открыт
    expect(MAIN_NAV.filter((i) => i.restricted).map((i) => i.href)).toEqual(["/market"]);
    expect(MANAGEMENT_NAV.map((i) => i.href)).toEqual(["/ceo-report", "/journal", "/sync", "/settings"]);
    // Адреса не повторяются и у каждого пункта есть подпись и иконка
    const all = [...MAIN_NAV, ...MANAGEMENT_NAV];
    expect(new Set(all.map((i) => i.href)).size).toBe(all.length);
    for (const i of all) expect(i.label.length > 0 && !!i.icon).toBe(true);
  });

  it("нижнее меню телефона: четыре главных пункта, все из основного меню", () => {
    const items = mobileItems();
    expect(items.map((i) => i.href)).toEqual(["/", "/weekly", "/tasks", "/people"]);
    for (const i of items) expect(MAIN_NAV).toContain(i);
  });
});
