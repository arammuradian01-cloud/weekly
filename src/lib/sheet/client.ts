// Доступ к Google-таблице. Интерфейс один, реализаций две: настоящая через Google Sheets API (служебный аккаунт)
// и имитация в памяти для тестов. Выгрузка и сверка работают только через этот интерфейс.

export type Cell = string | number;

/** Рабочая таблица Insurance&Invest Bord: к ней ресурс подключается только на этапе 7 и только с согласия владельца */
export const PROD_SHEET_ID = "1ASfJQp1_sjEEqQPt49y7uL4edxX0WHMagRRfXZb4_Hs";
export type Grid = Cell[][];

export type SheetInfo = {
  title: string;
  sheetId: number;
  hidden?: boolean;
  /** Размер сетки: писать за её пределы Google не даёт */
  rowCount?: number;
  columnCount?: number;
  /** Защищённые диапазоны вкладки: чтобы при переразметке не плодить дубли */
  protectedRanges?: { id: number; description?: string }[];
  /** Сколько правил условного форматирования на вкладке */
  conditionalFormats?: number;
};

export interface SheetsClient {
  /** Вкладки таблицы */
  sheets(): Promise<SheetInfo[]>;
  /** Структурные правки одним пакетом: новые вкладки, удаление строк, оформление, защита */
  batchUpdate(requests: Record<string, unknown>[]): Promise<void>;
  /** Значения как есть: числа числами, даты серийными числами, без форматирования */
  getValues(range: string): Promise<Grid>;
  /** Запись значений как есть (RAW): текст никогда не превращается в формулу */
  setValues(data: { range: string; values: Grid }[]): Promise<void>;
  /** Запись с разбором, как будто набрали руками: только для формул вкладки «Сводка» */
  setFormulas(range: string, values: Grid): Promise<void>;
  /** Дописать строки в конец вкладки */
  append(sheet: string, values: Grid): Promise<void>;
  /** Очистить диапазон */
  clear(range: string): Promise<void>;
}

/** Имя вкладки в диапазоне A1: в кавычках, кавычки внутри удваиваются */
export const q = (title: string) => `'${title.replace(/'/g, "''")}'`;

/** Буква колонки по номеру с единицы: 1 = A, 27 = AA */
export function colLetter(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
