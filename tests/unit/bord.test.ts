// Забор задач из рабочего Bord: разбор вкладки «Задачи», имена ответственных и доступ к Google только на чтение.
import { generateKeyPairSync } from "node:crypto";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { NameIndex, personNameFromBord, splitOwners } from "@/lib/bord/names";
import { BordFormatError, cellDate, isoFromSerial, parseBordGrid } from "@/lib/bord/parse";
import { pullErrorText } from "@/lib/bord/pull";
import { GoogleSheets, GoogleSheetsError } from "@/lib/sheet/google";
import { PROD_SHEET_ID, type Grid } from "@/lib/sheet/client";

const HEADER = ["№", "Встреча", "Ответственный", "Задача", "Что нужно сделать (коротко)", "Срок", "Статус", "Комментарий / следующий шаг", "Статус просроченности"];
// 29.09.2026 и 10.10.2026 серийными числами таблицы
const SEP29 = 46294;
const OCT10 = 46305;

describe("разбор вкладки «Задачи»", () => {
  it("даты бывают числами таблицы и текстом", () => {
    expect(isoFromSerial(SEP29)).toBe("2026-09-29");
    expect(isoFromSerial(OCT10 + 0.75)).toBe("2026-10-10");
    expect(cellDate("05.10.2026")).toBe("2026-10-05");
    expect(cellDate("2026-10-05")).toBe("2026-10-05");
    expect(cellDate("до конца года")).toBeNull();
    expect(cellDate("")).toBeNull();
    expect(cellDate(0)).toBeNull();
  });

  it("сводка над таблицей пропускается, строки читаются с шапки, лишние колонки справа не мешают", () => {
    const grid: Grid = [
      ["Insurance&Invest Bord - задачи топ-команды"],
      [],
      ["Сводка по лидерам"],
      ["Ответственный", "Всего"],
      ["Рева Тарас", 3],
      [],
      [...HEADER, "Notion"],
      [1, SEP29, "Рева Тарас", "Запустить пилот", "Пилот идёт", OCT10, "В работе", "05.10: созвон с партнёром", "В сроке", "id-1"],
      [2, "29.09.2026", "Все лидеры", "Собрать цели  ", "", "10.10.2026", "Выполнена", "", "Закрыта"],
    ];
    const { rows, problems } = parseBordGrid(grid);
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { number: 1, meeting: "2026-09-29", owner: "Рева Тарас", title: "Запустить пилот", outcome: "Пилот идёт", due: "2026-10-10", status: "В работе", comment: "05.10: созвон с партнёром", line: 8 },
      { number: 2, meeting: "2026-09-29", owner: "Все лидеры", title: "Собрать цели", outcome: "", due: "2026-10-10", status: "Выполнена", comment: "", line: 9 },
    ]);
  });

  it("строка без номера, повтор номера и пустые строки не останавливают разбор", () => {
    const grid: Grid = [
      HEADER,
      [1, SEP29, "Рева Тарас", "Первая", "a", OCT10, "В работе"],
      [],
      ["", SEP29, "Рева Тарас", "Без номера", "b", OCT10, "В работе"],
      ["Итого"],
      [1, SEP29, "Рева Тарас", "Повтор номера", "c", OCT10, "В работе"],
      [3, SEP29, "Рева Тарас", "Третья", "d", "скоро", "В работе"],
    ];
    const { rows, problems, skipped } = parseBordGrid(grid);
    // Номер 1 повторяется: неизвестно, какая строка настоящая, не берём ни одну
    expect(rows.map((r) => r.number)).toEqual([3]);
    expect(skipped).toEqual([1]);
    expect(rows[0]!.due).toBeNull();
    expect(problems.map((p) => p.text)).toEqual([
      "строка 4: нет номера задачи, задача «Без номера» не перенесена",
      "номер 1 повторяется в строках 2, 6: задача не изменена, оставьте номер у одной строки",
    ]);
  });

  it("поменявшийся формат вкладки останавливает забор целиком", () => {
    expect(() => parseBordGrid([["что-то другое"]])).toThrow(BordFormatError);
    const moved = [...HEADER];
    [moved[2], moved[3]] = [moved[3]!, moved[2]!];
    expect(() => parseBordGrid([moved])).toThrow(/Колонка 3 во вкладке «Задачи» называется «Задача», ожидалась «Ответственный»/);
    // Последнюю колонку Bord считает сам: её переименование не мешает
    expect(() => parseBordGrid([[...HEADER.slice(0, 8), "Просрочка"]])).not.toThrow();
  });
});

describe("имена ответственных", () => {
  const people = [
    { id: "1", fullName: "Рева Тарас", shortName: "Тарас" },
    { id: "2", fullName: "Фатьянов Евгений", shortName: "Евгений Ф." },
    { id: "3", fullName: "Чейченец Евгений", shortName: "Евгений Ч." },
    { id: "4", fullName: "Логинова Светлана", shortName: "Света" },
  ];
  const index = new NameIndex(people);

  it("находит человека по разным написаниям", () => {
    for (const name of ["Рева Тарас", "рева  тарас", "Тарас Рева", "Рева Т.", "Т. Рева", "Рева", "Тарас"]) expect(index.find(name).person?.id, name).toBe("1");
    expect(index.find("Логинова Светлана").person?.id).toBe("4");
    expect(index.find("Света").person?.id).toBe("4");
    expect(index.find("Чейченец Евгений").person?.id).toBe("3");
  });

  it("отчество и инициалы не мешают", () => {
    expect(index.find("Рева Тарас Олегович").person?.id).toBe("1");
    expect(index.find("Рева Т.О.").person?.id).toBe("1");
    expect(index.find("Логинова С. А.").person?.id).toBe("4");
  });

  it("неоднозначное имя и знакомая фамилия с чужим именем не становятся новым человеком, незнакомое становится", () => {
    expect(index.find("Евгений")).toEqual({ ambiguous: true });
    expect(index.find("Рева Тагир")).toEqual({ ambiguous: true });
    expect(index.find("Терехов Валерий")).toEqual({});
    expect(index.find("")).toEqual({});
  });

  it("двое в одной ячейке и аккуратное ФИО нового человека", () => {
    expect(splitOwners("Рева Тарас, Логинова Светлана")).toEqual(["Рева Тарас", "Логинова Светлана"]);
    expect(splitOwners("Рева Тарас и Логинова Светлана")).toEqual(["Рева Тарас", "Логинова Светлана"]);
    expect(splitOwners("Рева Тарас / Логинова Светлана;Фатьянов Евгений")).toEqual(["Рева Тарас", "Логинова Светлана", "Фатьянов Евгений"]);
    expect(splitOwners("Иванова Инна")).toEqual(["Иванова Инна"]);
    expect(splitOwners("Рева Тарас (продукт), Логинова Светлана")).toEqual(["Рева Тарас", "Логинова Светлана"]);
    expect(personNameFromBord("терехов  валерий")).toEqual({ fullName: "Терехов Валерий", shortName: "Валерий" });
    expect(personNameFromBord("ТОКОВ НИКИТА")).toEqual({ fullName: "Токов Никита", shortName: "Никита" });
  });
});

describe("Bord только на чтение", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = { client_email: "weekly-sync@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };

  it("рабочий Bord можно читать с токеном только на чтение, любая запись падает до обращения к Google", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchMock = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
      return Response.json({ values: [HEADER] });
    }) as typeof fetch;

    expect(() => new GoogleSheets(PROD_SHEET_ID, account, fetchMock)).toThrow(/не пишет/);
    const reader = new GoogleSheets(PROD_SHEET_ID, account, fetchMock, "read");
    expect(await reader.getValues("'Задачи'!A:I")).toEqual([HEADER]);
    const token = calls.find((c) => c.url.startsWith("https://oauth2.googleapis.com/token"))!;
    expect(decodeJwt(new URLSearchParams(String(token.init.body)).get("assertion")!)).toMatchObject({ scope: "https://www.googleapis.com/auth/spreadsheets.readonly" });

    const before = calls.length;
    await expect(reader.setValues([{ range: "'Задачи'!A1", values: [["x"]] }])).rejects.toThrow(/только на чтение/);
    await expect(reader.append("Задачи", [["x"]])).rejects.toThrow(/только на чтение/);
    await expect(reader.batchUpdate([{ addSheet: {} }])).rejects.toThrow(/только на чтение/);
    await expect(reader.clear("'Задачи'!A1")).rejects.toThrow(/только на чтение/);
    await expect(reader.setFormulas("'Задачи'!A1", [["=1"]])).rejects.toThrow(/только на чтение/);
    expect(calls.length).toBe(before);
  });

  it("ошибки доступа к Bord видны словами", async () => {
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("no-tab")) return new Response('{"error":{"message":"Unable to parse range: \'Задачи\'!A:I"}}', { status: 400 });
      return new Response('{"error":{"message":"The caller does not have permission"}}', { status: 403 });
    }) as typeof fetch;
    const denied = await new GoogleSheets("bord-denied-0123456789abcdef", account, fetchMock, "read").getValues("'Задачи'!A:I").catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(GoogleSheetsError);
    expect(pullErrorText(denied)).toBe("Нет доступа к Bord: дайте служебному аккаунту право «Читатель» на таблицу");
    const noTab = await new GoogleSheets("bord-no-tab-0123456789abcdef", account, fetchMock, "read").getValues("'Задачи'!A:I").catch((e: unknown) => e);
    expect(pullErrorText(noTab)).toBe("В Bord нет вкладки «Задачи»");
  });
});
