import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { formatDate, formatNumber } from "@/lib/goals/xlsx-text";
import { mergeArea, prepareXlsx, XlsxError } from "@/lib/goals/xlsx-safe";

// Текст ячеек борда как на экране таблицы (этап 31) и подготовка файла до чтения: ненужные листы пустые,
// огромные объединения и раздутые части отклоняются

describe("числа и даты как на экране", () => {
  it("проценты, разряды, знаки после запятой, общий и текстовый формат", () => {
    expect(formatNumber(0.15, "0%")).toBe("15%");
    expect(formatNumber(0.155, "0.0%")).toBe("15,5%");
    expect(formatNumber(29250000, "#,##0")).toBe("29 250 000");
    expect(formatNumber(1234.5, "#,##0.00")).toBe("1 234,50");
    expect(formatNumber(-0.4, "0%")).toBe("-40%");
    expect(formatNumber(0.1 + 0.2, "General")).toBe("0,3");
    expect(formatNumber(68, undefined)).toBe("68");
    expect(formatNumber(1.5, "@")).toBe("1,5");
  });

  it("подписи формата остаются: млн, рубли", () => {
    expect(formatNumber(29.25, '0.00" млн"')).toBe("29,25 млн");
    expect(formatNumber(1500000, '#,##0 "₽"')).toBe("1 500 000 ₽");
    expect(formatNumber(1500, "[$₽-419]#,##0")).toBe("₽1 500");
  });

  it("дата без часового пояса", () => {
    expect(formatDate(new Date(Date.UTC(2026, 11, 15)))).toBe("15.12.2026");
  });
});

/** Книга из двух листов: «Зарплаты» и «Цели CPO» */
async function workbook(): Promise<ArrayBuffer> {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Зарплаты").addRow(["Рева Тарас", 999999]);
  book.addWorksheet("Цели CPO").addRow(["CPO - Рева Тарас"]);
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

/** Подменить XML листа «Цели CPO» (второй лист) */
async function patchSheet(data: ArrayBuffer, patch: (xml: string) => string): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
  zip.file("xl/worksheets/sheet2.xml", patch(xml));
  return (await zip.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;
}

describe("подготовка файла до чтения", () => {
  it("лист, который не читаем, становится пустым: зарплаты в память не попадают", async () => {
    const safe = await prepareXlsx(await workbook(), (name) => name.startsWith("Цели"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(safe.buffer.slice(safe.byteOffset, safe.byteOffset + safe.byteLength) as ArrayBuffer);
    expect(book.worksheets.map((w) => w.name)).toEqual(["Зарплаты", "Цели CPO"]);
    expect(book.getWorksheet("Зарплаты")!.rowCount).toBe(0);
    expect(book.getWorksheet("Цели CPO")!.getCell("A1").text).toBe("CPO - Рева Тарас");
    expect(new TextDecoder().decode(safe)).not.toMatch(/999999/);
  });

  it("огромное объединение ячеек на листе целей отклоняется до чтения", async () => {
    expect(mergeArea("A1:J1048576")).toBe(10 * 1048576);
    expect(mergeArea("B3:B4")).toBe(2);
    const bomb = await patchSheet(await workbook(), (xml) => xml.replace("</sheetData>", '</sheetData><mergeCells count="1"><mergeCell ref="A1:J1048576"/></mergeCells>'));
    await expect(prepareXlsx(bomb, (name) => name.startsWith("Цели"))).rejects.toThrow(/объединён слишком большой диапазон/);
    // На листе, который не читаем, объединение не важно: лист заменяется пустым
    await expect(prepareXlsx(bomb, () => false)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("часть архива, которая раздувается при распаковке, отклоняется по ходу распаковки", async () => {
    const big = await patchSheet(await workbook(), (xml) => xml.replace("</sheetData>", `</sheetData><!--${"x".repeat(25 * 1024 * 1024)}-->`));
    await expect(prepareXlsx(big, (name) => name.startsWith("Цели"))).rejects.toThrow(/слишком большая после распаковки/);
  });

  it("не архив: понятная ошибка", async () => {
    await expect(prepareXlsx(new TextEncoder().encode("это не xlsx").buffer as ArrayBuffer, () => true)).rejects.toBeInstanceOf(XlsxError);
  });
});
