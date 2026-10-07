// Запуск сервера: фоновые циклы.
// - Выгрузка в Google-таблицу и забор из Bord (этапы 6 и 12). Выключается переменной SHEET_SYNC=off.
// - Письма: адресные события, напоминания о сдаче, дайджест (этап 20). Выключается переменной MAIL_LOOP=off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SHEET_SYNC !== "off") {
    const { startSheetLoop } = await import("./lib/sheet/runner");
    startSheetLoop();
  }
  if (process.env.MAIL_LOOP !== "off") {
    const { startMailLoop } = await import("./lib/letters/service");
    startMailLoop();
  }
}
