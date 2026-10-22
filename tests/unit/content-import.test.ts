import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_MAX_BYTES, PackageError, cleanText, parsePackage, recordHash } from "@/lib/content-import/package";

// Импорт наполнения (этап 67): разбор и проверка пакета без базы. Пакет синтетический: tests/fixtures/content-import

const FIXTURE = readFileSync("tests/fixtures/content-import/package.json", "utf8");
const fixture = () => JSON.parse(FIXTURE) as Record<string, unknown> & { tasks: Record<string, unknown>[]; goals: Record<string, unknown>[]; decisions: Record<string, unknown>[]; links: Record<string, unknown>[] };
const parse = (value: unknown) => parsePackage(JSON.stringify(value));

describe("разбор пакета", () => {
  it("синтетический пакет читается без ошибок, тексты приводятся к виду ресурса", () => {
    const { pkg, problems } = parsePackage(FIXTURE);
    expect(problems).toEqual([]);
    expect(pkg.title).toBe("Синтетический пакет для тестов");
    expect(pkg.goals.map((g) => g.key)).toEqual(["goal.test.dept-1", "goal.test.reva-1"]);
    expect(pkg.goals[1]!.parent).toEqual({ key: "goal.test.dept-1" });
    expect(pkg.tasks).toHaveLength(5);
    // Длинное тире заменено дефисом
    expect(pkg.tasks[0]!.outcome).toBe("Сводка в одном файле - с выводами");
    // Статус по умолчанию «В работе», источник по умолчанию «Другое»
    expect(pkg.tasks[3]).toMatchObject({ status: "in-progress", source: { kind: "other", note: null, date: null }, coExecutors: ["Сахибуллина Алсу", "Сидоров Никто"] });
    expect(pkg.decisions[1]).toMatchObject({ status: "cancelled", cancelReason: "Передумали на следующей тестовой встрече", team: null });
    expect(pkg.links[0]).toMatchObject({ task: { key: "task.test.open-1" }, goal: { key: "goal.test.dept-1" }, confidence: "высокая" });
  });

  it("не пакет наполнения: не JSON, другой формат, слишком большой файл", () => {
    expect(() => parsePackage("{ не json")).toThrow(PackageError);
    expect(() => parse({ format: "weekly-napolnenie/2", tasks: [] })).toThrow(/format/);
    expect(() => parse([])).toThrow(/нет полей пакета/);
    expect(() => parsePackage("{}", PACKAGE_MAX_BYTES + 1)).toThrow(/больше 2 МБ/);
  });

  it("ошибки собираются все сразу: ключи, обязательные поля, даты, статусы, итог закрытой задачи", () => {
    const p = fixture();
    p.tasks[0]!.key = "плохой ключ";
    p.tasks[1]!.key = "task.test.open-1";
    p.tasks[2]!.due = "2026-02-30";
    p.tasks[3]!.status = "proposed";
    delete p.tasks[1]!.resolution;
    p.tasks[4]!.title = "";
    p.goals[0]!.quarter = "4 квартал";
    p.goals[1]!.link = "ftp://example.com";
    const { problems } = parse(p);
    const text = problems.join("\n");
    expect(text).toMatch(/ключ «плохой ключ» пустой или с недопустимыми знаками/);
    expect(text).toMatch(/«Срок» не дата/);
    expect(text).toMatch(/«Статус»: «proposed» не из списка/);
    expect(text).toMatch(/для статуса «done» нужен итог/);
    expect(text).toMatch(/не заполнено «Задача»/);
    expect(text).toMatch(/квартал в виде 2026-Q4/);
    expect(text).toMatch(/ссылка должна начинаться с https/);
  });

  it("повтор ключа и ссылки на записи, которых нет в пакете", () => {
    const p = fixture();
    p.tasks[1]!.key = p.tasks[0]!.key;
    p.decisions[0]!.tasks = [{ key: "task.nope" }, { number: 12 }];
    p.links.push({ key: "link.test.3", task: { key: "task.test.open-1" }, goal: { code: "РТ-1" } });
    p.links.push({ key: "link.test.4", task: { number: 5 }, goal: { key: "goal.nope" } });
    p.goals[1]!.parent = { key: "goal.nope" };
    const { problems } = parse(p);
    const text = problems.join("\n");
    expect(text).toMatch(/ключ «task.test.open-1» повторяется/);
    expect(text).toMatch(/задачи с ключом «task.nope» в пакете нет/);
    expect(text).toMatch(/цели с ключом «goal.nope» в пакете нет/);
    expect(text).toMatch(/цели выше с ключом «goal.nope» в пакете нет/);
    // Одна задача к двум целям: противоречие в самом пакете
    expect(text).toMatch(/связи link.test.1 и link.test.3: одна задача привязана к двум целям/);
  });

  it("отменённое решение без причины и задача без ответственного", () => {
    const p = fixture();
    delete p.decisions[1]!.cancelReason;
    delete p.tasks[0]!.owner;
    const { problems } = parse(p);
    expect(problems.join("\n")).toMatch(/для отменённого решения нужна причина/);
    expect(problems.join("\n")).toMatch(/не заполнено «Ответственный»/);
  });
});

describe("отпечаток записи", () => {
  it("не зависит от порядка полей и меняется от содержания", () => {
    const a = { key: "x", title: "Задача", owner: "Рева Тарас", links: [{ url: "https://a", title: null }] };
    const b = { owner: "Рева Тарас", links: [{ title: null, url: "https://a" }], title: "Задача", key: "x" };
    expect(recordHash(a)).toBe(recordHash(b));
    expect(recordHash({ ...a, title: "Другая задача" })).not.toBe(recordHash(a));
    expect(recordHash(a)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("текст без длинного тире и стрелок, переносы строк только где нужны", () => {
    expect(cleanText("  Итог — готово → дальше  ")).toBe("Итог - готово - дальше");
    expect(cleanText("Строка 1\r\n\r\n\r\nСтрока 2", true)).toBe("Строка 1\n\nСтрока 2");
    expect(cleanText(null)).toBe("");
  });
});
