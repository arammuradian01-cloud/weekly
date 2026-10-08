"use client";

// Телефон и уведомления в браузере (этап 26, модуль М11): установка на экран «Домой», включение уведомлений на этом
// устройстве, проверка, другие свои устройства и какие события присылать.

import { useEffect, useState } from "react";
import { BellOff, BellRing, Download, Smartphone } from "lucide-react";
import { removePushDeviceAction, removePushSubscriptionAction, savePushPrefsAction, savePushSubscriptionAction, testPushAction } from "@/app/(app)/profile/actions";
import { PUSH_LABELS, PUSH_PREF_ORDER, type PushPrefs } from "@/lib/push/rules";
import type { PushDevice } from "@/lib/push/service";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { usePrototype } from "@/domain/store";
import { PUSH_OWNER_KEY } from "@/components/pwa/device-sync";

type State = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on" | "dev";

/** Открытый ключ VAPID в виде, который ждёт pushManager.subscribe */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Подписка браузера сделана с этим открытым ключом. Ключи сменились: старую подписку надо снять и сделать новую */
function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const key = sub.options?.applicationServerKey;
  if (!key) return true;
  const bytes = new Uint8Array(key);
  const want = keyBytes(publicKey);
  return bytes.length === want.length && bytes.every((b, i) => b === want[i]);
}

function setOwner(slug: string | null) {
  try {
    if (slug) localStorage.setItem(PUSH_OWNER_KEY, slug);
    else localStorage.removeItem(PUSH_OWNER_KEY);
  } catch {
    // Хранилище запрещено: подписка просто не перейдёт к новому входу сама
  }
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Установка на экран «Домой»: на Android кнопкой браузера, на iPhone подсказкой, установленное просто отмечаем */
export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [mode, setMode] = useState<"checking" | "installed" | "ios" | "prompt" | "other">("checking");
  useEffect(() => {
    if (isStandalone()) return setMode("installed");
    setMode(isIos() ? "ios" : "other");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
      setMode("prompt");
    };
    const onInstalled = () => setMode("installed");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  if (mode === "checking") return null;
  return (
    <div className="mt-4 flex items-start gap-3" data-testid="install-app">
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
      <div className="min-w-0">
        {mode === "installed" ? (
          <p className="text-body text-ink">Ресурс открыт как приложение с экрана «Домой».</p>
        ) : mode === "ios" ? (
          <p className="text-body text-ink">
            На iPhone: откройте ресурс в Safari, нажмите «Поделиться», затем «На экран „Домой“». Так ресурс открывается как приложение, и на нём работают уведомления (iOS 16.4 и новее).
          </p>
        ) : mode === "prompt" ? (
          <>
            <p className="text-body text-ink">Ресурс можно поставить на экран «Домой» и открывать как приложение, без адресной строки.</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={async () => {
                if (!prompt) return;
                await prompt.prompt();
                const choice = await prompt.userChoice.catch(() => null);
                if (choice?.outcome === "accepted") setMode("installed");
                setPrompt(null);
              }}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Установить на экран «Домой»
            </Button>
          </>
        ) : (
          <p className="text-body text-ink">
            На телефоне откройте меню браузера и выберите «Добавить на главный экран» или «Установить приложение»: ресурс будет открываться как приложение.
          </p>
        )}
      </div>
    </div>
  );
}

/** Уведомления в браузере на этом устройстве и настройки. Только при личном входе */
export function PushSettings({ publicKey, locked, prefs: initialPrefs, devices }: { publicKey: string; locked: boolean; prefs: PushPrefs; devices: PushDevice[] }) {
  const run = useRunAction();
  const { me } = usePrototype();
  const [state, setState] = useState<State>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(initialPrefs);
  const known = devices.find((d) => d.current)?.endpoint ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setState(isIos() && !isStandalone() ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }
      const reg = await registration();
      if (!reg) {
        if (!cancelled) setState(process.env.NODE_ENV === "production" ? "unsupported" : "dev");
        return;
      }
      const sub = await reg.pushManager.getSubscription().catch(() => null);
      if (cancelled) return;
      setEndpoint(sub?.endpoint ?? null);
      setState(sub && sub.endpoint === known && sameKey(sub, publicKey) ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, [known, publicKey]);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      if (!reg) return setState("unsupported");
      let sub = await reg.pushManager.getSubscription();
      // Подписка с прежними ключами: служба отклонит каждое уведомление, поэтому делаем новую
      if (sub && !sameKey(sub, publicKey)) {
        await sub.unsubscribe().catch(() => undefined);
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const fresh = sub;
      const saved = await run(() => savePushSubscriptionAction(fresh.toJSON()), "Уведомления на этом устройстве включены");
      if (saved) {
        setOwner(me.slug);
        setEndpoint(fresh.endpoint);
        setState("on");
      }
    } catch {
      await run(async () => ({ ok: false as const, error: "Браузер не дал подписаться на уведомления. Обновите страницу и попробуйте ещё раз" }));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await registration();
      const sub = await reg?.pushManager.getSubscription();
      const ep = sub?.endpoint ?? endpoint;
      await sub?.unsubscribe().catch(() => undefined);
      if (ep) await run(() => removePushSubscriptionAction(ep), "Уведомления на этом устройстве выключены");
      setOwner(null);
      setEndpoint(null);
      setState("off");
    } finally {
      setBusy(false);
    }
  };

  const others = devices.filter((d) => !d.current);
  const changed = PUSH_PREF_ORDER.some((k) => prefs[k] !== initialPrefs[k]);

  if (locked) {
    return <p className="mt-2 text-small text-muted">Уведомления в браузере включаются при личном входе: по общему логину можно выбрать чужой профиль.</p>;
  }

  return (
    <div className="mt-4 flex flex-col gap-5" data-testid="push-settings">
      <div className="flex items-start gap-3">
        {state === "on" ? (
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-success-ink" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <BellOff className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
        )}
        <div className="min-w-0" aria-live="polite">
          <p className="text-body font-medium text-ink">
            {state === "checking"
              ? "Проверяю, что умеет этот браузер"
              : state === "on"
                ? "На этом устройстве уведомления включены"
                : state === "off"
                  ? "На этом устройстве уведомления выключены"
                  : state === "denied"
                    ? "Уведомления запрещены в настройках браузера"
                    : state === "ios-install"
                      ? "На iPhone уведомления работают после установки на экран «Домой»"
                      : state === "dev"
                        ? "Уведомления работают в рабочей версии ресурса"
                        : "Этот браузер не умеет уведомления от сайтов"}
          </p>
          <p className="mt-0.5 text-small text-muted">
            {state === "denied"
              ? "Разрешите уведомления для этого сайта в настройках браузера и обновите страницу."
              : state === "ios-install"
                ? "Поставьте ресурс на экран «Домой» (выше, как это сделать), откройте его оттуда и включите уведомления здесь."
                : "Приходят в рабочее время, с 9:00 до 20:00 по будням: кто и что, без подробностей. Нажатие открывает задачу, просьбу или запись."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {state === "off" ? (
              <Button size="sm" onClick={() => void enable()} disabled={busy} loading={busy}>
                <BellRing className="h-4 w-4" aria-hidden="true" />
                Включить на этом устройстве
              </Button>
            ) : null}
            {state === "on" ? (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => testPushAction(), "Проверка ушла: уведомление придёт через несколько секунд", { refresh: false })}>
                  Прислать проверку
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disable()}>
                  Выключить на этом устройстве
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {others.length ? (
        <div>
          <h3 className="text-body font-semibold text-ink">Другие устройства с уведомлениями</h3>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {others.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-body text-ink">{d.label}</span>
                <Button size="sm" variant="ghost" onClick={() => void run(() => removePushDeviceAction(d.id), "Уведомления на устройстве выключены")}>
                  Выключить
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form
        className="flex flex-col gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await run(() => savePushPrefsAction(prefs), "Настройки уведомлений сохранены");
          setBusy(false);
        }}
      >
        <fieldset disabled={busy} className="flex flex-col gap-3">
          <legend className="mb-1 text-body font-semibold text-ink">О чём присылать</legend>
          {PUSH_PREF_ORDER.map((key) => (
            <label key={key} className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={prefs[key]} onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-blue-700" />
              <span>
                <span className="block text-body font-medium text-ink">{PUSH_LABELS[key].title}</span>
                <span className="block text-small text-muted">{PUSH_LABELS[key].hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <Button size="sm" type="submit" variant="secondary" disabled={!changed || busy}>
            Сохранить
          </Button>
        </div>
      </form>
    </div>
  );
}
