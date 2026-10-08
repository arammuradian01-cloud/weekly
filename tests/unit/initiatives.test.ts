import { describe, expect, it } from "vitest";
import { agendaTitle, cleanNote, cleanTitle, daysBetween, flagsOf, isResultCode, isStateCode, LONG_SEARCH_DAYS, STALE_DAYS, weeksText } from "@/lib/initiatives/rules";
import { eventPhrase, pathOf } from "@/lib/letters/phrases";

// Шкала готовности крупных инициатив (этап 30): сроки, метки, пункт повестки, тексты

const day = 86_400_000;
const now = new Date("2026-10-20T09:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * day);

describe("шкала готовности", () => {
  it("недели словами", () => {
    expect(weeksText(3)).toBe("меньше недели");
    expect(weeksText(7)).toBe("1 неделю");
    expect(weeksText(21)).toBe("3 недели");
    expect(weeksText(35)).toBe("5 недель");
    expect(weeksText(77)).toBe("11 недель");
    expect(weeksText(154)).toBe("22 недели");
    expect(daysBetween(ago(2.5), now)).toBe(2);
    expect(daysBetween(now, ago(1))).toBe(0);
  });

  it("долго ищем: только в поиске и дольше 4 недель; без новостей: заметка старше 14 дней; у закрытой меток нет", () => {
    expect(flagsOf({ state: "searching", stateSince: ago(LONG_SEARCH_DAYS), noteAt: ago(1), closed: false }, now)).toMatchObject({ longSearch: false, stale: false });
    expect(flagsOf({ state: "searching", stateSince: ago(LONG_SEARCH_DAYS + 1), noteAt: ago(1), closed: false }, now)).toMatchObject({ longSearch: true, stale: false, searchDays: 29 });
    expect(flagsOf({ state: "doing", stateSince: ago(90), noteAt: ago(STALE_DAYS + 1), closed: false }, now)).toMatchObject({ longSearch: false, stale: true, searchDays: 0, staleDays: 15 });
    expect(flagsOf({ state: "searching", stateSince: ago(90), noteAt: ago(90), closed: true }, now)).toMatchObject({ longSearch: false, stale: false });
  });

  it("пункт повестки вопросом: сначала долгий поиск, потом отсутствие новостей", () => {
    const both = flagsOf({ state: "searching", stateSince: ago(36), noteAt: ago(20), closed: false }, now);
    expect(agendaTitle("Подписка ОСАГО", both)).toBe("Инициатива «Подписка ОСАГО» ищет, как сделать, уже 5 недель. Что мешает начать?");
    const stale = flagsOf({ state: "doing", stateSince: ago(36), noteAt: ago(20), closed: false }, now);
    expect(agendaTitle("Подписка ОСАГО", stale)).toBe("Инициатива «Подписка ОСАГО» без новостей 20 дн. Где она сейчас?");
    expect(agendaTitle("Подписка ОСАГО", flagsOf({ state: "doing", stateSince: ago(3), noteAt: ago(3), closed: false }, now))).toBeNull();
  });

  it("тексты: без длинного тире, с пределом длины; коды делений и итогов", () => {
    expect(cleanTitle("  Скоринг — в выдаче  ")).toBe("Скоринг - в выдаче");
    expect(cleanTitle("а".repeat(200))).toHaveLength(120);
    expect(cleanNote("б".repeat(400))).toHaveLength(300);
    expect(isStateCode("doing")).toBe(true);
    expect(isStateCode("DOING")).toBe(false);
    expect(isResultCode("dropped")).toBe(true);
    expect(isResultCode("lost")).toBe(false);
  });

  it("событие «Мне»: фраза и ссылка на карточку инициативы", () => {
    expect(eventPhrase({ kind: "INITIATIVE", count: 1, actorName: "Арам", taskNumber: null } as never)).toContain("крупная инициатива");
    expect(pathOf({ taskNumber: null, entryId: null, subject: "initiative:abc123" })).toBe("/initiatives#i-abc123");
  });
});
