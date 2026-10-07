// Этап 21: правила просьб без базы: рабочие дни, зависшая просьба, название задачи из просьбы.
import { describe, expect, it } from "vitest";
import { isRequestOverdue, isStuck, taskTitleFrom, workingDaysAfter } from "@/lib/requests/rules";
import { currentDue, requestStateText } from "@/domain/requests";

describe("рабочие дни", () => {
  it("считаются дни после создания, выходные не в счёт", () => {
    // 2026-10-05 понедельник
    expect(workingDaysAfter("2026-10-05", "2026-10-05")).toBe(0);
    expect(workingDaysAfter("2026-10-05", "2026-10-07")).toBe(2);
    expect(workingDaysAfter("2026-10-05", "2026-10-08")).toBe(3);
    // Пятница, потом выходные, понедельник и вторник
    expect(workingDaysAfter("2026-10-09", "2026-10-12")).toBe(1);
    expect(workingDaysAfter("2026-10-09", "2026-10-13")).toBe(2);
    expect(workingDaysAfter("2026-10-09", "2026-10-14")).toBe(3);
    expect(workingDaysAfter("2026-10-10", "2026-10-05")).toBe(0);
  });
});

describe("зависшая просьба", () => {
  const base = { due: "2026-10-20", acceptedDue: null };
  it("без ответа больше 2 рабочих дней", () => {
    expect(isStuck({ ...base, status: "open", created: "2026-10-05" }, "2026-10-07")).toBe(false);
    expect(isStuck({ ...base, status: "open", created: "2026-10-05" }, "2026-10-08")).toBe(true);
    // Создана в пятницу: в понедельник и вторник ещё не зависла
    expect(isStuck({ ...base, status: "open", created: "2026-10-09" }, "2026-10-13")).toBe(false);
  });
  it("принятая с прошедшим сроком адресата; закрытая не зависает", () => {
    expect(isStuck({ status: "accepted", created: "2026-10-01", due: "2026-10-20", acceptedDue: "2026-10-06" }, "2026-10-07")).toBe(true);
    expect(isStuck({ status: "accepted", created: "2026-10-01", due: "2026-10-01", acceptedDue: "2026-10-09" }, "2026-10-07")).toBe(false);
    expect(isStuck({ status: "done", created: "2026-09-01", due: "2026-09-02", acceptedDue: null }, "2026-10-07")).toBe(false);
    expect(isRequestOverdue({ status: "open", due: "2026-10-06", acceptedDue: null }, "2026-10-07")).toBe(true);
    expect(isRequestOverdue({ status: "declined", due: "2026-10-06", acceptedDue: null }, "2026-10-07")).toBe(false);
  });
});

describe("тексты", () => {
  it("название задачи из длинной просьбы режется по слову", () => {
    expect(taskTitleFrom("Короткая просьба")).toBe("Короткая просьба");
    const long = "Провести два интервью с кандидатами на позицию аналитика КАСКО и прислать короткие заметки по каждому кандидату до конца недели";
    const title = taskTitleFrom(long);
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.endsWith("…")).toBe(true);
    expect(long.startsWith(title.slice(0, -1))).toBe(true);
  });
  it("строка состояния", () => {
    const fmt = (iso: string) => iso.slice(8);
    expect(requestStateText({ status: "open", acceptedDue: null, answer: null }, fmt)).toBe("Ждёт ответа");
    expect(requestStateText({ status: "accepted", acceptedDue: "2026-10-15", answer: null }, fmt)).toBe("Принята, срок 15");
    expect(requestStateText({ status: "declined", acceptedDue: null, answer: "Нет данных" }, fmt)).toBe("Отклонена: Нет данных");
    expect(currentDue({ due: "2026-10-20", acceptedDue: null })).toBe("2026-10-20");
    expect(currentDue({ due: "2026-10-20", acceptedDue: "2026-10-22" })).toBe("2026-10-22");
  });
});
