// Подбор цели к задаче по тексту (этап 55)
import { describe, expect, it } from "vitest";
import { bestGoal, mentionsCode, rankGoals, stem, tokens } from "@/lib/goals/match";

const GOALS = [
  { id: "osago", code: "РТ-1", title: "Рост выручки ОСАГО до 120 млн в месяц", metric: "Выручка ОСАГО, млн" },
  { id: "kasko", code: "РТ-2", title: "Запуск КАСКО в партнёрском канале", metric: "Продажи КАСКО у партнёров" },
  { id: "crm", code: "РТ-3", title: "Снизить отток клиентов через CRM-рассылки", metric: "Доля повторных покупок" },
  { id: "mortgage", code: "РТ-4", title: "Ипотечное страхование: конверсия в оплату 12%", metric: "Конверсия ипотечного страхования" },
];

describe("подбор цели по тексту задачи", () => {
  it("основа слова и служебные слова", () => {
    expect(stem("калькуляторов")).toBe(stem("калькулятор"));
    expect(stem("партнёрском")).toBe(stem("партнерский").slice(0, stem("партнёрском").length));
    expect(tokens("Обновить калькулятор ОСАГО для партнёров и CRM")).toEqual(expect.arrayContaining([stem("осаго"), "crm"]));
    expect(tokens("и в на для")).toEqual([]);
  });

  it("задача про ОСАГО подбирает цель ОСАГО, про КАСКО у партнёров цель КАСКО", () => {
    expect(bestGoal(rankGoals("Обновить коэффициенты в калькуляторе ОСАГО", GOALS))).toBe("osago");
    expect(bestGoal(rankGoals("Подключить КАСКО у двух новых партнёров", GOALS))).toBe("kasko");
    expect(bestGoal(rankGoals("Письмо клиентам об оттоке: сегмент для CRM", GOALS))).toBe("crm");
    expect(bestGoal(rankGoals("Поднять конверсию ипотечного страхования на шаге оплаты", GOALS))).toBe("mortgage");
  });

  it("номер цели в тексте подбирает её сразу; общий текст ничего не подставляет", () => {
    expect(mentionsCode("Сделать по РТ-2 до пятницы", "РТ-2")).toBe(true);
    expect(mentionsCode("сделать по рт 2", "РТ-2")).toBe(true);
    expect(mentionsCode("сделать по рт-21", "РТ-2")).toBe(false);
    expect(bestGoal(rankGoals("Подготовить материалы по РТ-3", GOALS))).toBe("crm");
    expect(bestGoal(rankGoals("Подготовить презентацию для встречи", GOALS))).toBeNull();
    expect(rankGoals("Что угодно", [])).toEqual([]);
  });
});
