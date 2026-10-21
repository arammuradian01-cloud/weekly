"use client";

// Окно дашборда рынка КАСКО и ОСАГО (этап 62). Код дашборда из пакета живёт в изолированном iframe: sandbox только
// allow-scripts, без allow-same-origin, поэтому у окна непрозрачный источник и ему недоступны cookies и API
// приложения, а сеть закрыта политикой CSP внутри srcdoc. Данные страница берёт сама (/api/market/data с проверкой
// доступа) и передаёт окну сообщением. Сообщения от окна принимаются только от него и только по схеме: высота,
// вкладка и фильтры. Вкладка и фильтры пишутся в адрес страницы, чтобы ссылкой можно было поделиться.

import { useEffect, useRef, useState } from "react";
import { buildSrcdoc } from "@/lib/market/srcdoc";
import { readFrameMessage, searchFromState, type MarketState } from "@/lib/market/params";
import type { MarketTheme } from "@/lib/market/theme";
import { Skeleton } from "@/components/ui/primitives";

type Payload = { version: number; files: Record<string, string>; datasets: Record<string, unknown[]> };

const themeNow = (): MarketTheme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

async function loadPayload(): Promise<Payload> {
  let res: Response;
  try {
    res = await fetch("/api/market/data", { credentials: "same-origin" });
  } catch {
    throw new Error("Нет связи с сервером: данные рынка не загрузились");
  }
  // Вход закончился: сервер отправил на страницу входа, а не ответ
  if (res.redirected || !(res.headers.get("content-type") ?? "").includes("application/json")) throw new Error("Вход закончился: обновите страницу и войдите снова");
  const body = (await res.json().catch(() => null)) as ({ ok: true } & Payload) | { ok: false; error: string } | null;
  if (!body) throw new Error("Не получилось прочитать данные рынка. Обновите страницу");
  if (!body.ok) throw new Error(body.error);
  return { version: body.version, files: body.files, datasets: body.datasets };
}

export function MarketFrame({ etag, initial }: { etag: string; initial: MarketState }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const state = useRef<MarketState>(initial);
  const payload = useRef<Payload | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(640);

  // Код и данные пакета. Отпечаток пакета в адресе не нужен: браузер сам сверяет его с сервером (ETag)
  useEffect(() => {
    let alive = true;
    loadPayload()
      .then((p) => {
        if (!alive) return;
        payload.current = p;
        setDoc(buildSrcdoc(p.files, { link: state.current.link, params: state.current.params, theme: themeNow() }));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Не получилось загрузить данные рынка");
      });
    return () => {
      alive = false;
    };
  }, [etag]);

  useEffect(() => {
    const send = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, "*");
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      // Только своё окно: у изолированного окна источник «null»
      if (!win || event.source !== win || event.origin !== "null") return;
      const msg = readFrameMessage(event.data);
      if (!msg) return;
      if (msg.type === "ready") {
        const p = payload.current;
        if (p) send({ type: "init", version: p.version, datasets: p.datasets, params: state.current.params });
        return;
      }
      if (msg.type === "height") {
        setHeight(msg.height);
        return;
      }
      state.current = msg.type === "params" ? { ...state.current, params: msg.params } : { ...state.current, link: msg.link };
      window.history.replaceState(null, "", `${window.location.pathname}${searchFromState(state.current)}`);
    };
    window.addEventListener("message", onMessage);
    // Тема приложения сменилась: окно перекрашивается без перезагрузки
    const observer = new MutationObserver(() => send({ type: "theme", theme: themeNow() }));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, []);

  if (error) {
    return (
      <p role="alert" className="sv-alert sv-alert--danger" data-testid="market-error">
        {error}
      </p>
    );
  }
  if (!doc) {
    return (
      <div role="status" aria-label="Загружаем данные рынка" className="flex flex-col gap-3" data-testid="market-loading">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <iframe ref={frame} title="Рынок КАСКО и ОСАГО" sandbox="allow-scripts" srcDoc={doc} style={{ height }} className="block w-full border-0" data-testid="market-frame" />;
}
