/**
 * Адрес клиента для блокировки подбора пароля.
 *
 * Без своего прокси (TRUST_PROXY не true) заголовкам не верим: иначе любой подставит чужой адрес
 * и обойдёт блокировку. За прокси берём адрес, который дописал последний доверенный узел:
 * TRUST_PROXY_HOPS считает узлы справа в X-Forwarded-For (по умолчанию 1).
 *
 * Важно про короткий список (замечание ревью этапа 86): когда узлов в списке меньше, чем TRUST_PROXY_HOPS,
 * берётся первый адрес списка, то есть тот, который прислал сам клиент и может подделать. Так бывает, если
 * TRUST_PROXY_HOPS больше, чем прокси на самом деле. Значение должно совпадать с числом доверенных узлов перед
 * приложением (за App Platform это 1). Поведение не меняем: от него зависят блокировки входа, которые работают.
 */
export function clientIp(
  headers: Headers,
  trustProxy = process.env.TRUST_PROXY === "true",
  hops = Number(process.env.TRUST_PROXY_HOPS ?? "1") || 1,
): string {
  if (!trustProxy) return "local";
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const ip = chain[Math.max(0, chain.length - hops)];
    if (ip) return ip;
  }
  const real = headers.get("x-real-ip");
  return real ? real.trim() : "unknown";
}
