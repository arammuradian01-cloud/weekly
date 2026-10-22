"use client";

// «Сменить профиль» у владельца (этап 71): выбор человека с подтверждением, плашка «Вы в профиле <ФИО> как владелец
// <ФИО>» и возврат в свой профиль. Выбор открывается из меню профиля и из командной строки, список людей приходит с
// сервера при открытии. На телефоне выбор занимает весь экран, на ноутбуке окно по центру, как у «Смотреть как».

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { UserRoundCog, X } from "lucide-react";
import { ownerAsPeopleAction, returnToOwnProfileAction, startOwnerAsAction } from "@/app/actions/owner-as";
import type { ViewAsPerson } from "@/lib/view-as-service";
import { Button, buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { flushOfflineDrafts } from "@/lib/offline/outbox";
import { clearOfflineDraftsFor } from "@/lib/offline/drafts";
import { PeopleSearchField, PeopleSearchList, filterPeople, personMatches } from "./people-search";
import { STICKY, useReloadWhenDue, useStickyHeight } from "./view-as";

const OPEN_EVENT = "weekly:owner-as";

/** Открыть выбор человека: пункт «Сменить профиль» меню профиля и команда в командной строке */
export function openOwnerAs() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * Перейти на главную страницу полной перезагрузкой, а не переходом роутера: от прежней страницы не остаётся ни
 * отправки черновиков, ни метки вкладки, всё дальше идёт уже от имени нового профиля
 */
function reloadHome() {
  window.location.replace("/");
}

/**
 * Вернуться в свой профиль. Сначала черновики человека с этого устройства уходят на сервер (не дольше 5 секунд) от его
 * имени с пометкой владельца и стираются: после возврата они не уйдут ни от владельца, ни от самого человека. Нет сети
 * или сервер отказал из-за смены профиля в другой вкладке: черновики остаются до следующего входа в этот профиль.
 * Возвращает текст ошибки или null. Возврата нет (владельца выключили, сняли роль): сервер уводит на экран входа
 */
export async function returnToOwnProfile(targetSlug: string | null): Promise<string | null> {
  if (targetSlug) {
    const flushed = await Promise.race([flushOfflineDrafts(targetSlug).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
    // Всё ушло или отклонено правилом: стираем. Нет сети, не успели или отказ входа: черновики остаются до следующего
    // входа в этот профиль, написанное не пропадает
    if (flushed && !flushed.blocked && !flushed.offline) clearOfflineDraftsFor(targetSlug);
  }
  const r = await returnToOwnProfileAction();
  if (!r.ok) return r.error;
  reloadHome();
  return null;
}

/** Кнопка «Вернуться в свой профиль» для плашек: ошибка под кнопкой, переход сам */
function ReturnButton({ targetSlug, className }: { targetSlug: string | null; className?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex shrink-0 flex-col items-start gap-1">
      <button
        type="button"
        className={className}
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={() =>
          startTransition(async () => {
            try {
              setError(await returnToOwnProfile(targetSlug));
            } catch (e) {
              unstable_rethrow(e);
              setError("Нет связи с сервером. Попробуйте ещё раз");
            }
          })
        }
      >
        Вернуться в свой профиль
      </button>
      {error ? (
        <span role="alert" className="text-small">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Выбор человека: все включённые люди структуры, кроме самого владельца и других владельцев. Поиск по ФИО, должности
 * и подразделению, Enter выбирает первого из найденных. Выбор не входит сразу: сначала подтверждение с тем, что правки
 * будут от имени человека с пометкой в журнале
 */
export function OwnerAsDialog({ ownerName }: { ownerName: string }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<ViewAsPerson[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ViewAsPerson | null>(null);
  const [pending, startTransition] = useTransition();
  /** Список, который сейчас загружается: Enter, нажатый до его прихода, выбирает первого найденного, когда он придёт */
  const loading$ = useRef<Promise<ViewAsPerson[] | null> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const run = (async () => {
      try {
        const r = await ownerAsPeopleAction();
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
      setConfirm(null);
      void load();
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [load]);

  const { shown } = useMemo(() => filterPeople(people, query), [people, query]);

  const pick = (p: ViewAsPerson) => {
    if (pending) return;
    setError(null);
    setConfirm(p);
  };

  const enter = (p: ViewAsPerson) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await startOwnerAsAction(p.id);
        if (r.ok) reloadHome();
        else setError(r.error);
      } catch (e) {
        unstable_rethrow(e);
        setError("Нет связи с сервером. Попробуйте ещё раз");
      }
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        {confirm ? (
          <Dialog.Content
            data-testid="owner-as-confirm"
            className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] max-w-[480px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-panel bg-surface p-5 shadow-medium outline-none sm:px-6 sm:py-5"
          >
            <Dialog.Title className="sv-modal__title block break-words">Войти в профиль {confirm.fullName}?</Dialog.Title>
            <Dialog.Description className="mt-1 text-body text-text-secondary">
              Правки будут от его имени, в журнале с пометкой «вошёл владелец {ownerName}»
            </Dialog.Description>
            <p className="mt-2 text-small text-muted">Режим управления выключится. Вход длится до 12 часов, вернуться в свой профиль можно в любой момент кнопкой на плашке.</p>
            {error ? (
              <p role="alert" className="mt-3 rounded-control bg-danger-soft px-3 py-2 text-small text-danger-ink">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={pending} onClick={() => setConfirm(null)}>
                Отмена
              </Button>
              <Button variant="dark" loading={pending} disabled={pending} onClick={() => enter(confirm)} autoFocus>
                Войти
              </Button>
            </div>
          </Dialog.Content>
        ) : (
          <Dialog.Content
            // Фокус сразу в поиске: человека ищут, а не листают
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              document.getElementById("owner-as-search")?.focus();
            }}
            className="fixed inset-0 z-50 flex flex-col bg-surface outline-none sm:inset-auto sm:left-1/2 sm:top-[10vh] sm:max-h-[80vh] sm:w-[calc(100%-32px)] sm:max-w-[600px] sm:-translate-x-1/2 sm:rounded-panel sm:border sm:border-line sm:shadow-medium"
          >
            <div className="flex items-start gap-3 border-b border-line px-4 pb-3 pt-4 sm:px-5">
              <div className="min-w-0 flex-1">
                <Dialog.Title className="sv-modal__title block">Сменить профиль</Dialog.Title>
                <Dialog.Description className="mt-1 text-small text-text-secondary">
                  Вы войдёте в профиль выбранного человека: его неделя, задачи и права. Правки пойдут от его имени, в журнале с пометкой, что вошли вы. Владельцев в списке нет.
                </Dialog.Description>
              </div>
              <Dialog.Close className="sv-icon-btn sv-icon-btn--sm shrink-0" aria-label="Закрыть">
                <X className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
              </Dialog.Close>
            </div>
            <PeopleSearchField
              id="owner-as-search"
              className="border-b border-line px-4 py-3 sm:px-5"
              value={query}
              onChange={setQuery}
              onEnter={(typed) => {
                if (shown[0]) pick(shown[0]);
                else if (!people && loading$.current) {
                  // Список ещё не пришёл: подтверждение откроется, как только он загрузится, по тому, что уже набрано
                  void loading$.current.then((list) => {
                    const first = list?.find((p) => personMatches(p, typed));
                    if (first) pick(first);
                  });
                }
              }}
            />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-3">
              {error ? (
                <p role="alert" className="mx-2 my-2 rounded-control bg-danger-soft px-3 py-2 text-small text-danger-ink">
                  {error}
                </p>
              ) : null}
              {loading && !people ? <p className="px-3 py-4 text-small text-muted">Загружаем людей…</p> : null}
              {people ? <PeopleSearchList people={people} query={query} allText={(n) => `Можно войти: ${n}`} listLabel="Люди компании" onPick={pick} /> : null}
            </div>
          </Dialog.Content>
        )}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Плашка над всеми страницами, пока владелец в чужом профиле: в чьём профиле, кто вошёл, до какого времени и возврат.
 * Липкая под шапкой и на телефоне, и на ноутбуке, на телефоне кнопка уходит под текст. В срок вкладка перезагружается
 * сама: сервер покажет, что вход закончился
 */
export function OwnerAsBanner({ name, ownerName, until, remainingMs, targetSlug }: { name: string; ownerName: string; until: string; remainingMs: number; targetSlug: string }) {
  const ref = useStickyHeight();
  useReloadWhenDue(remainingMs);
  return (
    <div ref={ref} role="status" data-testid="owner-as-banner" className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-accent bg-navy px-4 py-3 text-white sm:px-6 lg:px-[var(--content-pad)]", STICKY)}>
      <div className="flex min-w-0 basis-full items-start gap-2.5 sm:basis-0 sm:flex-1 sm:items-center">
        <UserRoundCog className="mt-0.5 h-5 w-5 shrink-0 sm:mt-0" strokeWidth={1.75} aria-hidden="true" />
        <p className="m-0 min-w-0 break-words text-body">
          <strong className="font-semibold">
            Вы в профиле {name} как владелец {ownerName}.
          </strong>{" "}
          <span className="text-small text-white/75">Правки от имени {name}, вход до {until}</span>
        </p>
      </div>
      <ReturnButton targetSlug={targetSlug} className={buttonClass("secondary", "sm", "shrink-0 border-transparent bg-white text-navy hover:bg-white/90")} />
    </div>
  );
}

/**
 * Вход закончился сам (срок, человека выключили или сделали владельцем), а владелец ещё не вернулся: страница
 * показывает его самого, но изменения закрыты, пока он не нажмёт «Вернуться в свой профиль»
 */
export function OwnerAsEndedBanner({ name, reason }: { name: string | null; reason: string }) {
  const ref = useStickyHeight();
  return (
    <div ref={ref} role="status" data-testid="owner-as-ended" className={cn("sv-alert sv-alert--warning flex-wrap items-center rounded-none border-b border-warning-line px-4 sm:px-6 lg:px-[var(--content-pad)]", STICKY)}>
      <p className="m-0 min-w-0 basis-full break-words sm:basis-0 sm:flex-1">
        <strong className="font-semibold">
          Вход в профиль{name ? ` ${name}` : ""} закончился: {reason.toLowerCase()}.
        </strong>{" "}
        Изменения откроются, когда вы вернётесь в свой профиль.
      </p>
      <ReturnButton targetSlug={null} className={buttonClass("secondary", "sm", "shrink-0")} />
    </div>
  );
}
