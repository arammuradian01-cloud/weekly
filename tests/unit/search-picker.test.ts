// Поиск в длинных списках (этап 53): люди всей компании ищутся по фамилии, имени, должности и подразделению
import { describe, expect, it } from "vitest";
import { matchOption, searchKey } from "@/components/ui/search-picker";

const pogosova = { value: "pogosova", label: "Погосова Сабина Левоновна", hint: "Finance coordinator, Направление доходного учёта" };

describe("поиск человека в списке", () => {
  it("каждое слово запроса где-то в имени или второй строке, регистр и ё не важны", () => {
    expect(matchOption(pogosova, "")).toBe(true);
    expect(matchOption(pogosova, "погос")).toBe(true);
    expect(matchOption(pogosova, "сабина погосова")).toBe(true);
    expect(matchOption(pogosova, "finance доходного")).toBe(true);
    expect(matchOption(pogosova, "учета")).toBe(true);
    expect(matchOption(pogosova, "погосова кацемба")).toBe(false);
    expect(searchKey("  Ёлкин   Эдуард ")).toBe("елкин эдуард");
  });
});
