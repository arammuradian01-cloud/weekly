"use client";

// «Смотреть как» (этап 63): выбор человека для владельца и плашка просмотра. Выбор открывается из меню профиля и из
// командной строки, список людей приходит с сервера при открытии: в каждой странице весь список компании не нужен.
// На телефоне выбор занимает весь экран, на ноутбуке окно по центру. Список прокручивается, поиск по ФИО, должности
// и подразделению, Enter в поле поиска выбирает первого из найденных.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, Search, X } from "lucide-react";
import { startViewAsAction, stopViewAsAction, viewAsPeopleAction } from "@/app/actions/view-as";
import type { ViewAsPerson } from "@/lib/view-as-service";
import { matchOption } from "@/components/ui/search-picker";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { plural } from "@/domain/dates";

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await viewAsPeopleAction();
      if (r.ok) setPeople(r.value);
      else setError(r.error);
    } catch {
      setError("Нет связи с сервером. Закройте окно и попробуйте ещё раз");
    } finally {
      setLoading(false);
    }
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
                Приложение покажет всё так, как видит выбранный человек: его неделю, задачи, «Мне» и доступ по его правам. Изменения в просмотре недоступны, просмотр длится 2 часа, но не дольше режима управления.
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
                if (e.key === "Enter" && shown[0]) {
                  e.preventDefault();
                  choose(shown[0]);
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

/** Плашка над всеми страницами, пока идёт просмотр: кого смотрим, до какого времени и выход к себе */
export function ViewAsBanner({ name, until }: { name: string; until: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <div role="status" data-testid="view-as-banner" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-accent bg-navy px-4 py-3 text-white sm:px-6 lg:px-[var(--content-pad)]">
      <Eye className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-body">
        <strong className="font-semibold">Вы смотрите как {name}. Изменения недоступны</strong>
        <span className="block text-small text-white/75 sm:inline sm:pl-2">Просмотр до {until}</span>
      </p>
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
