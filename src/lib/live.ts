import "server-only";
// Живые обновления (этап 20): база сама сообщает об изменениях (триггеры миграции 20261011090000_discussions шлют
// pg_notify в канал weekly_live), процесс сервера слушает канал одним подключением и раздаёт сообщения открытым
// вкладкам через /api/events. В сообщении только вид изменения: экран берёт содержимое обычным запросом с проверкой прав.
// Подключение открывается при первой вкладке и закрывается через минуту после последней. Обрыв переподключается сам.

import { Client } from "pg";
import { databaseUrlFromEnv, pgConnectionConfig } from "./database-url";
import { parseLive, type LiveMessage } from "./live-message";

export type { LiveMessage };

type Listener = (message: LiveMessage) => void;

const CHANNEL = "weekly_live";
const IDLE_MS = 60_000;
const RETRY_MS = 5_000;

type Hub = {
  listeners: Set<Listener>;
  client: Client | null;
  connecting: Promise<void> | null;
  retry: ReturnType<typeof setTimeout> | null;
  idle: ReturnType<typeof setTimeout> | null;
};

const g = globalThis as unknown as { __live?: Hub };

function hub(): Hub {
  g.__live ??= { listeners: new Set(), client: null, connecting: null, retry: null, idle: null };
  return g.__live;
}

function drop(h: Hub, client: Client) {
  if (h.client !== client) return;
  h.client = null;
  client.end().catch(() => undefined);
  if (h.listeners.size) scheduleRetry(h);
}

function scheduleRetry(h: Hub) {
  if (h.retry) return;
  h.retry = setTimeout(() => {
    h.retry = null;
    if (h.listeners.size) void connect(h);
  }, RETRY_MS);
  h.retry.unref?.();
}

function connect(h: Hub): Promise<void> {
  if (h.client) return Promise.resolve();
  if (h.connecting) return h.connecting;
  const url = databaseUrlFromEnv();
  if (!url) return Promise.resolve();
  const client = new Client(pgConnectionConfig(url));
  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL) return;
    const m = parseLive(msg.payload);
    if (!m) return;
    for (const listener of h.listeners) {
      try {
        listener(m);
      } catch {
        // Закрытая вкладка: её снимет отписка
      }
    }
  });
  client.on("error", () => drop(h, client));
  client.on("end", () => drop(h, client));
  h.connecting = client
    .connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .then(() => {
      h.client = client;
    })
    .catch((error) => {
      console.error("Живые обновления: нет подключения к базе, повторим:", error instanceof Error ? error.message : error);
      client.end().catch(() => undefined);
      scheduleRetry(h);
    })
    .finally(() => {
      h.connecting = null;
    });
  return h.connecting;
}

/** Подписаться на изменения. Возвращает отписку */
export function subscribeLive(listener: Listener): () => void {
  const h = hub();
  h.listeners.add(listener);
  if (h.idle) {
    clearTimeout(h.idle);
    h.idle = null;
  }
  void connect(h);
  return () => {
    h.listeners.delete(listener);
    if (h.listeners.size || h.idle) return;
    h.idle = setTimeout(() => {
      h.idle = null;
      if (h.listeners.size || !h.client) return;
      const c = h.client;
      h.client = null;
      c.end().catch(() => undefined);
    }, IDLE_MS);
    h.idle.unref?.();
  };
}
