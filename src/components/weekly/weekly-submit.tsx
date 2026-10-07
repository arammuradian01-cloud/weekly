"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Cloud, Lock, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { BLOCKS, entryTypeLabel, ENTRY_TYPES } from "@/domain/dictionaries";
import { formatShort } from "@/domain/dates";
import { isDueNextWeek, isDueThisWeek, isMine, isOverdue, isStale, overdueDays } from "@/lib/tasks/rules";
import type { PersonWeekly, Task, WeekInfo, WeeklyEntry } from "@/domain/types";
import { deleteEntryAction, reopenWeeklyAction, restoreEntryAction, saveHeadlineAction, submitWeeklyAction } from "@/app/(app)/weekly/actions";
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
import { EntryForm, isLocalId } from "./entry-form";
import { EntryItem } from "./entry-item";
import { PromoteControl } from "./promote";
import { PromiseStep } from "./promise-step";
import { FactSuggestions } from "./fact-suggestions";
import { ThanksField } from "./thanks-field";
import { taskFacts, type WeekFact } from "@/lib/weekly/facts";
import { greenOutside, greenOutsideText } from "@/lib/tasks/green-outside";
import { submittedText } from "./weekly-feed";

const HEADLINE_MAX = WEEKLY_LIMITS.headline;

function nowTime() {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date());
}

/**
 * Сдача weekly в четыре шага на одном экране (раздел 3 ТЗ, этап 22): итоги обещаний прошлой недели,
 * обновить свои задачи, написать главное и записи, проверить и сдать.
 * Черновик сохраняется на сервере сам: главная фраза через пару секунд после ввода, записи так же
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
}) {
  const { data, me, notify, notifyUndo } = usePrototype();
  const router = useRouter();
  const [weekly, setWeekly] = useState<PersonWeekly>(initialReport);
  const [entries, setEntries] = useState<WeeklyEntry[]>(initialEntries);
  const submitted = weekly.state === "submitted" || weekly.state === "late";

  const [headline, setHeadline] = useState(initialReport.headline);
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
      if (result.ok) {
        savedHeadline.current = value;
        setWeekly(result.value);
        setSavedAt(nowTime());
      } else notify(result.error, "error");
    } catch {
      notify("Нет связи с сервером: черновик не сохранился", "error");
    } finally {
      setSaving(false);
    }
  }, [week.key, notify]);

  // Главная фраза сохраняется сама через 2 секунды тишины и сразу, когда вкладку прячут или закрывают
  useEffect(() => {
    if (!canEdit || headline === savedHeadline.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveHeadline(), 2000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [headline, canEdit, saveHeadline]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void saveHeadline();
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [saveHeadline]);

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
    headline.length > HEADLINE_MAX ? "Главная фраза длиннее 150 знаков" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-10">
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
      <aside className="mb-6 lg:mb-0">
        <div className="lg:sticky lg:top-24">
          <WeeklyBadge state={weekly.state} />
          <p className="mt-3 text-small text-muted">
            Срок: {deadlineText}. {late ? <span className="font-medium text-danger-ink">Срок прошёл.</span> : `Осталось ${timeLeft}.`}
          </p>
          {expectedIn?.length ? <p className="mt-1 text-small text-muted">Сдаёте в команду: {expectedIn.map((t) => t.name).join(", ")}</p> : null}
          <p className="mt-2 inline-flex items-center gap-1.5 text-caption text-muted" aria-live="polite">
            <Cloud className="h-4 w-4" aria-hidden="true" />
            {!canEdit ? "Только просмотр" : saving ? "Сохраняем черновик" : savedAt ? `Черновик сохранён в ${savedAt}` : "Черновик сохраняется на сервере сам"}
          </p>
          <nav aria-label="Шаги сдачи" className="mt-6 hidden lg:block">
            <ol className="flex flex-col gap-1">
              {[
                { href: "#step-promises", label: "Обещания", note: `${promises.length + owed.length}` },
                { href: "#step-tasks", label: "Обновить задачи", note: `${tasks.length}` },
                { href: "#step-entries", label: "Главное и записи", note: `${entries.length}` },
                { href: "#step-submit", label: "Проверить и сдать", note: submitted ? "сдан" : "" },
              ].map((s, i) => (
                <li key={s.href}>
                  <a href={s.href} className="flex h-10 items-center gap-3 rounded-lg px-2 text-body text-ink hover:bg-surface">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-navy text-tiny font-semibold text-white">{i + 1}</span>
                    <span className="flex-1">{s.label}</span>
                    <span className="text-caption tabular-nums text-muted">{s.note}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-10">
        {!canEdit ? (
          <p className="inline-flex items-start gap-2 rounded-xl bg-surface px-5 py-4 text-body text-ink">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {week.closed ? `Неделя ${week.number} закрыта: записи правят только владелец и администраторы.` : "Этот weekly открыт только для просмотра."}
          </p>
        ) : null}
        {expectedIn && expectedIn.length === 0 && !submitted ? (
          <p className="rounded-xl bg-surface px-5 py-4 text-body text-ink">
            Weekly от вас сейчас не ждут: в вашей команде его сдают руководители. Достаточно обновлять задачи, а если за неделю было важное, его можно записать и сдать.
          </p>
        ) : null}
        <Step
          id="step-promises"
          n={1}
          title="Что вы обещали на прошлой неделе"
          description="Итог по каждому плану и одна фраза. Невыполненное можно перенести в план: через неделю оно снова будет здесь"
        >
          <PromiseStep week={week} promises={promises} setPromises={setPromises} tasks={owed} canEdit={canEdit} onCarried={upsert} />
        </Step>

        <Step
          id="step-tasks"
          n={2}
          title="Обновить задачи"
          description="Только то, что требует внимания: просроченные, срок на этой и следующей неделе, давно без обновлений, «В графике» без оснований"
        >
          {tasks.length === 0 ? (
            <p className="text-body text-muted">Срочных задач нет. Можно сразу писать главное за неделю.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
              {tasks.map((t) => (
                <TaskUpdateRow key={`${t.number}-${t.where}`} task={t} />
              ))}
            </ul>
          )}
        </Step>

        <Step id="step-entries" n={3} title="Главное за неделю" description="Одна фраза о главном и записи о событиях, обычно от 3 до 7">
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
          <div className="mt-4">
            <ThanksField week={week.key} initial={initialReport.thanks ?? ""} canEdit={canEdit} />
          </div>
          <div className="mt-6 flex flex-col gap-4">
            {canEdit ? <FactSuggestions week={week.key} facts={facts} setFacts={setFacts} onAdded={upsert} /> : null}
            <h3 className="text-lead font-semibold text-ink">
              Записи <span className="font-normal text-muted">{entries.length}</span>
            </h3>
            {entries.length === 0 && !draft ? <p className="text-body text-muted">Пока ни одной записи.</p> : null}
            <ul className="flex flex-col gap-3">
              {entries.filter((e) => !(draft && e.id === draftId)).map((e) =>
                editing === e.id ? (
                  <li key={e.id}>
                    <EntryForm initial={e} onSaved={onSaved} onAutosaved={upsert} onCancel={() => setEditing(null)} />
                  </li>
                ) : (
                  <li key={e.id} className="flex flex-col gap-3 rounded-xl px-4 py-3 ring-1 ring-line sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <EntryItem entry={e} discussion={false} />
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
                      <li key={e.id} className="flex flex-col gap-2 rounded-xl px-4 py-3 ring-1 ring-line">
                        <EntryItem entry={e} showAuthor discussion={false} />
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
        </Step>

        <Step id="step-submit" n={4} title="Проверить и сдать" description="После сдачи править можно до закрытия недели. Каждая правка попадает в журнал">
          {submitted ? (
            <div className="flex flex-col gap-3 rounded-xl bg-green-soft p-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="inline-flex items-start gap-2 text-lead text-green-ink">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{weekly.state === "late" ? "Сдан с опозданием" : "Weekly сдан"}</span>
                  {weekly.submittedAt ? `, ${submittedText(weekly.submittedAt).replace(/^сдан /, "")}` : ""}. Правки до закрытия недели разрешены.
                </span>
              </p>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link href={`/weekly?week=${week.key}`} className="inline-flex h-11 items-center rounded-lg px-4 text-body font-semibold text-navy hover:bg-white/60">
                  Открыть ленту недели
                </Link>
                {canEdit ? (
                  <Button variant="ghost" onClick={() => setConfirmReopen(true)} disabled={reopening}>
                    <Undo2 className="h-4 w-4" aria-hidden="true" />
                    {reopening ? "Возвращаю…" : "Вернуть в черновик"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-line">
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
                  {promiseSummary.pending ? (
                    <p className="text-small text-ink">
                      Без итога обещаний: {promiseSummary.pending}. В доле выполненных обещаний они считаются невыполненными, сдать weekly можно и так.
                    </p>
                  ) : null}
                </div>
                <Button onClick={() => void submit()} disabled={problems.length > 0 || submitting || !canEdit} className="sm:min-w-44">
                  {submitting ? "Сдаю…" : "Сдать weekly"}
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
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy text-body font-semibold text-white" aria-hidden="true">
          {n}
        </span>
        <div>
          <h2 id={`${id}-title`} className="text-title-lg font-semibold text-ink">
            <span className="sr-only">Шаг {n}. </span>
            {title}
          </h2>
          <p className="mt-0.5 text-small text-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Строка задачи в первом шаге: статус, состояние и «где сейчас» меняются без открытия карточки */
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
        <span className="flex shrink-0 items-center gap-2 text-caption">
          <span className={cn("tabular-nums", overdue ? "font-semibold text-danger-ink" : "text-muted")}>срок {formatShort(task.due)}</span>
          {overdue ? <OverdueNote days={overdueDays(task, data.today)} /> : null}
          {isStale(task, data.today) ? <StaleNote /> : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4">
        <StatusSelect task={task} />
        <StateSelect task={task} />
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
          className="h-11 w-full min-w-0 rounded-lg border border-line bg-white px-3 text-small text-ink focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25 sm:h-10 sm:flex-1"
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
