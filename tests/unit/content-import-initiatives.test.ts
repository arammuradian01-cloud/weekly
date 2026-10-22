// Этап 67г: разбор инициатив в пакете наполнения и департамент инициативы по структуре. Без базы
import { describe, expect, it } from "vitest";
import { parsePackage, personnelExclusions } from "@/lib/content-import/package";
import { departmentOf } from "@/lib/initiatives/rules";
import { IMPORTED_BASIS, withLiveBlocks, type ReportBlock } from "@/lib/weekly-blocks/types";

const parse = (initiatives: unknown, extra: Record<string, unknown> = {}) => parsePackage(JSON.stringify({ format: "weekly-napolnenie/1", initiatives, ...extra }));

describe("инициативы в пакете", () => {
  it("поля, деление по умолчанию «ищем», тире и пробелы чистятся как в ресурсе", () => {
    const { pkg, problems } = parse([{ key: "ini.a", title: "  Подписка — с другими страховыми ", owner: "Рева Тарас", direction: "osago" }]);
    expect(problems).toEqual([]);
    expect(pkg.initiatives).toEqual([
      { key: "ini.a", title: "Подписка - с другими страховыми", why: null, direction: "osago", owner: "Рева Тарас", team: null, goal: null, state: "searching", note: null, result: null },
    ]);
  });

  it("ошибки: нет названия и ответственного, чужое деление, закрытая без итога, цель не из пакета, ключ повторяется, длинное название", () => {
    const { problems } = parse([
      { key: "ini.a", title: "", owner: "" },
      { key: "ini.b", title: "Б", owner: "Рева Тарас", state: "ready" },
      { key: "ini.c", title: "В", owner: "Рева Тарас", state: "dropped" },
      { key: "ini.d", title: "Г", owner: "Рева Тарас", goal: { key: "goal.none" } },
      { key: "ini.d", title: "Д", owner: "Рева Тарас" },
      { key: "ini.e", title: "Е".repeat(121), owner: "Рева Тарас" },
    ]);
    const text = problems.join("\n");
    expect(text).toMatch(/инициатива 1 \(ini\.a\): не заполнено «Инициатива»/);
    expect(text).toMatch(/инициатива 1 \(ini\.a\): не заполнено «Ответственный»/);
    expect(text).toMatch(/«Деление шкалы»: «ready» не из списка/);
    expect(text).toMatch(/инициатива ini\.c: для закрытой инициативы нужен итог/);
    expect(text).toMatch(/инициатива ini\.d: цели с ключом «goal\.none» в пакете нет/);
    expect(text).toMatch(/ключ «ini\.d» повторяется/);
    expect(text).toMatch(/«Инициатива» длиннее 120 знаков/);
  });

  it("кадровые сведения в любом поле инициативы: запись не загрузится, текст не показывается", () => {
    const { pkg } = parse([
      { key: "ini.ok", title: "Рейтинг станций ремонта", owner: "Рева Тарас", note: "Считаем выплаты страховых" },
      { key: "ini.hr", title: "Структура продаж", owner: "Рева Тарас", why: "Сократить двух менеджеров" },
    ]);
    expect(personnelExclusions(pkg).map((e) => [e.kind, e.key, e.text])).toEqual([["initiative", "ini.hr", "кадровые сведения в поле «Зачем»: запись не загрузится, уберите их из пакета"]]);
  });

  it("пакет без инициатив разбирается как раньше", () => {
    const { pkg, problems } = parsePackage(JSON.stringify({ format: "weekly-napolnenie/1" }));
    expect(problems).toEqual([]);
    expect(pkg.initiatives).toEqual([]);
  });
});

describe("департамент инициативы", () => {
  const units = new Map(
    [
      { id: "c", name: "Компания", kind: "COMPANY", parentId: null },
      { id: "d", name: "Департамент страхования", kind: "DEPARTMENT", parentId: "c" },
      { id: "m", name: "Управление", kind: "MANAGEMENT", parentId: "d" },
      { id: "s", name: "Сектор", kind: "SECTOR", parentId: "m" },
      { id: "x", name: "Петля", kind: "SECTOR", parentId: "y" },
      { id: "y", name: "Петля 2", kind: "SECTOR", parentId: "x" },
    ].map((u) => [u.id, u]),
  );
  it("само подразделение или первое выше с видом «департамент»; выше департамента или без подразделения: нет", () => {
    expect(departmentOf("s", units)).toEqual({ id: "d", name: "Департамент страхования" });
    expect(departmentOf("d", units)).toEqual({ id: "d", name: "Департамент страхования" });
    expect(departmentOf("c", units)).toBeNull();
    expect(departmentOf(null, units)).toBeNull();
    expect(departmentOf("nope", units)).toBeNull();
    // Петля в структуре не вешает страницу
    expect(departmentOf("x", units)).toBeNull();
  });
});

describe("отчёт CEO из пакета наполнения", () => {
  it("живой блок из пакета не помечается устаревшим и не пересобирается; правленый руками помечается", () => {
    const fresh: ReportBlock[] = [{ key: "wow", title: "Неделя к неделе", hidden: false, note: null, lines: [{ product: "osago", text: "Свежие цифры", href: null, source: null }], basis: "abc" }];
    const imported: ReportBlock = { key: "wow", title: "Неделя к неделе", hidden: false, note: null, lines: [{ product: "osago", text: "Цифры той недели", href: null, source: null }], edited: true, basis: IMPORTED_BASIS };
    expect(withLiveBlocks([imported], fresh)[0]).toMatchObject({ stale: false, lines: [{ text: "Цифры той недели" }] });
    expect(withLiveBlocks([{ ...imported, basis: "old" }], fresh)[0]!.stale).toBe(true);
  });
});
