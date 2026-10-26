"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Cloud, CloudOff, Lock, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { BLOCKS, entryTypeLabel, ENTRY_TYPES } from "@/domain/dictionaries";
import { formatShort } from "@/domain/dates";
import { isDueNextWeek, isDueThisWeek, isMine, isOverdue, isStale, overdueDays } from "@/lib/tasks/rules";
import type { PersonWeekly, Task, WeekInfo, WeeklyEntry } from "@/domain/types";
import { deleteEntryAction, reopenWeeklyAction, restoreEntryAction, saveHeadlineAction, submitWeeklyAction } from "@/app/(app)/weekly/actions";
import { ACTIVE_DRAFTS, DRAFTS_CHANGED, dropDraftsForEntry, dropHeadlineDraft, entryDrafts, headlineDraft, isNetworkError, putHeadlineDraft, settleHeadlineDraft } from "@/lib/offline/drafts";
import { DRAFT_SENT, flushOfflineDrafts, recentlySent, type DraftSentDetail } from "@/lib/offline/outbox";
import { promiseTasks, summarize, summaryText, taskPromiseOutcome, type EntryPromise } from "@/lib/weekly/promises";
import { WEEKLY_LIMITS } from "@/lib/weekly/rules";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { OverdueNote, RetroBadge, StaleNote, WeeklyBadge } from "@/components/ui/task-badges";
import { TextArea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { StateSelect, StatusSelect } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { EntryForm, isLocalId } from "./entry-form";
import { EntryItem } from "./entry-item";
import { PromoteControl } from "./promote";
import { PromiseStep } from "./promise-step";
import { FactSuggestions } from "./fact-suggestions";
import { ThanksField } from "./thanks-field";
import { taskFacts, type WeekFact } from "@/lib/weekly/facts";
import { greenOutside, greenOutsideText } from "@/lib/tasks/green-outside";
import { submittedText } from "./weekly-feed";
import type { TemplateBlock } from "@/lib/weekly-blocks/types";
import { WeeklyDelivery, type WeeklyReader } from "./weekly-delivery";

const HEADLINE_MAX = WEEKLY_LIMITS.headline;

function nowTime() {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

/**
 * Сдача weekly в четыре шага на одном экране (раздел 3 ТЗ, этап 22): итоги обещаний прошлой недели,
 * обновить свои задачи, написать главное и записи, проверить и сдать.
 * Черновик сохраняется на сервере сам: главная фраза через пару секунд после ввода, записи так же.
 * Этап 68 (из разбора этапа 59): шаги видны и на телефоне лентой под заголовком, кнопки без многоточий, в состоянии ожидания спиннер
 */
export function WeeklySubmit({
  week,
  initialReport,
  initialEntries,
  canEdit,
  deadlineText,
  timeLeft,
  late,
  promoted = [],
  expectedIn,
  promises: initialPromises = [],
  facts: initialFacts = [],
  skippedFacts = [],
  template = null,
  readers,
  past = false,
  closedText = null,
  sentWarning = null,
}: {
  week: WeekInfo;
  initialReport: PersonWeekly;
  initialEntries: WeeklyEntry[];
  canEdit: boolean;
  deadlineText: string;
  timeLeft: string;
  late: boolean;
  /** Записи людей моих команд, которые я поднял в свой weekly (этап 15) */
  promoted?: WeeklyEntry[];
  /** Команды, которые ждут мой weekly. Пусто: weekly от меня не ждут */
  expectedIn?: { id: string; name: string }[];
  /** Планы прошлого weekly с итогами (этап 22) */
  promises?: EntryPromise[];
  /** Факты недели для черновика (этап 22): закрытое, перенесённое, заблокированное, выполненные просьбы */
  facts?: WeekFact[];
  /** Ключи фактов, которые уже записи или скрыты, в этой и прошлой неделе */
  skippedFacts?: string[];
  /** Смысловые блоки weekly команды (этап 66): записи сдаются по ним. null: шаблона нет, weekly как раньше */
  template?: { teamId: string; teamName: string; blocks: TemplateBlock[] } | null;
  readers?: WeeklyReader[];
  /** Неделя раньше отчётной (этап 73): сдача будет задним числом */
  past?: boolean;
  /** Закрытая неделя, свой weekly уже сдан: кто может открыть неделю */
  closedText?: string | null;
  /** Отчёт руководителю за эту неделю уже отправлен: записи в него сами не войдут */
  sentWarning?: string | null;
}) {
  const { data, me, notify, notifyUndo, viewing } = usePrototype();
  const router = useRouter();
  const [weekly, setWeekly] = useState<PersonWeekly>(initialReport);
  const [entries, setEntries] = useState<WeeklyEntry[]>(initialEntries);
  const submitted = weekly.state === "submitted" || weekly.state === "late";

  const [headline, setHeadlineState] = useState(initialReport.headline);
  // Главная фраза тоже сначала ложится в черновик на устройстве (этап 26)
  const setHeadline = (value: string) => {
    setHeadlineState(value);
    // «Смотреть как» (этап 63): черновик выбранного человека на устройство владельца не пишется
    if (canEdit && !viewing) putHeadlineDraft(me.slug, week.key, value, savedHeadline.current);
  };
  const [offline, setOffline] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  /** Запись, которую просят удалить: сначала окно подтверждения */
  const [confirmDelete, setConfirmDelete] = useState<WeeklyEntry | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHeadline = useRef(initialReport.headline);
  const pendingHeadline = useRef(initialReport.headline);
  pendingHeadline.current = headline;

  const saveHeadline = useCallback(async () => {
    const value = pendingHeadline.current;
    if (value === savedHeadline.current || value.length > HEADLINE_MAX) return;
    setSaving(true);
    try {
      const result = await saveHeadlineAction(week.key, value);
      setOffline(false);
      if (result.ok) {
        savedHeadline.current = value;
        settleHeadlineDraft(me.slug, week.key, value);
        setWeekly(result.value);
        setSavedAt(nowTime());
      } else {
        // Правило не пускает: черновик не повторяем при каждом открытии
        dropHeadlineDraft(me.slug, week.key);
        notify(result.error, "error");
      }
    } catch (error) {
      // Нет сети: фраза осталась в черновике на устройстве и уйдёт, когда связь вернётся
      if (isNetworkError(error)) setOffline(true);
      else notify("Сервер не ответил: черновик сохранён на этом устройстве", "error");
    } finally {
      setSaving(false);
    }
  }, [week.key, notify, me.slug]);

  // Главная фраза сохраняется сама через 2 секунды тишины и сразу, когда вкладку прячут или закрывают
  useEffect(() => {
    // В просмотре автосохранения нет (этап 63): сервер всё равно откажет
    if (!canEdit || viewing || headline === savedHeadline.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveHeadline(), 2000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [headline, canEdit, viewing, saveHeadline]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && !viewing) void saveHeadline();
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [saveHeadline, viewing]);

  // Обещания недели (этап 22): планы прошлого weekly и мои задачи со сроком на этой неделе
  const [promises, setPromises] = useState<EntryPromise[]>(initialPromises);
  // Факты по задачам считаются на экране по живому списку задач: закрыли задачу в шаге 2, в шаге 3 сразу есть строка.
  // Выполненные просьбы приходят с сервера. Добавленные и скрытые факты хранятся ключами
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set(skippedFacts));
  const requestFacts = initialFacts.filter((f) => f.kind === "request");
  const facts = [...taskFacts(data.tasks, me.slug, { start: week.start, end: week.end }), ...requestFacts].filter((f) => !skipped.has(f.key));
  const setFacts = (update: (prev: WeekFact[]) => WeekFact[]) => {
    const kept = new Set(update(facts).map((f) => f.key));
    setSkipped((prev) => new Set([...prev, ...facts.filter((f) => !kept.has(f.key)).map((f) => f.key)]));
  };
  const range = { start: week.start, end: week.end };
  const owed = promiseTasks(data.tasks, me.slug, range);
  const owedNumbers = new Set(owed.map((t) => t.number));
  const promiseSummary = summarize([...promises.map((p) => p.review?.result), ...owed.map((t) => taskPromiseOutcome(t, range, data.today).result)]);

  const tasks = data.tasks.filter(
    (t) =>
      !t.archived &&
      !owedNumbers.has(t.number) &&
      isMine(t, me.slug, me.role) &&
      (isOverdue(t, data.today) || isDueThisWeek(t, data.today) || isDueNextWeek(t, data.today) || isStale(t, data.today) || greenOutside(t, data.today) !== null),
  );

  const newEntry = (): WeeklyEntry => ({
    id: `new-${Date.now()}`,
    week: week.key,
    author: me.slug,
    direction: me.direction,
    block: BLOCKS.some((b) => b.code === "key-changes") ? "key-changes" : (BLOCKS[0]?.code ?? "key-changes"),
    type: "event",
    what: "",
    links: [],
    ceo: false,
  });
  const [draft, setDraft] = useState<WeeklyEntry | null>(null);
  /** id, который получил на сервере черновик новой записи: пока форма открыта, в списке его не показываем */
  const [draftId, setDraftId] = useState<string | null>(null);

  const upsert = (entry: WeeklyEntry) => {
    setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev.map((e) => (e.id === entry.id ? entry : e)) : [...prev, entry]));
    if (weekly.state === "not-started") setWeekly((w) => ({ ...w, state: "draft" }));
    setSavedAt(nowTime());
  };

  const onSaved = (entry: WeeklyEntry) => {
    upsert(entry);
    setDraft(null);
    setDraftId(null);
    setEditing(null);
    notify("Запись сохранена");
  };

  // Черновик новой записи сохранился сам: форма остаётся открытой, курсор на месте
  const onAutosaved = (entry: WeeklyEntry) => {
    upsert(entry);
    setDraftId(entry.id);
  };

  // Черновики с этого устройства (этап 26): отправляет оболочка приложения при открытии и когда возвращается связь.
  // Здесь видно, сколько ждёт отправки за эту неделю, и дошедшие записи встают в список без перезагрузки
  const [outbox, setOutbox] = useState(0);
  const upsertRef = useRef(upsert);
  upsertRef.current = upsert;
  useEffect(() => {
    const headlineKey = `headline:${week.key}`;
    ACTIVE_DRAFTS.add(headlineKey);
    // Главная фраза, которую не успели отправить в прошлый раз, возвращается в поле и уходит сама. Если на сервере
    // её уже изменили на другом устройстве, черновик устарел: не возвращаем и говорим об этом
    const kept = canEdit && !viewing ? headlineDraft(me.slug, week.key) : null;
    if (kept && kept.value !== savedHeadline.current) {
      if (kept.base !== undefined && kept.base !== savedHeadline.current) {
        dropHeadlineDraft(me.slug, week.key);
        notify("Главная фраза с этого устройства не восстановлена: её уже изменили на другом устройстве", "error");
      } else setHeadlineState(kept.value);
    } else if (kept) settleHeadlineDraft(me.slug, week.key, kept.value);
    const count = () => setOutbox(entryDrafts(me.slug, week.key).filter((d) => !ACTIVE_DRAFTS.has(d.key)).length);
    count();
    const sentHere = (ev: Event) => {
      const { entry } = (ev as CustomEvent<DraftSentDetail>).detail;
      if (entry && entry.week === week.key) upsertRef.current(entry);
    };
    // Оболочка могла отправить черновик раньше, чем открылся этот экран: такие записи тоже показываем
    // Запись уже есть в списке с сервера: её не трогаем, версия с сервера свежее
    const missed = recentlySent().flatMap((d) => (d.entry && d.entry.week === week.key ? [d.entry] : []));
    if (missed.length) setEntries((prev) => [...prev, ...missed.filter((m) => !prev.some((e) => e.id === m.id))]);
    const back = () => {
      setOffline(false);
      if (!viewing) void saveHeadline();
    };
    const gone = () => setOffline(true);
    if (typeof navigator !== "undefined" && !navigator.onLine) setOffline(true);
    window.addEventListener(DRAFTS_CHANGED, count);
    window.addEventListener(DRAFT_SENT, sentHere);
    window.addEventListener("online", back);
    window.addEventListener("offline", gone);
    return () => {
      ACTIVE_DRAFTS.delete(headlineKey);
      window.removeEventListener(DRAFTS_CHANGED, count);
      window.removeEventListener(DRAFT_SENT, sentHere);
      window.removeEventListener("online", back);
      window.removeEventListener("offline", gone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Перенесённый план удалили или вернули: шаг обещаний показывает это без перезагрузки (этап 22) */
  const setCarried = (promiseEntryId: string, carried: { id: string; what: string } | undefined) =>
    setPromises((prev) => prev.map((p) => (p.entryId === promiseEntryId && p.review ? { ...p, review: { ...p.review, carried } } : p)));

  const restore = async (token: string, index: number, carriedBy?: string) => {
    try {
      const result = await restoreEntryAction(token);
      if (!result.ok) return notify(result.error, "error");
      const back = result.value;
      // Запись встаёт на прежнее место, а не в конец
      setEntries((prev) => (prev.some((e) => e.id === back.id) ? prev : [...prev.slice(0, index), back, ...prev.slice(index)]));
      if (carriedBy) setCarried(carriedBy, { id: back.id, what: back.what });
      if (back.factKey) setSkipped((prev) => new Set([...prev, back.factKey!]));
      notify("Запись возвращена");
    } catch {
      notify("Нет связи с сервером: запись не вернулась", "error");
    }
  };

  const remove = async (entry: WeeklyEntry) => {
    if (isLocalId(entry.id)) return;
    try {
      const index = entries.findIndex((e) => e.id === entry.id);
      const carriedBy = promises.find((p) => p.review?.carried?.id === entry.id)?.entryId;
      const result = await deleteEntryAction(entry.id);
      if (!result.ok) return notify(result.error, "error");
      dropDraftsForEntry(me.slug, entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      if (carriedBy) setCarried(carriedBy, undefined);
      // Запись из факта удалили: факт снова предлагается
      if (entry.factKey) {
        setSkipped((prev) => {
          const next = new Set(prev);
          next.delete(entry.factKey!);
          return next;
        });
      }
      const token = result.value.undo;
      notifyUndo("Запись удалена", () => void restore(token, Math.max(index, 0), carriedBy));
    } catch {
      notify("Нет связи с сервером: запись не удалилась", "error");
    }
  };

  const submit = async () => {
    setSubmitting(true);
    await saveHeadline();
    try {
      const result = await submitWeeklyAction(week.key);
      if (!result.ok) return notify(result.error, "error");
      setWeekly(result.value);
      notify(result.value.retro ? "Weekly сдан задним числом" : result.value.state === "late" ? "Weekly сдан с опозданием" : "Weekly сдан");
      router.refresh();
    } catch {
      notify("Нет связи с сервером: weekly не сдан", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const [reopening, setReopening] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const reopen = async () => {
    setConfirmReopen(false);
    setReopening(true);
    try {
      const result = await reopenWeeklyAction(week.key);
      if (!result.ok) return notify(result.error, "error");
      setWeekly((w) => ({ ...w, state: "draft", submittedAt: undefined }));
      notify("Weekly снова черновик: сдайте его, когда допишете");
      router.refresh();
    } catch {
      notify("Нет связи с сервером: weekly остался сданным", "error");
    } finally {
      setReopening(false);
    }
  };

  const problems = [
    !headline.trim() ? "Нет главной фразы недели" : null,
    entries.length === 0 && promoted.length === 0 ? "Нет ни одной записи" : null,
    headline.length > HEADLINE_MAX ? `Главная фраза длиннее ${HEADLINE_MAX} знаков` : null,
  ].filter(Boolean) as string[];

  const steps = [
    { href: "#step-promises", label: "Обещания", note: `${promises.length + owed.length}`, done: submitted },
    { href: "#step-tasks", label: "Обновить задачи", note: `${tasks.length}`, done: submitted || tasks.length === 0 },
    { href: "#step-entries", label: "Главное и записи", note: `${entries.length}`, done: submitted },
    { href: "#step-submit", label: "Проверить и сдать", note: submitted ? "сдан" : "", done: submitted },
  ];

  return (
    <div className="lg:grid lg:grid-cols-[248px_minmax(0,840px)] lg:gap-10">
      <Modal
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Удалить запись?"
        description={confirmDelete?.what}
      >
        <p className="text-small text-muted">Удаление можно отменить в течение 5 секунд кнопкой «Отменить» внизу экрана.</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
            Не удалять
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const entry = confirmDelete;
              setConfirmDelete(null);
              if (entry) void remove(entry);
            }}
          >
            Удалить
          </Button>
        </div>
      </Modal>
      <Modal
        open={confirmReopen}
        onOpenChange={setConfirmReopen}
        title="Вернуть weekly в черновик?"
        description="Команда увидит, что weekly не сдан. Когда допишете, сдайте его снова."
      >
        {late ? <p className="text-small font-medium text-danger-ink">Срок сдачи уже прошёл: повторная сдача будет с отметкой «Сдан с опозданием».</p> : null}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirmReopen(false)}>
            Оставить сданным
          </Button>
          <Button onClick={() => void reopen()}>Вернуть в черновик</Button>
        </div>
      </Modal>
      <aside className="mb-4 lg:mb-0">
        <div className="lg:sticky lg:top-24">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 lg:block">
            {weekly.retro ? <RetroBadge /> : <WeeklyBadge state={weekly.state} />}
            <p className="text-small text-muted lg:mt-3">
              {past ? (
                // Этап 73: прошлая неделя. Сдача сейчас будет задним числом, это видно в ленте и у руководителя
                <>
                  Срок был: <span className="whitespace-nowrap">{deadlineText}</span>. {submitted ? null : <span className="font-medium text-warning-ink">Сдача сейчас будет отмечена «сдан задним числом».</span>}
                </>
              ) : (
                <>
                  Срок: <span className="whitespace-nowrap">{deadlineText}</span>. {late ? <span className="font-medium text-danger-ink">Срок прошёл.</span> : `Осталось ${timeLeft}.`}
                </>
              )}
            </p>
          </div>
          {expectedIn?.length ? <p className="mt-1 text-small text-muted">Сдаёте в команду: {expectedIn.map((t) => t.name).join(", ")}</p> : null}
          {readers ? <div className="mt-3"><WeeklyDelivery readers={readers} submitted={submitted} /></div> : null}
          <p className="mt-2 inline-flex items-center gap-1.5 text-caption text-muted" aria-live="polite">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            {!canEdit ? "Только просмотр" : saving ? "Сохраняем черновик" : savedAt ? `Черновик сохранён в ${savedAt}` : "Черновик сохраняется на сервере сам"}
          </p>
          {canEdit && (offline || outbox > 0) ? (
            <p role="status" className="mt-3 sv-alert sv-alert--warning inline-flex items-start gap-2 text-small">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                {offline ? "Нет сети. Черновик сохраняется на этом устройстве и уйдёт на сервер, когда связь вернётся." : "Черновик с этого устройства ещё не дошёл до сервера."}
                {outbox > 0 ? ` Ждут отправки: ${outbox}.` : ""}
                {!offline && outbox > 0 ? (
                  <button type="button" className="ml-1 font-semibold underline underline-offset-2" onClick={() => void flushOfflineDrafts(me.slug)}>
                    Отправить сейчас
                  </button>
                ) : null}
              </span>
            </p>
          ) : null}
          {/* Шаги по дизайн-системе (weekly/SubmitSteps.jsx): номер в кружке, сделанный шаг зелёный. Этап 68: на планшете
              и телефоне шаги лентой под заголовком (sv-steps--row), раньше они были скрыты и человек не видел, сколько осталось */}
          <nav aria-label="Шаги сдачи" className="mt-4 lg:mt-6">
            <ol className="sv-steps sv-steps--row sv-steps--strip m-0 list-none p-0 lg:flex-col lg:gap-[2px] lg:overflow-visible">
              {steps.map((s, i) => (
                <li key={s.href}>
                  <a href={s.href} className={cn("sv-step lg:w-full", s.done && "is-done")}>
                    <span className="sv-step__n">{s.done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" /> : i + 1}</span>
                    <span className="lg:flex-1">{s.label}</span>
                    <span className="text-caption tabular-nums text-text-secondary">{s.note}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-10">
        {!canEdit ? (
          <p className="inline-flex items-start gap-2 sv-card sv-card--soft px-5 py-4 text-body text-ink">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {closedText ?? (week.closed ? `Неделя ${week.number} закрыта: записи правят только владелец и администраторы.` : "Этот weekly открыт только для просмотра.")}
          </p>
        ) : null}
        {canEdit && week.closed && week.retroOpen ? (
          // Этап 73: свой несданный weekly закрытой недели можно дописать и сдать задним числом
          <p className="sv-alert sv-alert--info text-body" data-testid="weekly-retro-open">
            Неделя {week.number} закрыта, но ваш weekly за неё ещё не сдан: его можно дописать и сдать задним числом. Итоги закрытой недели и уже отправленный отчёт руководителю от этого не пересчитываются.
          </p>
        ) : null}
        {expectedIn && expectedIn.length === 0 && !submitted ? (
          <p className="sv-card sv-card--soft px-5 py-4 text-body text-ink">
            Weekly от вас не ждут: в вашей команде его сдают руководители. Обновляйте задачи, а важное за неделю можно записать и сдать.
          </p>
        ) : null}
        <Step
          id="step-promises"
          n={1}
          title="Что вы обещали на прошлой неделе"
          description="Итог по каждому плану. Невыполненное можно перенести на следующую неделю"
        >
          <PromiseStep week={week} promises={promises} setPromises={setPromises} tasks={owed} canEdit={canEdit} onCarried={upsert} />
        </Step>

        <Step
          id="step-tasks"
          n={2}
          title="Обновить задачи"
          description="Только срочное: просрочено, срок на этой и следующей неделе, давно без обновлений"
        >
          {tasks.length === 0 ? (
            // Этап 73 (пакет дизайнера): пустое состояние одной плашкой, а не большим блоком
            <p className="sv-card sv-card--soft flex items-center gap-2 px-4 py-3 text-body text-ink" data-testid="weekly-no-urgent">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-ink" aria-hidden="true" />
              Срочных задач нет, переходите к главному за неделю
            </p>
          ) : (
            <ul className="divide-y divide-line sv-card sv-card--soft">
              {tasks.map((t) => (
                <TaskUpdateRow key={`${t.number}-${t.where}`} task={t} />
              ))}
            </ul>
          )}
        </Step>

        <Step id="step-entries" n={3} title="Главное за неделю" description="Одна фраза и записи о событиях, обычно от 3 до 7">
          <TextArea
            label="Главное одной фразой"
            id="headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            onBlur={() => void saveHeadline()}
            rows={2}
            readOnly={!canEdit}
            counter={{ value: headline.length, max: HEADLINE_MAX }}
          />
          <div className="mt-6 flex flex-col gap-4">
            {canEdit ? <FactSuggestions week={week.key} facts={facts} setFacts={setFacts} onAdded={upsert} /> : null}
            <h3 className="text-lead font-semibold text-ink">
              Записи <span className="font-normal text-muted">{entries.length}</span>
            </h3>
            {template ? (
              <p className="text-small text-muted" data-testid="weekly-template-hint">
                Команда «{template.teamName}» сдаёт weekly по блокам: {template.blocks.map((b) => b.title).join(", ")}. У каждой записи выберите блок отчёта.
              </p>
            ) : null}
            {entries.length === 0 && !draft ? <p className="text-body text-muted">Пока ни одной записи.</p> : null}
            <ul className="flex flex-col gap-3">
              {entries.filter((e) => !(draft && e.id === draftId)).map((e) =>
                editing === e.id ? (
                  <li key={e.id}>
                    <EntryForm initial={e} onSaved={onSaved} onAutosaved={upsert} onCancel={() => setEditing(null)} template={template?.blocks} />
                  </li>
                ) : (
                  <li key={e.id} className="flex flex-col gap-3 sv-card sv-card--soft px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <EntryItem entry={e} discussion={false} compact />
                    </div>
                    {canEdit ? <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e.id)} aria-label={`Изменить запись «${e.what}»`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Изменить
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(e)} aria-label={`Удалить запись «${e.what}»`}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div> : null}
                  </li>
                ),
              )}
            </ul>
            {promoted.length ? (
              <section aria-labelledby="from-team" className="flex flex-col gap-3">
                <h3 id="from-team" className="text-lead font-semibold text-ink">
                  Из команды <span className="font-normal text-muted">{promoted.length}</span>
                </h3>
                <p className="text-small text-muted">Записи людей ваших команд, которые вы подняли наверх. Они уйдут с вашим weekly, переписывать их не нужно</p>
                <ul className="flex flex-col gap-3">
                  {promoted.map((e) => {
                    const note = e.promoted?.find((x) => x.by === me.slug)?.note;
                    return (
                      <li key={e.id} className="flex flex-col gap-2 sv-card sv-card--soft px-4 py-3">
                        <EntryItem entry={e} showAuthor discussion={false} compact />
                        {note ? (
                          <p className="text-body text-ink">
                            <span className="text-muted">От себя: </span>
                            {note}
                          </p>
                        ) : null}
                        <PromoteControl entry={e} promoteFrom={[]} closed={!canEdit} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {!canEdit ? null : draft ? (
              <EntryForm
                initial={draft}
                template={template?.blocks}
                onSaved={onSaved}
                onAutosaved={onAutosaved}
                onCancel={() => {
                  setDraft(null);
                  setDraftId(null);
                }}
              />
            ) : (
              <div>
                <Button variant="secondary" onClick={() => setDraft(newEntry())}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Добавить запись
                </Button>
              </div>
            )}
          </div>
          {/* «Спасибо коллеге» после записей (этап 43): необязательная строка в конце шага, а не между фразой и записями */}
          <div className="mt-6">
            <ThanksField week={week.key} initial={initialReport.thanks ?? ""} canEdit={canEdit} />
          </div>
        </Step>

        <Step id="step-submit" n={4} title="Проверить и сдать" description="Править можно до закрытия недели">
          {submitted ? (
            <div className="flex flex-col gap-3 sv-card sv-card--soft bg-green-soft p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="inline-flex items-start gap-2 text-lead text-green-ink">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{weekly.retro ? "Сдан задним числом" : weekly.state === "late" ? "Сдан с опозданием" : "Weekly сдан"}</span>
                  {weekly.submittedAt ? `, ${submittedText(weekly.submittedAt).replace(/^сдан /, "")}` : ""}. Правки до закрытия недели разрешены.
                </span>
              </p>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={`/weekly?week=${week.key}`} className="inline-flex h-11 items-center rounded-lg px-4 text-body font-semibold text-ink hover:bg-field">
                  Открыть ленту недели
                </Link>
                {canEdit ? (
                  <Button variant="ghost" onClick={() => setConfirmReopen(true)} disabled={reopening} loading={reopening}>
                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                    Вернуть в черновик
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="sv-card sv-card--soft">
              <dl className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt className="text-caption text-muted">Обещания</dt>
                  <dd className="mt-1 text-body text-ink">{summaryText(promiseSummary)}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">Главное</dt>
                  <dd className={cn("mt-1 text-body", headline.trim() ? "text-ink" : "text-danger-ink")}>{headline.trim() || "Не написано"}</dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">Записи</dt>
                  <dd className="mt-1 text-body text-ink">
                    {entries.length
                      ? ENTRY_TYPES.map((t) => ({ t, n: entries.filter((e) => e.type === t.code).length }))
                          .filter((x) => x.n)
                          .map((x) => `${entryTypeLabel(x.t.code)}: ${x.n}`)
                          .join(", ")
                      : "Нет"}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-muted">Задачи на внимание</dt>
                  <dd className="mt-1 text-body text-ink">
                    {tasks.filter((t) => t.whereUpdatedAt === data.today).length} из {tasks.length} обновлены сегодня
                  </dd>
                </div>
              </dl>
              <div className="flex flex-col gap-3 border-t border-line p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  {problems.length ? (
                    <ul className="text-small text-danger-ink">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-small text-muted">Всё на месте. После сдачи weekly увидит вся команда.</p>
                  )}
                  {sentWarning ? (
                    <p className="text-small text-warning-ink" data-testid="weekly-sent-warning">
                      {sentWarning}
                    </p>
                  ) : null}
                  {promiseSummary.pending ? (
                    <p className="text-small text-ink">
                      Без итога обещаний: {promiseSummary.pending}. В доле выполненных обещаний они считаются невыполненными, сдать weekly можно и так.
                    </p>
                  ) : null}
                </div>
                <Button onClick={() => void submit()} disabled={problems.length > 0 || submitting || !canEdit} loading={submitting} className="sm:min-w-44">
                  Сдать weekly
                </Button>
              </div>
            </div>
          )}
        </Step>
      </div>
    </div>
  );
}

function Step({ id, n, title, description, children }: { id: string; n: number; title: string; description: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-32 lg:scroll-mt-24">
      <div className="mb-4 flex items-start gap-3">
        <span className="sv-step__n mt-1 !h-8 !w-8 !border-link !text-body !text-link" aria-hidden="true">
          {n}
        </span>
        <div>
          <h2 id={`${id}-title`} className="text-section">
            <span className="sr-only">Шаг {n}. </span>
            {title}
          </h2>
          <p className="mt-0.5 text-body text-text-secondary">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * Строка задачи во втором шаге: статус, состояние и «где сейчас» меняются без открытия карточки. Этап 73 (аудит): одна
 * метка по приоритету (просрочена, давно не обновлялась) без заливки строки, срок не переносится, у «Где сейчас» видимая
 * подпись и подсказка, «где сейчас» сохраняется само, когда уходишь из поля
 */
function TaskUpdateRow({ task }: { task: Task }) {
  const { data } = usePrototype();
  const actions = useTaskActions();
  const { open } = useOpenTask();
  const [where, setWhere] = useState(task.where);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saving = useRef(false);
  const overdue = isOverdue(task, data.today);
  const stale = !overdue && isStale(task, data.today);
  const green = greenOutside(task, data.today);
  const changed = where.trim() !== task.where && where.trim().length > 0;
  const save = async () => {
    if (!changed || saving.current) return;
    saving.current = true;
    const ok = await actions.updateWhere(task, where.trim());
    saving.current = false;
    if (ok) setSavedAt(nowTime());
  };
  const fieldId = `w-${task.number}`;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <button type="button" onClick={() => open(task.number)} className="min-h-11 text-left text-body font-medium leading-snug text-ink hover:text-blue-700 hover:underline sm:min-h-0">
          <span className="mr-1.5 font-normal tabular-nums text-muted">{task.number}</span>
          {task.title}
        </button>
        <span className="flex shrink-0 items-center gap-2 text-caption">
          <span className={cn("whitespace-nowrap tabular-nums", overdue ? "font-semibold text-danger-ink" : "text-muted")}>срок {formatShort(task.due)}</span>
          {overdue ? <OverdueNote days={overdueDays(task, data.today)} /> : stale ? <StaleNote /> : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        <StatusSelect task={task} />
        <StateSelect task={task} set />
      </div>
      {green && !overdue ? (
        <p className="text-small text-orange-ink">
          {greenOutsideText(green)}. {green.unconfirmed ? "«В графике» не считается, пока не обновите или не подтвердите «где сейчас»" : "Проверьте состояние и обновите «где сейчас»"}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor={fieldId} className="text-small font-medium text-ink">
          Где сейчас
          <span className="sr-only"> по задаче {task.number}</span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            id={fieldId}
            value={where}
            onChange={(e) => {
              setWhere(e.target.value);
              setSavedAt(null);
            }}
            onBlur={() => void save()}
            placeholder="Что сделано и что дальше"
            aria-describedby={`${fieldId}-hint`}
            className="sv-control h-11 w-full min-w-0 px-3 text-small sm:h-10 sm:flex-1"
          />
          {changed ? (
            <Button size="sm" type="submit" className="h-11 sm:h-10">
              Сохранить
            </Button>
          ) : green && task.where && !savedAt && task.whereUpdatedAt !== data.today ? (
            <Button size="sm" type="button" variant="secondary" className="h-11 sm:h-10" onClick={() => void actions.updateWhere(task, task.where).then((ok) => ok && setSavedAt(nowTime()))}>
              Подтвердить: всё так же
            </Button>
          ) : null}
        </div>
        <p id={`${fieldId}-hint`} className="text-caption text-text-secondary" aria-live="polite">
          {savedAt ? `Сохранено в ${savedAt}` : task.whereUpdatedAt === data.today ? "Обновлено сегодня" : "Что сделано и что дальше. Сохраняется само, когда уходите из поля"}
        </p>
      </form>
    </li>
  );
}
