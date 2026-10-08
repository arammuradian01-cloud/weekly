import { describe, expect, it } from "vitest";
import { MAILTO_MAX, MEETINGS_MAX, ceoReportText, cleanMeetings, countSentences, mailtoHref } from "@/lib/ceo/text";

// Отчёт CEO 2.0 (этап 27): встречи недели, текст отчёта и черновик письма

describe("мои встречи недели", () => {
  it("только строки, без длинного тире, пустые убираются, не больше двенадцати", () => {
    expect(cleanMeetings(null)).toEqual([]);
    expect(cleanMeetings("встреча")).toEqual([]);
    expect(
      cleanMeetings([
        { title: "  С партнёрами —  по ноябрю ", text: "Договорились → о скидке." },
        { title: "", text: "   " },
        { title: 5, text: ["нет"] },
        null,
        { title: "Только тема" },
      ]),
    ).toEqual([
      { title: "С партнёрами - по ноябрю", text: "Договорились - о скидке." },
      { title: "Только тема", text: "" },
    ]);
    expect(cleanMeetings(Array.from({ length: 20 }, (_, i) => ({ title: `Встреча ${i}`, text: "" })))).toHaveLength(MEETINGS_MAX);
    expect(cleanMeetings([{ title: "т".repeat(500), text: "x".repeat(5000) }])[0]).toMatchObject({ title: "т".repeat(120) });
    expect(cleanMeetings([{ title: "a", text: "x".repeat(5000) }])[0].text).toHaveLength(3000);
  });

  it("счёт предложений для подсказки «4-5 предложений»", () => {
    expect(countSentences("")).toBe(0);
    expect(countSentences("Обсуждали условия на ноябрь. Договорились о скидке! Что дальше? Решение в пятницу.")).toBe(4);
    expect(countSentences("Одно предложение без точки")).toBe(1);
    expect(countSentences("Цена 2.5 млн. Срок пятница.")).toBe(2);
    expect(countSentences("...")).toBe(0);
  });
});

describe("текст отчёта", () => {
  const base = {
    weekNumber: 41,
    numbers: ["ОСАГО: 1 200 полисов"],
    main: "Запустили пилот",
    decisions: [{ text: "Скидка партнёрам в ноябре", owner: "Рева Тарас" }, { text: "Без владельца", owner: null }],
    risks: "",
    next: "Итоги пилота",
    thanks: [{ name: "Алсу С.", text: "за запуск" }],
    meetings: [
      { title: "С партнёрами", text: "Обсуждали ноябрь. Договорились." },
      { title: "", text: "Без темы." },
    ],
  };

  it("разделы по порядку ТЗ: цифры, главное, решения, риски, что дальше, благодарности, мои встречи", () => {
    const text = ceoReportText(base);
    const order = ["Цифры недели", "Главное за неделю", "Решения недели", "Риски", "Что дальше", "Благодарности", "Мои встречи недели"].map((h) => text.indexOf(`\n${h}\n`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text.startsWith("Отчёт за неделю 41\n")).toBe(true);
    expect(text).toContain("- Скидка партнёрам в ноябре. Владелец: Рева Тарас\n- Без владельца\n");
    // Пустой раздел: дефис, а не пропуск
    expect(text).toContain("Риски\n-\n");
    expect(text).toContain("Мои встречи недели\nС партнёрами\nОбсуждали ноябрь. Договорились.\n\nВстреча\nБез темы.");
    expect(text.endsWith("Без темы.")).toBe(true);
  });

  it("без решений, благодарностей и встреч эти разделы не печатаются", () => {
    const text = ceoReportText({ ...base, decisions: [], thanks: [], meetings: [] });
    expect(text).not.toContain("Решения недели");
    expect(text).not.toContain("Благодарности");
    expect(text).not.toContain("Мои встречи недели");
    expect(text.endsWith("Что дальше\nИтоги пилота")).toBe(true);
  });

  it("прогноз и обещания идут после цифр", () => {
    const text = ceoReportText({ ...base, forecast: ["КАСКО: 95% плана"], promises: "Сделано 7 из 10 (70%)" });
    expect(text.indexOf("Прогноз до конца месяца")).toBeGreaterThan(text.indexOf("Цифры недели"));
    expect(text.indexOf("Обещания недели")).toBeLessThan(text.indexOf("Главное за неделю"));
  });
});

describe("черновик письма", () => {
  it("тема и текст в адресе, строки через CRLF", () => {
    const href = mailtoHref("Отчёт за неделю 41", "Строка 1\nСтрока 2")!;
    expect(href.startsWith("mailto:?subject=")).toBe(true);
    const url = new URL(href);
    expect(url.searchParams.get("subject")).toBe("Отчёт за неделю 41");
    expect(url.searchParams.get("body")).toBe("Строка 1\r\nСтрока 2");
  });

  it("слишком длинный текст: null, экран кладёт его в буфер", () => {
    expect(mailtoHref("Тема", "я".repeat(MAILTO_MAX))).toBeNull();
    expect(mailtoHref("Тема", "")).not.toBeNull();
  });
});
