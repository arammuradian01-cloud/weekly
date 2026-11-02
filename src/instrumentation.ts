// Запуск сервера: фоновые циклы.
// - Выгрузка в Google-таблицу и забор из Bord (этапы 6 и 12). Выключается переменной SHEET_SYNC=off.
// - Письма: адресные события, напоминания о сдаче, дайджест (этап 20). Выключается переменной MAIL_LOOP=off.
// - Новости (этап 60): забор лент, уточнение, дайджесты новостей и очистка, свой цикл со своей арендой.
//   Шлёт письма, поэтому выключается той же переменной MAIL_LOOP=off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SHEET_SYNC !== "off") {
    const { startSheetLoop } = await import("./lib/sheet/runner");
    startSheetLoop();
  }
  if (process.env.MAIL_LOOP !== "off") {
    const { startMailLoop } = await import("./lib/letters/service");
    startMailLoop();
    const { startNewsLoop } = await import("./lib/news/loop");
    startNewsLoop();
  }
}

/** Что Next передаёт об упавшем запросе. Описано своими типами: лишних полей нам не нужно */
type ErrorRequest = { path?: string; method?: string };
type ErrorContext = { routePath?: string; routeType?: string };

/**
 * Сбои сервера в общий сбор (этап 86). Next вызывает это на каждую необработанную ошибку страницы, серверного
 * действия и обработчика API. Раньше такая ошибка оставалась в логах контейнера, и о ней никто не узнавал.
 * Сам сбор ошибок упасть не должен, поэтому всё внутри в try.
 */
export async function onRequestError(error: unknown, request: ErrorRequest, context: ErrorContext): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { pathOf, recordError, serverNoise } = await import("./lib/errors");
    const message = error instanceof Error ? error.message : String(error);
    // Оборванный поток ответа это не сбой: человек ушёл со страницы, и начатая загрузка соседней отменилась
    if (serverNoise(message)) return;
    const kind = context?.routeType ? ` (${context.routeType})` : "";
    await recordError({
      source: "SERVER",
      // Только путь, без параметров адреса: иначе у каждого запроса с ?_rsc=<случайное> был бы свой отпечаток
      // и одинаковые сбои не складывались бы в одну запись
      place: pathOf(request?.path) ?? context?.routePath ?? null,
      message: `${message}${kind}`,
      stack: error instanceof Error ? error.stack : null,
    });
  } catch (failure) {
    console.error("Сбой сервера не записан", failure);
  }
}
