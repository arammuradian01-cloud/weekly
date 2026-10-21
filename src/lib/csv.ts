// Выгрузка в CSV для Google Таблиц и Excel (этап 52).

/**
 * Ячейка CSV: в кавычках, а значение, которое таблица приняла бы за формулу (= + - @, табуляция, перевод строки),
 * начинается с апострофа. Иначе имя вида =IMPORTDATA(...) из Bord отправило бы соседнюю ссылку наружу при открытии
 */
export function csvCell(v: string | null | undefined): string {
  const raw = v ?? "";
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

