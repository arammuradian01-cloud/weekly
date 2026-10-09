import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { formatDate, formatNumber, unpackedSize } from "@/lib/goals/xlsx-text";

// Текст ячеек борда как на экране таблицы (этап 31): проценты, разряды, даты. И проверка архива до распаковки

describe("числа и даты как на экране", () => {
  it("проценты, разряды, знаки после запятой, общий формат", () => {
    expect(formatNumber(0.15, "0%")).toBe("15%");
    expect(formatNumber(0.155, "0.0%")).toBe("15,5%");
    expect(formatNumber(29250000, "#,##0")).toBe("29 250 000");
    expect(formatNumber(1234.5, "#,##0.00")).toBe("1 234,50");
    expect(formatNumber(-0.4, "0%")).toBe("-40%");
    expect(formatNumber(0.1 + 0.2, "General")).toBe("0,3");
    expect(formatNumber(68, undefined)).toBe("68");
    // Текст в кавычках внутри формата на число не влияет
    expect(formatNumber(1500, '#,##0" руб."')).toBe("1 500");
  });

  it("дата без часового пояса", () => {
    expect(formatDate(new Date(Date.UTC(2026, 11, 15)))).toBe("15.12.2026");
  });
});

describe("архив до распаковки", () => {
  it("настоящий .xlsx: размер после распаковки известен; не архив: null", async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet("Цели CPO").addRow(["CPO - Рева Тарас"]);
    const buffer = new Uint8Array((await book.xlsx.writeBuffer()) as ArrayBuffer);
    const size = unpackedSize(buffer);
    expect(size).toBeGreaterThan(buffer.length);
    expect(unpackedSize(new TextEncoder().encode("это не xlsx"))).toBeNull();
    expect(unpackedSize(new Uint8Array(0))).toBeNull();
  });
});
