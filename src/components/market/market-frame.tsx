"use client";

// Окно дашборда рынка КАСКО и ОСАГО (этап 62). Код дашборда из пакета живёт в изолированном iframe: sandbox только
// allow-scripts, без allow-same-origin, поэтому у окна непрозрачный источник и ему недоступны cookies и API
// приложения, а сеть закрыта политикой CSP внутри srcdoc. Данные страница берёт сама (/api/market/data с проверкой
// доступа) и передаёт окну сообщением: один раз на каждое событие load у iframe (повторные ready от окна данные не
// дублируют). Сообщения от окна принимаются только от него, только с одноразовой меткой этого окна (nonce в
// __MARKET_BOOT__) и только по схеме: высота, вкладка и фильтры. Вкладка и фильтры пишутся в адрес страницы, чтобы
// ссылкой можно было поделиться.

import { useEffect, useRef, useState } from "react";
import { buildSrcdoc } from "@/lib/market/srcdoc";
import { createInitGate, marketNonce, readFrameMessage, searchFromState, type MarketState } from "@/lib/market/params";
import type { MarketTheme } from "@/lib/market/theme";
import { Skeleton } from "@/components/ui/primitives";

type Payload = { version: number; files: Record<string, string>; datasets: Record<string, unknown[]> };

const themeNow = (): MarketTheme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

async function loadPayload(): Promise<Payload> {
  let res: Response;
  try {
    res = await fetch("/api/market/data", { credentials: "same-origin", cache: "no-store" });
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

/** Данные окну: наборы и фильтры из адреса. Код страницы окно уже получило в srcdoc */
function postInit(win: Window | null | undefined, p: Payload | null, state: MarketState) {
  if (win && p) win.postMessage({ type: "init", version: p.version, datasets: p.datasets, params: state.params }, "*");
}

/** Окно пересоздаётся по отпечатку пакета (stamp): загрузили новый пакет, страница берёт свежие код и данные */
export function MarketFrame({ stamp, initial }: { stamp: string; initial: MarketState }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const state = useRef<MarketState>(initial);
  const payload = useRef<Payload | null>(null);
  // Одноразовая метка текущего документа окна и учёт событий load: данные уходят один раз на каждый load
  const nonce = useRef("");
  const gate = useRef(createInitGate());
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(640);

  // Код и данные пакета. Ответ браузер не кэширует (no-store): данные всегда с сервера
  useEffect(() => {
    let alive = true;
    loadPayload()
      .then((p) => {
        if (!alive) return;
        payload.current = p;
        nonce.current = marketNonce();
        gate.current = createInitGate();
        setDoc(buildSrcdoc(p.files, { link: state.current.link, params: state.current.params, theme: themeNow(), nonce: nonce.current }));
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Не получилось загрузить данные рынка");
      });
    return () => {
      alive = false;
    };
  }, [stamp]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      // Только своё окно: у изолированного окна источник «null», и метка этого окна в сообщении
      if (!win || event.source !== win || event.origin !== "null") return;
      const msg = readFrameMessage(event.data, nonce.current);
      if (!msg) return;
      if (msg.type === "ready") {
        if (gate.current.ready()) postInit(win, payload.current, state.current);
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
    const observer = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ type: "theme", theme: themeNow() }, "*"));
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
  return (
    <iframe
      ref={frame}
      title="Рынок КАСКО и ОСАГО"
      sandbox="allow-scripts"
      srcDoc={doc}
      onLoad={() => {
        if (gate.current.load()) postInit(frame.current?.contentWindow, payload.current, state.current);
      }}
      style={{ height }}
      className="block w-full border-0"
      data-testid="market-frame"
    />
  );
}
