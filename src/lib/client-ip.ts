/**
 * Адрес клиента. Заголовкам X-Forwarded-For верим только за своим прокси (TRUST_PROXY=true),
 * иначе любой подставил бы чужой адрес и обошёл блокировку подбора.
 */
export function clientIp(headers: Headers, trustProxy = process.env.TRUST_PROXY === "true"): string {
  if (trustProxy) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]!.trim();
    const real = headers.get("x-real-ip");
    if (real) return real.trim();
  }
  return "local";
}
