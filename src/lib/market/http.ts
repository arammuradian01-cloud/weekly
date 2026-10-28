// Заголовки ответа с данными рынка (этап 82). Пакет вырос до полутора десятков мегабайт, поэтому ответ уходит
// сжатым. В браузере он не оседает: как и остальные ответы API, с no-store и без отпечатков. Иначе на общем
// устройстве (раздел открыт и по общему логину) цифры Сравни остались бы в дисковом кэше профиля после выхода,
// а это ровно то, чего мы избегаем в служебном обработчике public/sw.js.
// Чистая функция без базы и браузера: её проверяют тесты.

/** Ответ зависит от того, принимает ли браузер сжатие */
export const MARKET_VARY = "Accept-Encoding";

/** Принимает ли браузер gzip: ищем gzip в Accept-Encoding, не считая явного отказа q=0 */
export function acceptsGzip(header: string | null): boolean {
  if (!header) return false;
  for (const part of header.split(",")) {
    const [name, ...rest] = part.trim().split(";");
    if ((name ?? "").trim().toLowerCase() !== "gzip") continue;
    const q = rest.map((p) => p.trim().toLowerCase()).find((p) => p.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  }
  return false;
}
