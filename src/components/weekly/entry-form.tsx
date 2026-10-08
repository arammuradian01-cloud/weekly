"use client";

import { useEffect, useRef, useState } from "react";
import { ListPlus, Plus, X } from "lucide-react";
import { dictOptions, type BlockCode, type DirectionCode, type EntryTypeCode } from "@/domain/dictionaries";
import type { Link, WeeklyEntry } from "@/domain/types";
import { saveEntryAction, type Result } from "@/app/(app)/weekly/actions";
import { WEEKLY_LIMITS } from "@/lib/weekly/rules";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { openNewTask, TASK_FROM_ENTRY_EVENT } from "@/components/prototype/new-task";
import { MentionArea } from "@/components/discuss/mention-area";
import { usePrototype } from "@/domain/store";
import { AskColleagueButton } from "@/components/requests/request-dialog";
import { ACTIVE_DRAFTS, dropEntryDraft, isNetworkError, newDraftKey, putEntryDraft, settleEntryDraft, type DraftEntryInput } from "@/lib/offline/drafts";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/** Запись ещё не на сервере: такой id выдаёт экран до первого сохранения */
export const isLocalId = (id: string) => id.startsWith("new-");

const OFFLINE_TEXT = "Нет сети: запись сохранена на этом устройстве и уйдёт на сервер, когда появится связь";

/** Больше ссылок в записи не нужно: сервер оставит первые десять */
const LINKS_MAX = 10;

type LinkDraft = { title: string; url: string };

function toInput(e: WeeklyEntry, needHelp: boolean, links: LinkDraft[]) {
  return {
    id: isLocalId(e.id) ? undefined : e.id,
    week: e.week,
    direction: e.direction,
    block: e.block,
    type: e.type,
    what: e.what,
    details: e.details,
    impact: e.impact,
    fact: e.fact,
    next: e.next,
    help: needHelp ? e.help : undefined,
    // Пустые строки не отправляем. Без названия сервер подпишет ссылку адресом сайта
    links: links.filter((l) => l.url.trim()).map((l) => ({ title: l.title.trim(), url: l.url.trim() })) as Link[],
  };
}

/**
 * Форма записи weekly: поля из раздела 3 ТЗ. Обязательны только блок, тип и «что произошло».
 * Черновик записи сохраняется на сервере сам через пару секунд после ввода: текст не теряется при закрытии вкладки
 */
export function EntryForm({
  initial,
  onSaved,
  onCancel,
  onAutosaved,
}: {
  initial: WeeklyEntry;
  /** Запись сохранена кнопкой: форму можно закрывать */
  onSaved: (entry: WeeklyEntry) => void;
  onCancel: () => void;
  /** Автосохранение прошло: экран обновляет список, форма остаётся открытой */
  onAutosaved?: (entry: WeeklyEntry) => void;
}) {
  const { notify, me } = usePrototype();
  const [e, setE] = useState<WeeklyEntry>(initial);
  // Ключ черновика на устройстве (этап 26): у записи с сервера её id, у новой случайный. Он же ключ повтора для сервера
  const draftKey = useRef(isLocalId(initial.id) ? newDraftKey() : initial.id);
  // Версия записи на сервере, с которой начат черновик: фоновая отправка не пишет поверх более новой
  const baseUpdatedAt = useRef<string | null>(initial.updatedAt ?? null);
  const [offline, setOffline] = useState(false);
  const [needHelp, setNeedHelp] = useState(!!initial.help);
  // Название по умолчанию это адрес сайта: такое название в поле не показываем, чтобы не мешало
  const [links, setLinks] = useState<LinkDraft[]>(() =>
    initial.links.length ? initial.links.map((l) => ({ url: l.url, title: hostOf(l.url) === l.title ? "" : l.title })) : [{ title: "", url: "" }],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoState, setAutoState] = useState<"idle" | "saving" | "saved" | "offline">("idle");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const latest = useRef({ e, needHelp, links });
  latest.current = { e, needHelp, links };

  // Задачу по записи поставили в диалоге: номер появляется здесь же, без перехода в список задач
  useEffect(() => {
    const onTask = (ev: Event) => {
      const { entryId, number } = (ev as CustomEvent<{ entryId: string; number: number }>).detail;
      if (entryId !== latest.current.e.id) return;
      setE((prev) => ({ ...prev, taskNumber: number }));
      latest.current.e = { ...latest.current.e, taskNumber: number };
      onAutosaved?.({ ...latest.current.e, taskNumber: number });
    };
    window.addEventListener(TASK_FROM_ENTRY_EVENT, onTask);
    return () => window.removeEventListener(TASK_FROM_ENTRY_EVENT, onTask);
  }, [onAutosaved]);

  const setLink = (i: number, patch: Partial<LinkDraft>) => {
    dirty.current = true;
    setLinks((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };
  const removeLink = (i: number) => {
    dirty.current = true;
    setLinks((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : [{ title: "", url: "" }]));
  };

  const set = <K extends keyof WeeklyEntry>(key: K, value: WeeklyEntry[K]) => {
    dirty.current = true;
    setE((prev) => ({ ...prev, [key]: value }));
  };

  /** Сохранить на сервере, что есть сейчас. id новой записи запоминаем, чтобы следующее сохранение её правило.
   * Нет сети: черновик остаётся на устройстве, ответ { ok: false } с пометкой offline */
  const persist = async (): Promise<Result<WeeklyEntry> & { offline?: boolean }> => {
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    const { e: cur, needHelp: nh, links: ln } = latest.current;
    const sentAt = Date.now();
    const input = toInput(cur, nh, ln);
    const call = saveEntryAction({ ...input, clientKey: input.id ? undefined : draftKey.current });
    inFlight.current = call;
    let result: Result<WeeklyEntry>;
    try {
      result = await call;
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      setOffline(true);
      return { ok: false, error: OFFLINE_TEXT, offline: true };
    } finally {
      inFlight.current = null;
    }
    setOffline(false);
    if (result.ok) {
      baseUpdatedAt.current = result.value.updatedAt ?? baseUpdatedAt.current;
      settleEntryDraft(me.slug, draftKey.current, result.value.id, sentAt);
      setE((prev) => ({ ...prev, id: result.value.id, taskNumber: result.value.taskNumber }));
      latest.current.e = { ...latest.current.e, id: result.value.id };
      // Упомянули того, кто запись не видит (этап 20): запись сохранилась, но упоминание до него не дошло
      const warning = (result.value as WeeklyEntry & { warning?: string }).warning;
      if (warning) notify(warning, "error");
    }
    return result;
  };

  // Пока форма открыта, её черновик отправляет она сама, фоновая отправка страницы его не трогает
  useEffect(() => {
    const key = draftKey.current;
    ACTIVE_DRAFTS.add(key);
    return () => {
      ACTIVE_DRAFTS.delete(key);
    };
  }, []);

  // Каждая правка сначала ложится в черновик на устройстве (этап 26): пропала сеть или закрыли вкладку, текст цел
  useEffect(() => {
    if (!dirty.current || !e.what.trim()) return;
    const { e: cur, needHelp: nh, links: ln } = latest.current;
    const input = toInput(cur, nh, ln);
    const draft: DraftEntryInput = { ...input, week: String(input.week), links: input.links.map((l) => ({ title: l.title, url: l.url })) };
    putEntryDraft(me.slug, {
      key: draftKey.current,
      entryId: input.id ?? null,
      clientKey: input.id ? null : draftKey.current,
      baseUpdatedAt: input.id ? baseUpdatedAt.current : null,
      input: draft,
      savedAt: Date.now(),
    });
  }, [e, needHelp, links, me.slug]);

  const autosave = async () => {
    setAutoState("saving");
    const result = await persist();
    if (result.ok) {
      dirty.current = false;
      setAutoState("saved");
      onAutosaved?.(result.value);
    } else setAutoState(result.offline ? "offline" : "idle");
  };

  const autosaveRef = useRef(autosave);
  autosaveRef.current = autosave;

  // Связь вернулась: черновик уходит сам, без нажатий
  useEffect(() => {
    const back = () => {
      if (dirty.current && latest.current.e.what.trim()) void autosaveRef.current();
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  // Автосохранение: через 2,5 секунды тишины после ввода, если «что произошло» уже написано
  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    const what = e.what.trim();
    if (!what || what.length > WEEKLY_LIMITS.what) return;
    timer.current = setTimeout(() => void autosave(), 2500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, needHelp, links]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!e.what.trim()) return setError("Напишите одной фразой, что произошло");
    if (e.what.trim().length > WEEKLY_LIMITS.what) return setError(`«Что произошло» длиннее ${WEEKLY_LIMITS.what} знаков: сократите до одной фразы`);
    if ((e.details ?? "").length > WEEKLY_LIMITS.details) return setError(`«Подробнее» длиннее ${WEEKLY_LIMITS.details} знаков`);
    if (needHelp && !(e.help ?? "").trim()) return setError("Напишите, какая помощь нужна и от кого");
    if (timer.current) clearTimeout(timer.current);
    setBusy(true);
    setError(null);
    try {
      const result = await persist();
      if (!result.ok) {
        if (result.offline) setAutoState("offline");
        else setError(result.error);
        return;
      }
      dirty.current = false;
      onSaved(result.value);
    } catch {
      setError("Сервер не ответил: запись сохранена на этом устройстве, попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };

  const saved = !isLocalId(e.id);

  // «Отмена» у несохранённой записи выбрасывает и черновик на устройстве. «Закрыть» у сохранённой оставляет только то,
  // что ждёт сети: человек видел, что оно уйдёт само
  const cancel = () => {
    if (!saved || (autoState !== "offline" && !offline)) dropEntryDraft(me.slug, draftKey.current);
    onCancel();
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 sv-card sv-card--soft p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Направление" id={`${initial.id}-dir`} value={e.direction} onChange={(ev) => set("direction", ev.target.value as DirectionCode)} options={dictOptions("DIRECTION", e.direction)} />
        <SelectField label="Блок" id={`${initial.id}-block`} value={e.block} onChange={(ev) => set("block", ev.target.value as BlockCode)} options={dictOptions("WEEKLY_BLOCK", e.block)} />
        <SelectField label="Тип" id={`${initial.id}-type`} value={e.type} onChange={(ev) => set("type", ev.target.value as EntryTypeCode)} options={dictOptions("ENTRY_TYPE", e.type)} />
      </div>
      <TextArea label="Что произошло" id={`${initial.id}-what`} value={e.what} onChange={(ev) => set("what", ev.target.value)} rows={2} counter={{ value: e.what.length, max: WEEKLY_LIMITS.what }} autoFocus />
      <MentionArea
        label="Подробнее"
        id={`${initial.id}-details`}
        value={e.details ?? ""}
        onChange={(v) => set("details", v)}
        rows={3}
        counter={{ value: (e.details ?? "").length, max: WEEKLY_LIMITS.details }}
        hint="Чтобы позвать коллегу, наберите @ и начало имени: он увидит запись в «Мне»"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextArea label="Влияние на бизнес" id={`${initial.id}-impact`} value={e.impact ?? ""} onChange={(ev) => set("impact", ev.target.value)} rows={2} hint="Словами: что это меняет для выручки, маржи или клиентов" />
        <TextArea label="Цифра или факт" id={`${initial.id}-fact`} value={e.fact ?? ""} onChange={(ev) => set("fact", ev.target.value)} rows={2} hint="Одна цифра или факт, на который опирается запись" />
      </div>
      <div className="flex flex-col gap-2">
        <TextArea label="Что делаем дальше" id={`${initial.id}-next`} value={e.next ?? ""} onChange={(ev) => set("next", ev.target.value)} rows={2} />
        <div className="flex flex-wrap items-center gap-3">
          {e.taskNumber ? (
            <span className="text-small text-muted">По записи уже есть задача {e.taskNumber}</span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!(e.next ?? "").trim() || !saved}
              onClick={() => openNewTask({ title: (e.next ?? "").slice(0, 120), outcome: e.what, source: "weekly", sourceNote: "Запись weekly", weeklyEntryId: e.id })}
            >
              <ListPlus className="h-4 w-4" aria-hidden="true" />
              Сделать задачей
            </Button>
          )}
          {!saved && (e.next ?? "").trim() ? <span className="text-caption text-muted">Сначала сохраните запись</span> : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={needHelp}
            onChange={(ev) => {
              dirty.current = true;
              setNeedHelp(ev.target.checked);
            }}
            className="h-4 w-4 accent-blue-700"
          />
          Нужна помощь
        </label>
        {needHelp ? (
          <MentionArea
            label="Какая помощь и от кого"
            id={`${initial.id}-help`}
            value={e.help ?? ""}
            onChange={(v) => set("help", v)}
            rows={2}
            hint="Упомяните, от кого ждёте помощи: @ и начало имени. Чтобы у помощи были срок и ответ, оформите её просьбой"
          />
        ) : null}
        {needHelp && !isLocalId(e.id) ? (
          <div>
            <AskColleagueButton size="sm" label="Оформить просьбой" prefill={{ entry: { id: e.id, what: e.what }, text: (e.help ?? "").trim() }} />
          </div>
        ) : null}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1.5 text-sm font-medium text-ink">Ссылки на артефакты</legend>
        {links.map((l, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-end">
            <TextInput
              label={i === 0 ? "Ссылка на артефакт" : `Ссылка ${i + 1}`}
              id={`${initial.id}-link${i ? `-${i}` : ""}`}
              type="url"
              value={l.url}
              onChange={(ev) => setLink(i, { url: ev.target.value })}
              placeholder="https://"
            />
            <TextInput label="Название, если нужно" id={`${initial.id}-link-title-${i}`} value={l.title} onChange={(ev) => setLink(i, { title: ev.target.value })} maxLength={WEEKLY_LIMITS.linkTitle} />
            {links.length > 1 || l.url ? (
              <Button type="button" variant="ghost" size="sm" className="h-11 self-end justify-self-end" onClick={() => removeLink(i)} aria-label={`Убрать ссылку ${i + 1}`}>
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        ))}
        {links.length < LINKS_MAX ? (
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                dirty.current = true;
                setLinks((prev) => [...prev, { title: "", url: "" }]);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Ещё ссылка
            </Button>
          </div>
        ) : null}
      </fieldset>
      {error ? (
        <p role="alert" className="sv-alert sv-alert--danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <span className={autoState === "offline" || offline ? "text-caption font-semibold text-warning-ink sm:mr-auto" : "text-caption text-muted sm:mr-auto"} aria-live="polite">
          {autoState === "offline" || offline ? OFFLINE_TEXT : autoState === "saving" ? "Сохраняю черновик записи" : autoState === "saved" ? "Черновик записи сохранён" : ""}
        </span>
        <Button type="button" variant="ghost" onClick={cancel}>
          {saved ? "Закрыть" : "Отмена"}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить запись"}
        </Button>
      </div>
    </form>
  );
}
