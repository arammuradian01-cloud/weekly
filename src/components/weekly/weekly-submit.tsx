"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Cloud, CloudOff, Lock, Undo2 } from "lucide-react";
import { usePrototype } from "@/domain/store";
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
import { OverdueNote, StaleNote, WeeklyBadge } from "@/components/ui/task-badges";
import { TextArea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { StateSelect, StatusSelect } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { isLocalId } from "./entry-form";
import { EntryItem } from "./entry-item";
import { PromoteControl } from "./promote";
import { PromiseStep } from "./promise-step";
import { WeeklyEntryBlocks } from "./weekly-entry-blocks";
import { TeamBlocksTemplate } from "@/components/weekly-blocks/team-template";
import type { TeamTemplateView } from "@/lib/weekly-blocks/team";
import { classificationForSection } from "@/lib/weekly-blocks/entry-classification";
import { ThanksField } from "./thanks-field";
import { taskFacts, type WeekFact } from "@/lib/weekly/facts";
import { greenOutside, greenOutsideText } from "@/lib/tasks/green-outside";
import { submittedText } from "./weekly-feed";
import { STANDARD_TEMPLATE, type TemplateBlock } from "@/lib/weekly-blocks/types";
import { WeeklyDelivery, type WeeklyReader } from "./weekly-delivery";

const HEADLINE_MAX = WEEKLY_LIMITS.headline;

function nowTime() {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

/**
 * Сдача weekly как редактирование отчёта: смысловые блоки и одна открытая запись.
 * Задачи и обещания доступны в компактном раскрывающемся разделе.
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
  templateEditors = [],
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
  /** Кто получит weekly (этап 73а): руководители команд, в чью ленту он попадает */
  readers?: WeeklyReader[];
  templateEditors?: TeamTemplateView[];
}) {
  const { data, me, notify, notifyUndo, viewing } = usePrototype();
  const router = useRouter();
  const writable = canEdit && !viewing;
  const [changedTemplate, setChangedTemplate] = useState<TeamTemplateView | null>(null);
  const blocks = changedTemplate?.blocks ?? template?.blocks ?? STANDARD_TEMPLATE;
  const [weekly, setWeekly] = useState<PersonWeekly>(initialReport);
  const [entries, setEntries] = useState<WeeklyEntry[]>(initialEntries);
  const submitted = weekly.state === "submitted" || weekly.state === "late";

  const [headline, setHeadlineState] = useState(initialReport.headline);
  // Главная фраза тоже сначала ложится в черновик на устройстве (этап 26)
  const setHeadline = (value: string) => {
    setHeadlineState(value);
    setSavedAt(null);
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
  const headlineQueue = useRef<Promise<unknown>>(Promise.resolve());
  pendingHeadline.current = headline;

  const saveHeadline = useCallback(function enqueueHeadline(): Promise<boolean> {
    // Blur, таймер и сдача могут сработать вместе. Каждый запрос берёт актуальный текст после предыдущего.
    const operation = headlineQueue.current.then(async () => {
      const value = pendingHeadline.current;
      // Фраза за пределом: сервер откажет, сохранять нечего. Строка состояния ниже говорит об этом прямо,
      // иначе человек видит «Черновик сохранён в 00:12» от прошлого сохранения и дописывает в пустоту
      if (value.length > HEADLINE_MAX) return false;
      if (value === savedHeadline.current) return true;
      setSaving(true);
      try {
        const result = await saveHeadlineAction(week.key, value);
        setOffline(false);
        if (result.ok) {
          savedHeadline.current = value;
          settleHeadlineDraft(me.slug, week.key, value);
          setWeekly(result.value);
          setSavedAt(value === pendingHeadline.current ? nowTime() : null);
          // Пока запрос шёл, текст могли вернуть к предыдущей сохранённой версии: эффект не поставит таймер.
          // Добавляем актуальную фразу в ту же очередь, не ожидая её внутри текущей операции.
          if (value !== pendingHeadline.current && canEdit && !viewing) void enqueueHeadline();
          return true;
        } else {
          // Правило не пускает: черновик не повторяем при каждом открытии
          dropHeadlineDraft(me.slug, week.key);
          notify(result.error, "error");
          return false;
        }
      } catch (error) {
        // Нет сети: фраза осталась в черновике на устройстве и уйдёт, когда связь вернётся
        if (isNetworkError(error)) setOffline(true);
        else notify("Сервер не ответил: черновик сохранён на этом устройстве", "error");
        return false;
      } finally {
        setSaving(false);
      }
    });
    headlineQueue.current = operation.catch(() => undefined);
    return operation;
  }, [week.key, notify, me.slug, canEdit, viewing]);

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

  const newEntry = (section: string): WeeklyEntry => ({
    id: `new-${crypto.randomUUID()}`,
    week: week.key,
    author: me.slug,
    direction: me.direction,
    ...classificationForSection(section),
    section,
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
    if (!writable || draft || editing || offline || outbox || submitting) return;
    setSubmitting(true);
    if (!(await saveHeadline())) { setSubmitting(false); return; }
    try {
      const result = await submitWeeklyAction(week.key);
      if (!result.ok) return notify(result.error, "error");
      setWeekly(result.value);
      notify(result.value.state === "late" ? "Weekly сдан с опозданием" : "Weekly сдан");
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
    draft || editing ? "Завершите редактирование записи" : null,
    offline || outbox ? "Дождитесь отправки черновика на сервер" : null,
  ].filter(Boolean) as string[];

  const submitButton = () => <Button onClick={() => void submit()} disabled={problems.length > 0 || submitting || !writable} loading={submitting}>Сдать weekly</Button>;

  return (
    <div className="weekly-composer mx-auto flex max-w-[1040px] flex-col gap-5 pb-36 md:pb-8" data-testid="weekly-composer">
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
      <header className="flex flex-wrap items-start justify-between gap-3 md:sticky md:top-20 md:z-20 md:rounded-panel md:border md:border-line md:bg-surface md:p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <WeeklyBadge state={weekly.state} />
            <p className="text-small text-muted">Срок: {deadlineText}. {late ? <span className="text-danger-ink">Срок прошёл.</span> : `Осталось ${timeLeft}.`}</p>
          </div>
          {template ? <p className="mt-1 text-small text-muted" data-testid="weekly-template-hint">Блоки команды «{template.teamName}»</p> : null}
          <p className={writable && headline.length > HEADLINE_MAX ? "mt-2 inline-flex items-center gap-1.5 text-caption font-semibold text-warning-ink" : "mt-2 inline-flex items-center gap-1.5 text-caption text-muted"} aria-live="polite">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            {!writable
              ? "Только просмотр"
              : headline.length > HEADLINE_MAX
                ? `Автосохранение остановлено: главная фраза длиннее ${HEADLINE_MAX} знаков`
                : saving
                  ? "Сохраняем черновик"
                  : savedAt
                    ? `Черновик сохранён в ${savedAt}`
                    : "Черновик сохраняется на сервере сам"}
          </p>
          {writable && (offline || outbox > 0) ? (
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
        </div>
        {!submitted ? <div className="hidden md:block">{submitButton()}</div> : null}
      </header>
      {readers ? <details className="text-small"><summary className="cursor-pointer text-link">{submitted ? "Кто читает ваш weekly" : "Кто получит weekly"}</summary><div className="mt-2"><WeeklyDelivery readers={readers} submitted={submitted} /></div></details> : null}
      {!writable ? <p className="flex items-center gap-2 text-small text-muted"><Lock className="h-4 w-4" aria-hidden="true" />{week.closed ? `Неделя ${week.number} закрыта: записи правят только владелец и администраторы.` : "Этот weekly открыт только для просмотра."}</p> : null}
      {expectedIn && expectedIn.length === 0 && !submitted ? <p className="text-small text-muted">Weekly от вас не ждут. Важное за неделю можно записать и сдать.</p> : null}
      <section id="step-entries" aria-label="Главное за неделю">
        <TextArea label="Главное одной фразой" id="headline" value={headline} onChange={(e) => setHeadline(e.target.value)} onBlur={() => void saveHeadline()} rows={2} readOnly={!writable || submitting} counter={{ value: headline.length, max: HEADLINE_MAX }} />
      </section>
      {promises.length + owed.length + tasks.length > 0 ? <details className="rounded-control border border-line bg-surface p-4" data-testid="weekly-attention">
        <summary className="cursor-pointer text-small font-semibold">Требуют внимания: {tasks.length} задач{promiseSummary.pending ? `, обещаний без итога: ${promiseSummary.pending}` : ""}</summary>
        <div className="mt-5 space-y-6">
          {promises.length + owed.length > 0 ? <section id="step-promises" aria-labelledby="promises-title">
            <h2 id="promises-title" className="mb-3 text-lead font-semibold">Что вы обещали на прошлой неделе</h2>
            <PromiseStep week={week} promises={promises} setPromises={setPromises} tasks={owed} canEdit={writable} onCarried={upsert} />
          </section> : null}
          {tasks.length ? <section id="step-tasks" aria-labelledby="tasks-title"><h2 id="tasks-title" className="mb-3 text-lead font-semibold">Обновить задачи</h2><ul className="divide-y divide-line">{tasks.map((t) => <TaskUpdateRow key={`${t.number}-${t.where}`} task={t} />)}</ul></section> : null}
        </div>
      </details> : null}
      <WeeklyEntryBlocks week={week.key} blocks={blocks} entries={entries} facts={facts} canEdit={writable} draft={draft} draftId={draftId} editing={editing}
        onAdd={(section) => setDraft(newEntry(section))} onEdit={setEditing} onDelete={setConfirmDelete}
        onSaved={onSaved} onAutosaved={upsert} onDraftAutosaved={onAutosaved} onCancel={() => { setDraft(null); setDraftId(null); setEditing(null); }}
        onFactAdded={upsert} setFacts={setFacts} />
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
                        <PromoteControl entry={e} promoteFrom={[]} closed={!writable} />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
      <details open={initialReport.thanks ? true : undefined} className="text-small"><summary className="cursor-pointer text-link">Спасибо коллеге</summary><div className="pt-3"><ThanksField week={week.key} initial={initialReport.thanks ?? ""} canEdit={writable} /></div></details>
      {writable ? templateEditors.map((editor) => <details key={editor.teamId} className="rounded-control border border-line p-4"><summary className="cursor-pointer text-small font-semibold">Настроить блоки команды «{editor.teamName}»</summary><div className="pt-4">
        {draft || editing ? <p className="text-small text-muted">Сначала завершите редактирование записи.</p> : <TeamBlocksTemplate initial={changedTemplate?.teamId === editor.teamId ? changedTemplate : editor} onSaved={(updated) => { if (updated.teamId === template?.teamId) setChangedTemplate(updated); }} />}
      </div></details>) : null}
      <section id="step-submit" aria-label="Сдача weekly" className="space-y-3">
        {submitted ? <div className="rounded-panel bg-green-soft p-4">
          <p className="flex items-center gap-2 text-green-ink"><CheckCircle2 className="h-5 w-5" aria-hidden="true" /><span className="font-semibold">{weekly.state === "late" ? "Сдан с опозданием" : "Weekly сдан"}{weekly.submittedAt ? `, ${submittedText(weekly.submittedAt).replace(/^сдан /, "")}` : ""}</span></p>
          <div className="mt-3 flex flex-wrap items-center gap-3"><Link href={`/weekly?week=${week.key}`} className="text-small text-link">Открыть ленту недели</Link>
            {writable ? <Button variant="ghost" onClick={() => setConfirmReopen(true)} disabled={reopening || !!draft || !!editing} loading={reopening}><Undo2 className="h-4 w-4" aria-hidden="true" />Вернуть в черновик</Button> : null}
          </div>
        </div> : <>
          {problems.length ? <ul className="text-small text-muted" aria-live="polite">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : <p className="text-small text-muted">Записей в отчёте: {entries.length + promoted.length}. Можно сдавать.</p>}
          {promiseSummary.pending ? <p className="text-small text-muted">Обещаний без итога: {promiseSummary.pending}. Сдать weekly можно, но они будут считаться невыполненными.</p> : null}
          <p className="sr-only">{summaryText(promiseSummary)}</p>
          <div data-testid="weekly-submit-bar" className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 flex items-center justify-between gap-3 rounded-panel border border-line bg-surface p-3 shadow-sticky md:hidden"><span className="text-small text-muted">{draft || editing ? "Открыта запись" : `${entries.length + promoted.length} записей`}</span>{submitButton()}</div>
        </>}
      </section>
    </div>
  );
}

/** Строка задачи во втором шаге: статус, состояние и «где сейчас» меняются без открытия карточки */
function TaskUpdateRow({ task }: { task: Task }) {
  const { data } = usePrototype();
  const actions = useTaskActions();
  const { open } = useOpenTask();
  const [where, setWhere] = useState(task.where);
  const overdue = isOverdue(task, data.today);
  const green = greenOutside(task, data.today);
  const changed = where.trim() !== task.where && where.trim().length > 0;
  return (
    <li className={cn("flex flex-col gap-2 px-4 py-3", overdue && "bg-danger-soft")}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <button type="button" onClick={() => open(task.number)} className="text-left text-body font-medium leading-snug text-ink hover:text-blue-700 hover:underline">
          <span className="mr-1.5 font-normal tabular-nums text-muted">{task.number}</span>
          {task.title}
        </button>
        <span className="flex flex-wrap items-center gap-2 text-caption">
          <span className={cn("tabular-nums", overdue ? "font-semibold text-danger-ink" : "text-muted")}>срок {formatShort(task.due)}</span>
          {overdue ? <OverdueNote days={overdueDays(task, data.today)} /> : null}
          {isStale(task, data.today) ? <StaleNote /> : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        <StatusSelect task={task} />
        <StateSelect task={task} set />
      </div>
      {green ? (
        <p className="text-small text-orange-ink">
          {greenOutsideText(green)}. {green.unconfirmed ? "«В графике» не считается, пока не обновите или не подтвердите «где сейчас»" : "Проверьте состояние и обновите «где сейчас»"}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) actions.updateWhere(task, where.trim());
        }}
      >
        <label htmlFor={`w-${task.number}`} className="sr-only">
          Где сейчас по задаче {task.number}
        </label>
        <input
          id={`w-${task.number}`}
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          className="sv-control h-11 w-full min-w-0 px-3 text-small sm:h-10 sm:flex-1"
        />
        {changed ? (
          <Button size="sm" type="submit" className="h-11 sm:h-10">
            Сохранить
          </Button>
        ) : task.whereUpdatedAt === data.today ? (
          <span className="text-caption text-green-ink">Обновлено сегодня</span>
        ) : green && task.where ? (
          <Button size="sm" type="button" variant="secondary" className="h-11 sm:h-10" onClick={() => void actions.updateWhere(task, task.where)}>
            Подтвердить: всё так же
          </Button>
        ) : null}
      </form>
    </li>
  );
}
