// Вкладка «Задачи» рабочего Bord из Google Sheets API в строки задач.
// Значения приходят как есть: номера числами, даты серийными числами или текстом «ДД.ММ.ГГГГ», если ячейку набрали текстом.
// Одна битая строка забор не останавливает: она попадает в список проблем, остальные строки переносятся.
// Останавливает только поменявшийся формат вкладки: тогда непонятно, где какие данные.

import type { Cell, Grid } from "@/lib/sheet/client";
import { isIsoDate, isoFromRuDate } from "@/lib/tasks/dates";
import { TABLE_HEADER, normalizeCell } from "@/lib/tasks/bord-import";
import type { IsoDate } from "@/domain/dates";

export const BORD_TAB = "Задачи";
/** Колонки A:I: номер, встреча, ответственный, задача, что сделать, срок, статус, комментарий, просроченность */
export const BORD_RANGE = `'${BORD_TAB}'!A:I`;

export type BordRow = {
  number: number;
  /** null: даты встречи нет или это не дата */
  meeting: IsoDate | null;
  owner: string;
  title: string;
  outcome: string;
  /** null: срока нет или это не дата */
  due: IsoDate | null;
  status: string;
  comment: string;
  /** Номер строки на листе, с единицы: для понятных сообщений */
  line: number;
};

export type BordProblem = { line: number | null; number: number | null; text: string };

/** Формат вкладки поменялся: забор останавливается, в ресурсе ничего не меняется */
export class BordFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BordFormatError";
  }
}

const DAY_MS = 86_400_000;

/** Серийное число даты таблицы (дни с 30.12.1899, дробь это время) в ГГГГ-ММ-ДД */
export function isoFromSerial(serial: number): IsoDate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  return new Date((Math.floor(serial) - 25569) * DAY_MS).toISOString().slice(0, 10);
}

/** Текст ячейки так, как его хранит ресурс */
export function cellText(cell: Cell | boolean | null | undefined): string {
  if (cell === undefined || cell === null) return "";
  if (typeof cell === "number") return Number.isInteger(cell) ? String(cell) : String(Number(cell.toFixed(6)));
  return normalizeCell(String(cell));
}

/** Дата из ячейки: серийное число, «ДД.ММ.ГГГГ» или «ГГГГ-ММ-ДД». null, если это не дата */
export function cellDate(cell: Cell | boolean | null | undefined): IsoDate | null {
  if (typeof cell === "number") return isoFromSerial(cell);
  const t = cellText(cell);
  if (!t) return null;
  return isoFromRuDate(t) ?? (isIsoDate(t) ? t : null);
}

/**
 * Строки задач и проблемы отдельных строк. Бросает BordFormatError, если не нашлась шапка или колонки переставили.
 * skipped: номера, которые во вкладке есть, но не перенесены (номер повторяется): такую задачу ресурс не трогает
 */
export function parseBordGrid(grid: Grid): { rows: BordRow[]; problems: BordProblem[]; skipped: number[] } {
  const headerAt = grid.findIndex((r) => cellText(r[0]) === "№" && cellText(r[1]) === "Встреча");
  if (headerAt < 0) throw new BordFormatError(`Во вкладке «${BORD_TAB}» нет строки заголовков «№, Встреча, Ответственный…». Забор остановлен, в ресурсе ничего не изменено`);
  const header = grid[headerAt]!.map((c) => cellText(c));
  // Колонку «Статус просроченности» Bord считает сам, ресурсу она не нужна: её переименование забор не ломает
  TABLE_HEADER.slice(0, 8).forEach((name, i) => {
    if (header[i] !== name) {
      throw new BordFormatError(`Колонка ${i + 1} во вкладке «${BORD_TAB}» называется «${header[i] ?? ""}», ожидалась «${name}». Формат Bord поменялся: забор остановлен, в ресурсе ничего не изменено`);
    }
  });

  const rows: BordRow[] = [];
  const problems: BordProblem[] = [];
  const lines = new Map<number, number[]>();
  grid.slice(headerAt + 1).forEach((r, i) => {
    const line = headerAt + i + 2;
    const num = cellText(r[0]);
    const title = cellText(r[3]);
    if (r.every((c) => !cellText(c))) return;
    if (!/^\d+$/.test(num) || Number(num) <= 0) {
      // Строка без номера, но с задачей: в ресурс её не перенести, номер ставят в Bord
      if (title) problems.push({ line, number: null, text: `строка ${line}: нет номера задачи, задача «${title.slice(0, 60)}» не перенесена` });
      return;
    }
    const number = Number(num);
    lines.set(number, [...(lines.get(number) ?? []), line]);
    rows.push({
      number,
      meeting: cellDate(r[1]),
      owner: cellText(r[2]),
      title,
      outcome: cellText(r[4]),
      due: cellDate(r[5]),
      status: cellText(r[6]),
      comment: cellText(r[7]),
      line,
    });
  });
  // Номер повторяется (строку скопировали, таблицу отсортировали): неизвестно, какая строка настоящая, поэтому не берём ни одну
  const skipped = [...lines].filter(([, at]) => at.length > 1).map(([n]) => n);
  for (const n of skipped) problems.push({ line: lines.get(n)![0]!, number: n, text: `номер ${n} повторяется в строках ${lines.get(n)!.join(", ")}: задача не изменена, оставьте номер у одной строки` });
  return { rows: rows.filter((r) => !skipped.includes(r.number)), problems, skipped };
}
