// Заголовки ответа с данными рынка (этап 82). Пакет вырос до полутора десятков мегабайт, поэтому ответ уходит
// сжатым и с отпечатком версии: браузер, который уже забрал этот пакет, получает короткий ответ 304 вместо
// мегабайтов. Отпечаток меняется с каждой загрузкой пакета, так что старые цифры не залежатся.
// Ответ помечен private: он только для того, кто вошёл, и в общих кэшах его хранить нельзя.
// Чистые функции без базы и браузера: их проверяют тесты.

/** Хранить можно, но каждый раз спрашивать сервер: тот ответит 304, если пакет не сменился */
export const MARKET_CACHE_CONTROL = "private, no-cache, max-age=0, must-revalidate";

/** Ответ зависит от того, кто вошёл, и от того, принимает ли браузер сжатие */
export const MARKET_VARY = "Accept-Encoding, Cookie";

/** Отпечаток пакета для заголовка ETag */
export function marketEtag(stamp: string): string {
  return `"m${stamp.replace(/[^A-Za-z0-9_.-]/g, "")}"`;
}

/** Совпадает ли отпечаток с тем, что прислал браузер в If-None-Match (список через запятую, допускается слабый W/) */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const want = etag.replace(/^W\//, "");
  for (const part of header.split(",")) {
    const one = part.trim().replace(/^W\//, "");
    if (one === "*" || one === want) return true;
  }
  return false;
}

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
