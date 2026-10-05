// Мелкие части зеркала в таблицу: диапазоны A1, даты как числа таблицы, сравнение ячеек, ключ служебного аккаунта и вызовы Google.
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { describe, expect, it } from "vitest";
import { colLetter, q } from "@/lib/sheet/client";
import { FakeSheets, parseRange } from "@/lib/sheet/fake";
import { GoogleSheets, GoogleSheetsError, serviceAccountFromEnv } from "@/lib/sheet/google";
import { sameCell, serialDate, serialMoment } from "@/lib/sheet/rows";
import { nextDelay, reconcileWindowStart } from "@/lib/sheet/runner";
import { PROD_SHEET_ID } from "@/lib/sheet/client";

describe("адреса в таблице", () => {
  it("буквы колонок и имена вкладок в кавычках", () => {
    expect([1, 21, 26, 27, 52, 703].map(colLetter)).toEqual(["A", "U", "Z", "AA", "AZ", "AAA"]);
    expect(q("Задачи")).toBe("'Задачи'");
    expect(q("Weekly Арама's")).toBe("'Weekly Арама''s'");
  });

  it("диапазоны A1 разбираются как в Google", () => {
    expect(parseRange("'Задачи'!A1:U1")).toEqual({ title: "Задачи", r0: 0, c0: 0, r1: 1, c1: 21, openRows: false, openCols: false });
    expect(parseRange("'Задачи'!U2:U")).toMatchObject({ r0: 1, c0: 20, c1: 21, openRows: true });
    expect(parseRange("'Задачи'!1:3")).toMatchObject({ r0: 0, r1: 3, c0: 0, openCols: true });
    expect(parseRange("'Сводка'")).toMatchObject({ title: "Сводка", r0: 0, c0: 0 });
    expect(parseRange("'Арама''s'!B3")).toMatchObject({ title: "Арама's", r0: 2, r1: 3, c0: 1, c1: 2 });
    expect(() => parseRange("Задачи!A1")).toThrow(/Непонятный диапазон/);
  });

  it("имитация не отдаёт пустые хвосты и сдвигает строки при удалении", async () => {
    const fake = new FakeSheets(["Т"]);
    await fake.setValues([{ range: "'Т'!A1:C2", values: [["a", "b", ""], ["c", "", ""]] }]);
    expect(await fake.getValues("'Т'!A1:C")).toEqual([["a", "b"], ["c"]]);
    await fake.batchUpdate([{ deleteDimension: { range: { sheetId: fake.tab("Т").sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 } } }]);
    expect(await fake.getValues("'Т'!A1:C")).toEqual([["c"]]);
    // За пределы сетки Google не пишет и не читает, открытые диапазоны обрезает по сетке
    const small = new FakeSheets();
    small.addTab("М", [], { rows: 3, cols: 5 });
    await expect(small.setValues([{ range: "'М'!A4:B4", values: [["x"]] }])).rejects.toThrow(/exceeds grid limits/);
    await expect(small.getValues("'М'!A1:Z3")).rejects.toThrow(/exceeds grid limits/);
    expect(await small.getValues("'М'!1:3")).toEqual([]);
    await small.append("М", [["a"], ["b"], ["c"]]);
    expect(small.tab("М").rows).toBe(3);
    await small.append("М", [["d"]]);
    expect(small.tab("М").rows).toBe(4);
    expect(await small.getValues("'М'!A1:A")).toEqual([["a"], ["b"], ["c"], ["d"]]);
    await small.batchUpdate([{ updateSheetProperties: { properties: { sheetId: small.tab("М").sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } }]);
    await expect(small.batchUpdate([{ deleteDimension: { range: { sheetId: small.tab("М").sheetId, dimension: "ROWS", startIndex: 1, endIndex: 4 } } }])).rejects.toThrow(/non-frozen/);
    expect(() => small.addTab("м")).toThrow(/уже есть/);
    fake.down = true;
    await expect(fake.sheets()).rejects.toThrow(/недоступен/);
  });
});

describe("значения ячеек", () => {
  it("даты пишутся числами таблицы: дни с 30.12.1899, время по Москве до минуты", () => {
    expect(serialDate("1899-12-30")).toBe(0);
    expect(serialDate("2026-10-05")).toBe(46300);
    expect(serialDate(null)).toBe("");
    // 05.10.2026 09:30 по Москве = 06:30 UTC
    expect(serialMoment(new Date("2026-10-05T06:30:42Z"))).toBeCloseTo(46300 + 9.5 / 24, 9);
    expect(serialMoment(new Date("2026-10-05T21:15:00Z"))).toBeCloseTo(46301 + 0.25 / 24, 9);
  });

  it("сравнение ячеек: пусто равно пустому, числа с хвостом после запятой равны, текст сравнивается точно", () => {
    expect(sameCell(undefined, "")).toBe(true);
    expect(sameCell(46300.395833333336, 46300.39583333333)).toBe(true);
    expect(sameCell(5, "5")).toBe(true);
    expect(sameCell("", 0)).toBe(false);
    expect(sameCell("В работе", "В работе ")).toBe(false);
    expect(sameCell(12, 13)).toBe(false);
  });

  it("повторы после ошибок: 1, 2, 4 минуты, дальше раз в 5 минут", () => {
    expect([0, 1, 2, 3, 4, 9].map(nextDelay)).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
  });

  it("окно сверки начинается в 03:30 по Москве", () => {
    expect(reconcileWindowStart(new Date("2026-10-05T10:00:00Z")).toISOString()).toBe("2026-10-05T00:30:00.000Z");
    // 23:30 по Москве 05.10 = 20:30 UTC: окно того же московского дня
    expect(reconcileWindowStart(new Date("2026-10-05T20:30:00Z")).toISOString()).toBe("2026-10-05T00:30:00.000Z");
    // 01:00 по Москве 06.10 = 22:00 UTC 05.10: уже новый московский день
    expect(reconcileWindowStart(new Date("2026-10-05T22:00:00Z")).toISOString()).toBe("2026-10-06T00:30:00.000Z");
  });
});

describe("служебный аккаунт Google", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const account = { client_email: "weekly-sync@proj.iam.gserviceaccount.com", private_key: pem };

  it("ключ читается из JSON или base64, битый ключ не подключает таблицу", () => {
    const json = JSON.stringify(account);
    expect(serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: json })?.client_email).toBe(account.client_email);
    expect(serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(json).toString("base64") })?.client_email).toBe(account.client_email);
    expect(serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: "{не json" })).toBeNull();
    expect(serviceAccountFromEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "x" }) })).toBeNull();
    expect(serviceAccountFromEnv({})).toBeNull();
  });

  it("берёт токен подписанным JWT один раз, пишет значения как есть, читает без форматирования, ошибки доступа объясняет", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "tok-1", expires_in: 3600 });
      if (url.includes("/values/") && init.method === "GET") return Response.json({ values: [["a", 1]] });
      if (url.includes("forbidden")) return new Response("{}", { status: 403 });
      return Response.json({ sheets: [{ properties: { title: "Задачи", sheetId: 7 }, protectedRanges: [{ protectedRangeId: 3, description: "x" }], conditionalFormats: [{}] }] });
    }) as typeof fetch;

    const g = new GoogleSheets("copy-id", account, fetchMock);
    expect(await g.sheets()).toEqual([{ title: "Задачи", sheetId: 7, hidden: undefined, protectedRanges: [{ id: 3, description: "x" }], conditionalFormats: 1 }]);
    expect(await g.getValues("'Задачи'!U2:U")).toEqual([["a", 1]]);
    await g.setValues([{ range: "'Задачи'!A2:B2", values: [["=1+1", 2]] }]);
    await g.append("Задачи", [["x"]]);

    const tokenCalls = calls.filter((c) => c.url.startsWith("https://oauth2.googleapis.com/token"));
    expect(tokenCalls).toHaveLength(1);
    const assertion = new URLSearchParams(String(tokenCalls[0]!.init.body)).get("assertion")!;
    expect(decodeProtectedHeader(assertion).alg).toBe("RS256");
    expect(decodeJwt(assertion)).toMatchObject({ iss: account.client_email, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/spreadsheets" });

    const read = calls.find((c) => c.init.method === "GET" && c.url.includes("/values/"))!;
    expect(read.url).toContain("valueRenderOption=UNFORMATTED_VALUE");
    expect(read.url).toContain("dateTimeRenderOption=SERIAL_NUMBER");
    const write = calls.find((c) => c.url.endsWith("/values:batchUpdate"))!;
    expect(JSON.parse(String(write.init.body)).valueInputOption).toBe("RAW");
    const append = calls.find((c) => c.url.includes(":append"))!;
    expect(append.url).toContain("valueInputOption=RAW");
    expect(append.url).toContain("insertDataOption=OVERWRITE");
    expect((write.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");

    // В рабочую таблицу клиент не создаётся вовсе
    expect(() => new GoogleSheets(PROD_SHEET_ID, account, fetchMock)).toThrow(/этапе 7/);

    const denied = new GoogleSheets("forbidden", account, fetchMock);
    const error = await denied.sheets().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleSheetsError);
    expect((error as GoogleSheetsError).message).toMatch(/^Нет доступа к таблице: дайте служебному аккаунту права редактора/);
  });
});
