import { describe, expect, it } from "vitest";
import { pickFigures, type Figure } from "@/components/ui/data";

// Строка цифр под заголовком (этап 42, тест добавлен на этапе 43). Нули не показываются, в строке не больше трёх, тревожные важнее, порядок исходный

const items: Figure[] = [
  { label: "открыто", value: 36, keepZero: true },
  { label: "просрочено", value: 12, tone: "danger" },
  { label: "заблокировано", value: 0, tone: "warning" },
  { label: "срок на этой неделе", value: 23 },
  { label: "давно без обновлений", value: 14, tone: "warning" },
];

describe("строка цифр", () => {
  it("прячет нули, кроме отмеченных keepZero", () => {
    expect(pickFigures(items).map((f) => f.label)).toEqual(["открыто", "просрочено", "срок на этой неделе", "давно без обновлений"]);
    expect(pickFigures([{ label: "открыто", value: 0, keepZero: true }, { label: "просрочено", value: "0", tone: "danger" }]).map((f) => f.label)).toEqual(["открыто"]);
  });
  it("оставляет не больше max: keepZero, потом тревожные по оттенку, потом остальные, в исходном порядке", () => {
    expect(pickFigures(items, 3).map((f) => f.label)).toEqual(["открыто", "просрочено", "давно без обновлений"]);
    expect(pickFigures(items, 2).map((f) => f.label)).toEqual(["открыто", "просрочено"]);
    // Ноль с оттенком не считается тревожным
    const zeroDanger: Figure[] = [{ label: "а", value: 5 }, { label: "б", value: 0, tone: "danger", keepZero: true }, { label: "в", value: 3, tone: "warning" }];
    expect(pickFigures(zeroDanger, 2).map((f) => f.label)).toEqual(["б", "в"]);
  });
  it("без max и при нехватке цифр ничего не режет", () => {
    expect(pickFigures(items, 10)).toHaveLength(4);
    expect(pickFigures([], 3)).toEqual([]);
  });
});
