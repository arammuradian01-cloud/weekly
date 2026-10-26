"use client";

// «Смотреть как» (этап 63): выбор человека для владельца и плашка просмотра. Выбор открывается из меню профиля и из
// командной строки, список людей приходит с сервера при открытии: в каждой странице весь список компании не нужен.
// На телефоне выбор занимает весь экран, на ноутбуке окно по центру. Список прокручивается, поиск по ФИО, должности
// и подразделению, Enter в поле поиска выбирает первого из найденных.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, Search, X } from "lucide-react";
import { startViewAsAction, stopViewAsAction, viewAsPeopleAction } from "@/app/actions/view-as";
import type { ViewAsPerson } from "@/lib/view-as-service";
import { matchOption } from "@/components/ui/search-picker";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { plural } from "@/domain/dates";
import { labelRequest } from "@/lib/view-as-fetch";

const OPEN_EVENT = "weekly:view-as";
/** Сколько строк показывать сразу: остальных находит поиск */
const SHOWN = 100;

/** Открыть выбор человека: пункт меню профиля и команда в командной строке */
export function openViewAs() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const hintOf = (p: ViewAsPerson) => [p.position, p.unit].filter(Boolean).join(", ");

export function ViewAsDialog() {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<ViewAsPerson[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Список, который сейчас загружается: Enter, нажатый до его прихода, выбирает первого найденного, когда он придёт */
  const loading$ = useRef<Promise<ViewAsPerson[] | null> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const run = (async () => {
      try {
        const r = await viewAsPeopleAction();
        if (r.ok) {
          setPeople(r.value);
          return r.value;
        }
        setError(r.error);
      } catch {
        setError("Нет связи с сервером. Закройте окно и попробуйте ещё раз");
      } finally {
        setLoading(false);
      }
      return null;
    })();
    loading$.current = run;
    return run;
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setQuery("");
      setPicked(null);
      void load();
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [load]);

  const matched = useMemo(() => (people ?? []).filter((p) => matchOption({ value: p.id, label: p.fullName, hint: hintOf(p) }, query)), [people, query]);
  const shown = matched.slice(0, SHOWN);
  const more = matched.length - shown.length;

  const choose = (p: ViewAsPerson) => {
    if (pending) return;
    setPicked(p.id);
    setError(null);
    startTransition(async () => {
      try {
        const r = await startViewAsAction(p.id);
        // Удачное начало уводит на «Мою неделю» выбранного человека: ответа нет, есть переход
        if (r && !r.ok) {
          setError(r.error);
          setPicked(null);
        }
      } catch (e) {
        unstable_rethrow(e);
        setError("Нет связи с сервером. Попробуйте ещё раз");
        setPicked(null);
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content
          // Фокус сразу в поиске: человека ищут, а не листают
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            document.getElementById("view-as-search")?.focus();
          }}
          className="fixed inset-0 z-50 flex flex-col bg-surface outline-none sm:inset-auto sm:left-1/2 sm:top-[10vh] sm:max-h-[80vh] sm:w-[calc(100%-32px)] sm:max-w-[600px] sm:-translate-x-1/2 sm:rounded-panel sm:border sm:border-line sm:shadow-medium"
        >
          <div className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-4 sm:px-5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="sv-modal__title block">Смотреть как</Dialog.Title>
              <Dialog.Description className="mt-1 text-small text-text-secondary">
                Приложение покажет всё так, как видит выбранный человек: его неделю с блоком «Ждёт вас», задачи и доступ по его правам. Изменения в просмотре недоступны, просмотр длится 2 часа, но не дольше режима управления.
              </Dialog.Description>
            </div>
            <Dialog.Close className="sv-icon-btn sv-icon-btn--sm shrink-0" aria-label="Закрыть">
              <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="relative border-b border-line px-4 py-3 sm:px-5">
            <label htmlFor="view-as-search" className="sr-only">
              Поиск по ФИО, должности или подразделению
            </label>
            <Search className="pointer-events-none absolute left-7 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted sm:left-8" aria-hidden="true" />
            <input
              id="view-as-search"
              type="search"
              className="sv-control w-full pl-10"
              placeholder="ФИО, должность или подразделение"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (shown[0]) choose(shown[0]);
                else if (!people && loading$.current) {
                  // Список ещё не пришёл: выбор случится, как только он загрузится, по тому, что уже набрано
                  const typed = e.currentTarget.value;
                  void loading$.current.then((list) => {
                    const first = list?.find((p) => matchOption({ value: p.id, label: p.fullName, hint: hintOf(p) }, typed));
                    if (first) choose(first);
                  });
                }
              }}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-3">
            {error ? (
              <p role="alert" className="mx-2 my-2 rounded-control bg-danger-soft px-3 py-2 text-small text-danger-ink">
                {error}
              </p>
            ) : null}
            {loading && !people ? <p className="px-3 py-4 text-small text-muted">Загружаем людей…</p> : null}
            {people ? (
              <>
                <p className="sv-cmdk__group" aria-live="polite">
                  {query.trim() ? `Нашлось ${matched.length} ${plural(matched.length, "человек", "человека", "человек")}` : `Все люди компании: ${people.length}`}
                </p>
                {shown.length ? (
                  <ul aria-label="Люди компании" className="m-0 list-none p-0">
                    {shown.map((p) => {
                      const hint = hintOf(p);
                      const busy = pending && picked === p.id;
                      return (
                        <li key={p.id}>
                          <button type="button" className={cn("sv-cmdk__item !items-start", busy && "is-active")} disabled={pending} aria-busy={busy || undefined} onClick={() => choose(p)}>
                            <span className="min-w-0 flex-1">
                              <span className="block text-body font-medium text-ink">{p.fullName}</span>
                              {hint ? <span className="block text-small text-muted">{hint}</span> : null}
                            </span>
                            {busy ? <span className="shrink-0 text-caption text-muted">Открываем…</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-3 py-4 text-small text-muted">Никого не нашли: проверьте написание</p>
                )}
                {more > 0 ? <p className="px-3 py-2 text-caption text-muted">Ещё {more}: уточните поиск</p> : null}
              </>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Перезагрузить вкладку: новое состояние просмотра должна показать вся страница, а не её часть */
function reloadPage() {
  window.location.reload();
}

const RELOAD_KEY = "weekly-view-as-reload";
/** Сам просмотр перезагружает вкладку не чаще раза в 30 секунд: часы устройства и сервера могут расходиться */
const RELOAD_GAP_MS = 30_000;

function lastReload(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function reloadByTimer() {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Хранилище запрещено: перезагрузка всё равно нужна
  }
  reloadPage();
}

/**
 * Высота липкой плашки в переменной --view-as-h: липкие шапки страниц (столбцы Roadmap) встают под плашкой, а не
 * наезжают на неё
 */
function useStickyHeight() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty("--view-as-h", `${el.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--view-as-h");
    };
  }, []);
  return ref;
}

const STICKY = "sticky top-14 z-[15] lg:top-16";

/**
 * Плашка над всеми страницами, пока идёт просмотр: кого смотрим, до какого времени и выход к себе. Липкая под шапкой
 * и на телефоне, и на ноутбуке. На телефоне короткая строка, кнопка уходит вниз. В срок вкладка перезагружается сама
 * (и при возврате на вкладку, если срок вышел, пока она спала). Срок считается по остатку, который прислал сервер,
 * а не по часам устройства; если после перезагрузки просмотр всё ещё идёт, следующая попытка не раньше чем через 30 с
 */
export function ViewAsBanner({ name, shortName, until, remainingMs }: { name: string; shortName: string; until: string; remainingMs: number }) {
  const [pending, startTransition] = useTransition();
  const ref = useStickyHeight();
  useEffect(() => {
    const deadline = Date.now() + Math.max(0, remainingMs);
    const due = () => Math.max(deadline, lastReload() + RELOAD_GAP_MS);
    const check = () => {
      if (Date.now() >= due()) reloadByTimer();
    };
    const timer = window.setTimeout(reloadByTimer, due() - Date.now() + 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [remainingMs]);
  return (
    <div ref={ref} role="status" data-testid="view-as-banner" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-accent bg-navy px-4 py-3 text-white sm:px-6 lg:px-[var(--content-pad)]", STICKY)}>
      <div className="flex min-w-0 basis-full items-center gap-2.5 sm:basis-0 sm:flex-1">
        <Eye className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <p className="m-0 min-w-0 text-body">
          <strong className="hidden font-semibold sm:inline">Вы смотрите как {name}. Изменения недоступны</strong>
          <span className="hidden text-small text-white/75 sm:inline sm:pl-2">Просмотр до {until}</span>
          <strong className="font-semibold sm:hidden">
            Как {shortName}, до {until}. Только просмотр
          </strong>
        </p>
      </div>
      <button
        type="button"
        className={buttonClass("secondary", "sm", "shrink-0 border-transparent bg-white text-navy hover:bg-white/90")}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() => startTransition(() => stopViewAsAction())}
      >
        Выйти из просмотра
      </button>
    </div>
  );
}

/**
 * Просмотр закончился сам (срок, режим управления, роль, человека выключили), а владелец ещё не вернулся к себе:
 * страница показывает его самого, но изменения из неё закрыты, пока он не нажмёт «Вернуться к себе». Кнопка
 * возвращает на эту же страницу
 */
export function ViewAsEndedBanner({ name, reason }: { name: string | null; reason: string }) {
  const [pending, startTransition] = useTransition();
  const ref = useStickyHeight();
  return (
    <div ref={ref} role="status" data-testid="view-as-ended" className={cn("sv-alert sv-alert--warning flex-wrap items-center rounded-none border-b border-warning-line px-4 sm:px-6 lg:px-[var(--content-pad)]", STICKY)}>
      <p className="m-0 min-w-0 basis-full sm:basis-0 sm:flex-1">
        <strong className="font-semibold">Просмотр{name ? ` как ${name}` : ""} закончился: {reason.toLowerCase()}.</strong> Изменения откроются, когда вы вернётесь к себе.
      </p>
      <button
        type="button"
        className={buttonClass("secondary", "sm", "shrink-0")}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() => startTransition(() => stopViewAsAction(`${window.location.pathname}${window.location.search}`))}
      >
        Вернуться к себе
      </button>
    </div>
  );
}

const CHANNEL = "weekly-view-as";
const SIGNAL_KEY = "weekly-view-as-state";

/** Метка этой вкладки для запросов: в каком состоянии просмотра её показал сервер */
let tabState: string | null = null;
let fetchLabelled = false;

/** После снятия просмотра перед выходом из ресурса вкладка уже своя: черновики владельца сервер примет */
export function markTabSelf() {
  tabState = "self";
}

/**
 * Один раз на страницу: к серверным действиям (заголовок Next-Action) и к изменениям через /api добавляется
 * заголовок X-Weekly-View с меткой вкладки. Роутер Next отправляет действия через глобальный fetch, загрузки файлов
 * идут через него же. По метке сервер отказывает вкладке, оставшейся от просмотра, и не блокирует обычные вкладки
 */
function labelFetch() {
  if (fetchLabelled || typeof window === "undefined" || typeof window.fetch !== "function") return;
  fetchLabelled = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const labelled = labelRequest(input, init, tabState, window.location);
      if (labelled) return original(input, labelled);
    } catch {
      // Не разобрали запрос: уходит как есть, сервер применит правило без метки
    }
    return original(input, init);
  };
}

/**
 * Начало и конец просмотра для остальных вкладок этого браузера (BroadcastChannel, запасной путь событие storage).
 * Каждая вкладка при открытии и при возврате из кэша браузера (bfcache) объявляет, в каком состоянии её показал
 * сервер: view:<номер просмотра>, ended:<номер>, self. Вкладка просмотра или закончившегося просмотра с другим
 * состоянием перезагружается. Обычную вкладку владельца сами не перезагружаем: она закрывается плашкой «В другой
 * вкладке начат просмотр» с кнопкой «Обновить», чтобы не потерять набранный текст
 */
export function ViewAsSync({ state }: { state: string }) {
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => {
    tabState = state;
    labelFetch();
    const other = (value: unknown) => {
      if (typeof value !== "string" || value === state) return;
      if (state !== "self") reloadPage();
      // Обычная вкладка владельца: закрывается плашкой, только если в другой вкладке идёт просмотр
      else if (value.startsWith("view:")) setElsewhere(true);
    };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (e: MessageEvent<{ state?: unknown }>) => other(e.data?.state);
    } catch {
      channel = null;
    }
    const announce = () => {
      channel?.postMessage({ state });
      try {
        localStorage.setItem(SIGNAL_KEY, JSON.stringify({ state, at: Date.now() }));
      } catch {
        // Хранилище запрещено: остаётся BroadcastChannel
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SIGNAL_KEY || !e.newValue) return;
      try {
        other((JSON.parse(e.newValue) as { state?: unknown }).state);
      } catch {
        // Чужое значение в хранилище: не наше дело
      }
    };
    // Вкладка вернулась из кэша браузера: страница просмотра могла устареть, её проще показать заново
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (state === "self") announce();
      else reloadPage();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", onShow);
    announce();
    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onShow);
    };
  }, [state]);
  if (!elsewhere) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="view-as-elsewhere" data-testid="view-as-elsewhere" className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4">
      <div className="w-full max-w-[420px] rounded-panel bg-surface p-5 shadow-medium">
        <h2 id="view-as-elsewhere" className="sv-modal__title">
          В другой вкладке начат просмотр
        </h2>
        <p className="mt-2 text-body text-text-secondary">В этой вкладке страница показана до начала просмотра. Обновите её, чтобы увидеть то же, что в остальных вкладках.</p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={buttonClass("primary", "sm")} onClick={reloadPage} autoFocus>
            Обновить
          </button>
        </div>
      </div>
    </div>
  );
}
