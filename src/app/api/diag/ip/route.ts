import { headers } from "next/headers";
import { readSession } from "@/lib/auth";
import { getEpochs } from "@/lib/settings";
import { clientIp } from "@/lib/client-ip";

export const dynamic = "force-dynamic";

/** Внутренние и служебные диапазоны: такой адрес значит, что прокси посчитан неверно */
function isPrivate(ip: string): boolean {
  return /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i.test(ip);
}

/**
 * Временная проверка для настройки хостинга: какой адрес ресурс считает адресом клиента.
 * Только для вошедших. Показывает цепочку прокси самого запрашивающего, чужих данных нет.
 */
export async function GET() {
  const session = await readSession();
  const { epoch } = await getEpochs();
  if (!session || session.epoch !== epoch) return Response.json({ error: "Нужен вход" }, { status: 401 });

  const h = await headers();
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const derived = clientIp(h);
  // Сами адреса не отдаём: для проверки достаточно признаков
  return Response.json({
    derivedIsPrivate: isPrivate(derived),
    derivedIsFirstInChain: chain.length > 0 && derived === chain[0],
    hops: Number(process.env.TRUST_PROXY_HOPS ?? "1") || 1,
    chainLength: chain.length,
    chainPrivate: chain.map(isPrivate),
    realIpPresent: Boolean(h.get("x-real-ip")),
  });
}
