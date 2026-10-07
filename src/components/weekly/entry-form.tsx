"use client";

import { useEffect, useRef, useState } from "react";
import { ListPlus } from "lucide-react";
import { dictOptions, type BlockCode, type DirectionCode, type EntryTypeCode } from "@/domain/dictionaries";
import type { WeeklyEntry } from "@/domain/types";
import { saveEntryAction, type Result } from "@/app/(app)/weekly/actions";
import { WEEKLY_LIMITS } from "@/lib/weekly/rules";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { openNewTask, TASK_FROM_ENTRY_EVENT } from "@/components/prototype/new-task";
import { MentionArea } from "@/components/discuss/mention-area";
import { usePrototype } from "@/domain/store";
import { AskColleagueButton } from "@/components/requests/request-dialog";

/** Запись ещё не на сервере: такой id выдаёт экран до первого сохранения */
export const isLocalId = (id: string) => id.startsWith("new-");

function toInput(e: WeeklyEntry, needHelp: boolean, link: string) {
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
    links: link.trim() ? [{ title: e.links[0]?.url === link.trim() ? e.links[0]!.title : "", url: link.trim() }] : [],
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
  const { notify } = usePrototype();
  const [e, setE] = useState<WeeklyEntry>(initial);
  const [needHelp, setNeedHelp] = useState(!!initial.help);
  const [link, setLink] = useState(initial.links[0]?.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoState, setAutoState] = useState<"idle" | "saving" | "saved">("idle");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  const latest = useRef({ e, needHelp, link });
  latest.current = { e, needHelp, link };

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

  const set = <K extends keyof WeeklyEntry>(key: K, value: WeeklyEntry[K]) => {
    dirty.current = true;
    setE((prev) => ({ ...prev, [key]: value }));
  };

  /** Сохранить на сервере, что есть сейчас. id новой записи запоминаем, чтобы следующее сохранение её правило */
  const persist = async (): Promise<Result<WeeklyEntry>> => {
    if (inFlight.current) await inFlight.current.catch(() => undefined);
    const { e: cur, needHelp: nh, link: ln } = latest.current;
    const call = saveEntryAction(toInput(cur, nh, ln));
    inFlight.current = call;
    const result = await call;
    inFlight.current = null;
    if (result.ok) {
      setE((prev) => ({ ...prev, id: result.value.id, taskNumber: result.value.taskNumber }));
      latest.current.e = { ...latest.current.e, id: result.value.id };
      // Упомянули того, кто запись не видит (этап 20): запись сохранилась, но упоминание до него не дошло
      const warning = (result.value as WeeklyEntry & { warning?: string }).warning;
      if (warning) notify(warning, "error");
    }
    return result;
  };

  // Автосохранение: через 2,5 секунды тишины после ввода, если «что произошло» уже написано
  useEffect(() => {
    if (!dirty.current) return;
    if (timer.current) clearTimeout(timer.current);
    const what = e.what.trim();
    if (!what || what.length > WEEKLY_LIMITS.what) return;
    timer.current = setTimeout(async () => {
      setAutoState("saving");
      const result = await persist();
      if (result.ok) {
        dirty.current = false;
        setAutoState("saved");
        onAutosaved?.(result.value);
      } else setAutoState("idle");
    }, 2500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e, needHelp, link]);

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
      if (!result.ok) return setError(result.error);
      dirty.current = false;
      onSaved(result.value);
    } catch {
      setError("Нет связи с сервером: запись не сохранилась");
    } finally {
      setBusy(false);
    }
  };

  const saved = !isLocalId(e.id);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-xl bg-surface p-4 sm:p-5">
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
      <TextInput
        label="Ссылка на артефакт"
        id={`${initial.id}-link`}
        type="url"
        value={link}
        onChange={(ev) => {
          dirty.current = true;
          setLink(ev.target.value);
        }}
        placeholder="https://"
      />
      {error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-small text-danger-ink">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        <span className="text-caption text-muted sm:mr-auto" aria-live="polite">
          {autoState === "saving" ? "Сохраняю черновик записи" : autoState === "saved" ? "Черновик записи сохранён" : ""}
        </span>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {saved ? "Закрыть" : "Отмена"}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить запись"}
        </Button>
      </div>
    </form>
  );
}
