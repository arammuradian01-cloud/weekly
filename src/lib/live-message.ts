// Сообщение живых обновлений из канала weekly_live (этап 20): вид изменения и, для «Мне», id адресата.

export type LiveMessage = { t: "inbox"; p: string } | { t: "tasks" } | { t: "weekly" };

/** Разобрать сообщение канала. Чужое или битое сообщение даёт null */
export function parseLive(payload: string | undefined): LiveMessage | null {
  if (!payload) return null;
  try {
    const m = JSON.parse(payload) as { t?: unknown; p?: unknown };
    if (m.t === "inbox" && typeof m.p === "string") return { t: "inbox", p: m.p };
    if (m.t === "tasks" || m.t === "weekly") return { t: m.t };
  } catch {
    // Не JSON: пропускаем
  }
  return null;
}
