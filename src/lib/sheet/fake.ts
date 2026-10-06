// Имитация Google-таблицы в памяти: для тестов выгрузки, сверки и недоступности Google.
// Ведёт себя как Sheets API в том, что важно ресурсу: диапазоны A1, пустые хвосты строк не возвращаются, строки удаляются со сдвигом,
// у вкладки есть размер сетки (по умолчанию 1000 строк и 26 колонок) и запись за её пределы падает, как в Google,
// дописывание пишет в пустые строки под таблицей и растит сетку только в конце, все строки под закреплённой шапкой удалить нельзя, имена вкладок не зависят от регистра.

import type { Cell, Grid, SheetInfo, SheetsClient } from "./client";

type Tab = {
  sheetId: number;
  title: string;
  grid: Cell[][];
  rows: number;
  cols: number;
  frozen: number;
  hidden?: boolean;
  protectedRanges: { id: number; description?: string }[];
  conditionalFormats: number;
};

function colNumber(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}

/** «'Задачи'!A2:U» в имя вкладки и границы: строки и колонки с нуля, конец не включительно. open: конец не задан */
export function parseRange(range: string): { title: string; r0: number; c0: number; r1: number; c1: number; openRows: boolean; openCols: boolean } {
  const m = /^'((?:[^']|'')+)'(?:!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?)?$/.exec(range);
  if (!m) throw new Error(`Непонятный диапазон ${range}`);
  const title = m[1]!.replace(/''/g, "'");
  const [startCol, startRow, endCol, endRow] = [m[2], m[3], m[4], m[5]];
  const c0 = startCol ? colNumber(startCol) - 1 : 0;
  const r0 = startRow ? Number(startRow) - 1 : 0;
  let c1 = Infinity;
  let r1 = Infinity;
  if (endCol !== undefined || endRow !== undefined) {
    if (endCol) c1 = colNumber(endCol);
    if (endRow) r1 = Number(endRow);
  } else {
    if (startCol) c1 = c0 + 1;
    if (startRow) r1 = r0 + 1;
  }
  return { title, r0, c0, r1, c1, openRows: r1 === Infinity, openCols: c1 === Infinity };
}

export class FakeSheets implements SheetsClient {
  tabs = new Map<string, Tab>();
  /** Структурные правки, которые имитация не исполняет (оформление): для проверок в тестах */
  requests: Record<string, unknown>[] = [];
  /** Все ячейки, записанные с разбором как формулы (USER_ENTERED) */
  formulaCells: Cell[] = [];
  /** Google недоступен: любой вызов падает */
  down = false;
  calls = 0;
  private nextId = 100;

  constructor(titles: string[] = []) {
    for (const t of titles) this.addTab(t);
  }

  private guard() {
    this.calls += 1;
    if (this.down) throw new Error("Google недоступен (имитация)");
  }

  private find(title: string): Tab | undefined {
    const key = title.toLowerCase();
    return [...this.tabs.values()].find((t) => t.title.toLowerCase() === key);
  }

  addTab(title: string, grid: Cell[][] = [], size: { rows?: number; cols?: number } = {}) {
    if (this.find(title)) throw new Error(`Вкладка ${title} уже есть`);
    const tab: Tab = {
      sheetId: this.nextId++,
      title,
      grid,
      rows: Math.max(size.rows ?? 1000, grid.length),
      cols: Math.max(size.cols ?? 26, ...grid.map((r) => r.length)),
      frozen: 0,
      protectedRanges: [],
      conditionalFormats: 0,
    };
    this.tabs.set(title, tab);
    return tab;
  }

  tab(title: string): Tab {
    const t = this.tabs.get(title);
    if (!t) throw new Error(`Нет вкладки ${title}`);
    return t;
  }

  private sheet(title: string): Tab {
    const t = this.tabs.get(title);
    if (!t) throw new Error(`Unable to parse range: ${title}`);
    return t;
  }

  /** Ручная правка ячейки, как человек в таблице: строки и колонки с нуля. Сетка растёт, как при вставке строк руками */
  edit(title: string, row: number, col: number, value: Cell) {
    const t = this.tab(title);
    t.rows = Math.max(t.rows, row + 1);
    t.cols = Math.max(t.cols, col + 1);
    this.put(t, row, col, value);
  }

  private put(t: Tab, row: number, col: number, value: Cell) {
    const g = t.grid;
    while (g.length <= row) g.push([]);
    while (g[row]!.length <= col) g[row]!.push("");
    g[row]![col] = value;
  }

  private bounds(t: Tab, range: string) {
    const r = parseRange(range);
    const r1 = r.openRows ? t.rows : r.r1;
    const c1 = r.openCols ? t.cols : r.c1;
    if (r.r0 >= t.rows || r1 > t.rows || r.c0 >= t.cols || c1 > t.cols) {
      throw new Error(`Range (${range}) exceeds grid limits. Max rows: ${t.rows}, max columns: ${t.cols}`);
    }
    return { ...r, r1, c1 };
  }

  async sheets(): Promise<SheetInfo[]> {
    this.guard();
    return [...this.tabs.values()].map((t) => ({
      title: t.title,
      sheetId: t.sheetId,
      hidden: t.hidden,
      rowCount: t.rows,
      columnCount: t.cols,
      protectedRanges: t.protectedRanges.map((p) => ({ ...p })),
      conditionalFormats: t.conditionalFormats,
    }));
  }

  private byId(sheetId: number): Tab | undefined {
    return [...this.tabs.values()].find((t) => t.sheetId === sheetId);
  }

  async batchUpdate(requests: Record<string, unknown>[]): Promise<void> {
    this.guard();
    for (const r of requests) {
      if (r.addSheet) {
        const p = (r.addSheet as { properties: { title: string } }).properties;
        this.addTab(p.title);
        continue;
      }
      if (r.updateSheetProperties) {
        const u = r.updateSheetProperties as { properties: { sheetId: number; title?: string; gridProperties?: { frozenRowCount?: number } }; fields: string };
        const tab = this.byId(u.properties.sheetId);
        if (!tab) throw new Error("Нет вкладки");
        if (u.fields.includes("title") && u.properties.title) {
          const other = this.find(u.properties.title);
          if (other && other !== tab) throw new Error(`Вкладка ${u.properties.title} уже есть`);
          this.tabs.delete(tab.title);
          tab.title = u.properties.title;
          this.tabs.set(tab.title, tab);
        }
        if (u.fields.includes("frozenRowCount")) tab.frozen = u.properties.gridProperties?.frozenRowCount ?? 0;
        this.requests.push(r);
        continue;
      }
      if (r.deleteDimension) {
        const d = (r.deleteDimension as { range: { sheetId: number; dimension: string; startIndex: number; endIndex: number } }).range;
        const tab = this.byId(d.sheetId);
        if (!tab) throw new Error("Нет вкладки");
        if (d.dimension === "ROWS") {
          const n = Math.min(d.endIndex, tab.rows) - d.startIndex;
          if (tab.rows - n <= tab.frozen) throw new Error("Sorry, it is not possible to delete all non-frozen rows.");
          tab.grid.splice(d.startIndex, d.endIndex - d.startIndex);
          tab.rows -= n;
        }
        this.requests.push(r);
        continue;
      }
      if (r.appendDimension) {
        const a = r.appendDimension as { sheetId: number; dimension: string; length: number };
        const tab = this.byId(a.sheetId);
        if (!tab) throw new Error("Нет вкладки");
        if (a.dimension === "ROWS") tab.rows += a.length;
        else tab.cols += a.length;
        this.requests.push(r);
        continue;
      }
      if (r.addProtectedRange) {
        const p = (r.addProtectedRange as { protectedRange: { range: { sheetId: number }; description?: string } }).protectedRange;
        this.byId(p.range.sheetId)?.protectedRanges.push({ id: this.nextId++, description: p.description });
      }
      if (r.deleteProtectedRange) {
        const id = (r.deleteProtectedRange as { protectedRangeId: number }).protectedRangeId;
        for (const t of this.tabs.values()) t.protectedRanges = t.protectedRanges.filter((p) => p.id !== id);
      }
      if (r.addConditionalFormatRule) {
        const range = (r.addConditionalFormatRule as { rule: { ranges: { sheetId: number }[] } }).rule.ranges[0]!;
        const tab = this.byId(range.sheetId);
        if (tab) tab.conditionalFormats += 1;
      }
      if (r.deleteConditionalFormatRule) {
        const d = r.deleteConditionalFormatRule as { sheetId: number; index: number };
        const tab = this.byId(d.sheetId);
        if (!tab || d.index >= tab.conditionalFormats) throw new Error("Нет такого правила условного форматирования");
        tab.conditionalFormats -= 1;
      }
      this.requests.push(r);
    }
  }

  async getValues(range: string): Promise<Grid> {
    this.guard();
    const t = this.sheet(parseRange(range).title);
    const { r0, c0, r1, c1 } = this.bounds(t, range);
    const g = t.grid;
    const rows = g.slice(r0, Math.min(r1, g.length)).map((row) => {
      const cut = row.slice(c0, Math.min(c1, row.length));
      while (cut.length && (cut[cut.length - 1] === "" || cut[cut.length - 1] === undefined)) cut.pop();
      return cut.map((v) => (v === undefined ? "" : v));
    });
    while (rows.length && rows[rows.length - 1]!.length === 0) rows.pop();
    return rows;
  }

  private write(range: string, values: Grid) {
    const t = this.sheet(parseRange(range).title);
    const { r0, c0, r1, c1 } = this.bounds(t, range);
    values.forEach((row, i) =>
      row.forEach((v, j) => {
        if (r0 + i >= r1 || c0 + j >= c1) throw new Error(`Requested writing within range [${range}], but tried writing outside it`);
        this.put(t, r0 + i, c0 + j, v);
      }),
    );
  }

  async setValues(data: { range: string; values: Grid }[]): Promise<void> {
    this.guard();
    for (const d of data) this.write(d.range, d.values);
  }

  async setFormulas(range: string, values: Grid): Promise<void> {
    this.guard();
    this.write(range, values);
    this.formulaCells.push(...values.flat());
  }

  async append(sheet: string, values: Grid): Promise<void> {
    this.guard();
    if (!values.length) return;
    const t = this.sheet(sheet);
    let last = t.grid.length;
    while (last > 0 && t.grid[last - 1]!.every((v) => v === "" || v === undefined)) last -= 1;
    // OVERWRITE: строки пишутся в пустые строки под таблицей, сетка растёт, только если строк не хватило
    t.rows = Math.max(t.rows, last + values.length);
    t.cols = Math.max(t.cols, ...values.map((r) => r.length));
    values.forEach((row, i) => row.forEach((v, j) => this.put(t, last + i, j, v)));
  }

  async clear(range: string): Promise<void> {
    this.guard();
    const t = this.sheet(parseRange(range).title);
    const { r0, c0, r1, c1 } = this.bounds(t, range);
    const g = t.grid;
    for (let r = r0; r < Math.min(r1, g.length); r++) for (let c = c0; c < Math.min(c1, g[r]!.length); c++) g[r]![c] = "";
  }
}
