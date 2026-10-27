"use client";

// Окно дашборда рынка КАСКО и ОСАГО (этап 62). Код дашборда из пакета живёт в изолированном iframe: sandbox только
// allow-scripts, без allow-same-origin, поэтому у окна непрозрачный источник и ему недоступны cookies и API
// приложения, а сеть закрыта политикой CSP внутри srcdoc. Данные страница берёт сама (/api/market/data с проверкой
// доступа) и передаёт окну сообщением только в ответ на ready с одноразовой меткой этого окна (nonce в
// __MARKET_BOOT__), не чаще раза на цикл load и каждому документу окна один раз: событие load само данных не
// отправляет, иначе их получила бы страница, на которую окно ушло бы по ссылке. Вместе с данными уходят текущие
// вкладка, фильтры и тема: после перезагрузки документа окна вернутся они. Сообщения от окна принимаются только от
// него, только с меткой и только по схеме: высота, вкладка и фильтры. Вкладка и фильтры пишутся в адрес страницы
// через router.replace (этап 82), чтобы ссылкой можно было поделиться: нативный history.replaceState в Next 16.3
// перезагружал страницу целиком, и через несколько секунд после открытия дашборд собирался заново.

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { buildSrcdoc } from "@/lib/market/srcdoc";
import { createInitGate, marketNonce, readFrameMessage, searchFromState, type MarketState } from "@/lib/market/params";
import { readMarketAnswer } from "@/lib/market/answers";
import type { MarketTheme } from "@/lib/market/theme";
import { Skeleton } from "@/components/ui/primitives";

type Payload = { version: number; files: Record<string, string>; datasets: Record<string, unknown[]> };

const themeNow = (): MarketTheme => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

async function loadPayload(): Promise<Payload> {
  let res: Response;
  try {
    // no-cache, а не no-store: браузер спрашивает сервер и на неизменившийся пакет получает короткий ответ 304
    res = await fetch("/api/market/data", { credentials: "same-origin", cache: "no-cache" });
  } catch {
    throw new Error("Нет связи с сервером: данные рынка не загрузились");
  }
  // Статус разбирается: вход закончился, нет доступа (текст сервера) или общий сбой
  const answer = await readMarketAnswer<Payload>(res, "data");
  if (!answer.ok) throw new Error(answer.error);
  return { version: answer.value.version, files: answer.value.files, datasets: answer.value.datasets };
}

/** Данные окну: наборы, текущие вкладка, фильтры и тема. Код страницы окно уже получило в srcdoc */
function postInit(win: Window | null | undefined, p: Payload | null, state: MarketState) {
  if (win && p) win.postMessage({ type: "init", version: p.version, datasets: p.datasets, params: state.params, link: state.link, theme: themeNow() }, "*");
}

/** Окно пересоздаётся по отпечатку пакета (stamp): загрузили новый пакет, страница берёт свежие код и данные */
export function MarketFrame({ stamp, initial }: { stamp: string; initial: MarketState }) {
  const router = useRouter();
  const pathname = usePathname();
  const frame = useRef<HTMLIFrameElement>(null);
  const state = useRef<MarketState>(initial);
  // Что сейчас стоит в адресе: лишний router.replace страницу не трогает
  const search = useRef(searchFromState(initial));
  const payload = useRef<Payload | null>(null);
  // Одноразовая метка окна и учёт событий load: данные уходят только в ответ на ready с меткой, раз на цикл load
  const nonce = useRef("");
  const gate = useRef(createInitGate());
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(640);

  // Код и данные пакета. Браузер каждый раз спрашивает сервер: тот отдаёт 304, пока пакет тот же
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
        if (gate.current.ready(msg.doc)) postInit(win, payload.current, state.current);
        return;
      }
      if (msg.type === "height") {
        setHeight(msg.height);
        return;
      }
      state.current = msg.type === "params" ? { ...state.current, params: msg.params } : { ...state.current, link: msg.link };
      const next = searchFromState(state.current);
      if (next === search.current) return;
      search.current = next;
      router.replace(`${pathname}${next}`, { scroll: false });
    };
    window.addEventListener("message", onMessage);
    // Тема приложения сменилась: окно перекрашивается без перезагрузки
    const observer = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ type: "theme", theme: themeNow() }, "*"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [router, pathname]);

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
      // Новый цикл load: данные не отправляются, пока документ окна не пришлёт ready с меткой
      onLoad={() => gate.current.load()}
      style={{ height }}
      className="block w-full border-0"
      data-testid="market-frame"
    />
  );
}
