// Запуск сервера: фоновый цикл выгрузки в Google-таблицу (этап 6). Выключается переменной SHEET_SYNC=off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.SHEET_SYNC === "off") return;
  const { startSheetLoop } = await import("./lib/sheet/runner");
  startSheetLoop();
}
