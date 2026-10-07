import { requireContext } from "@/lib/auth";
import { subscribeLive } from "@/lib/live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;

/**
 * Поток событий для открытых вкладок (этап 20): «inbox», когда в «Мне» человека что-то изменилось, и «change», когда
 * изменились задачи или weekly. Только вид изменения, без содержимого. Раз в 25 секунд пустая строка держит соединение
 */
export async function GET(request: Request) {
  const ctx = await requireContext();
  const me = ctx.person.id;
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };
      // Сообщения одной транзакции приходят пачкой: склеиваем их в одно на полсекунды
      let pending: { inbox: boolean; change: boolean } = { inbox: false, change: false };
      let flush: ReturnType<typeof setTimeout> | null = null;
      const unsubscribe = subscribeLive((m) => {
        if (m.t === "inbox" && m.p !== me) return;
        if (m.t === "inbox") pending.inbox = true;
        else pending.change = true;
        flush ??= setTimeout(() => {
          flush = null;
          if (pending.inbox) send("event: inbox\ndata: 1\n\n");
          if (pending.change) send("event: change\ndata: 1\n\n");
          pending = { inbox: false, change: false };
        }, 500);
      });
      const heartbeat = setInterval(() => send(": ok\n\n"), HEARTBEAT_MS);
      stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        if (flush) clearTimeout(flush);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Уже закрыт
        }
      };
      request.signal.addEventListener("abort", () => stop());
      send("retry: 10000\n: ok\n\n");
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Прокси хостинга не должен копить поток
      "X-Accel-Buffering": "no",
    },
  });
}
