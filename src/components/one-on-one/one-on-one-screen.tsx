"use client";

// Встреча один на один (этап 28): повестка, итоги тем, задача из темы, заметки, завершение встречи, история и цифры
// лидера из аналитики. Данные приходят с сервера, после каждого действия страница обновляется.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, Lock, Pencil, Plus, RotateCcw, SquareCheck, Trash2, Users, X } from "lucide-react";
import type { PairView, TopicView } from "@/lib/one-on-one/service";
import { NOTES_MAX, OUTCOME_MAX, TOPIC_MAX, nextMeetingDate } from "@/lib/one-on-one/rules";
import { addTopicAction, closeTopicAction, completeMeetingAction, deleteTopicAction, editTopicAction, saveNotesAction, scheduleMeetingAction, topicToTaskAction } from "@/app/(app)/one-on-one/actions";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";
import { personOf } from "@/domain/people";
import { dictOptions } from "@/domain/dictionaries";
import { addDays, formatLong, formatShort } from "@/domain/dates";
import { hoursText } from "@/lib/analytics/rules";
import { WeeklyStrip, staleLabel, weeklySummary } from "@/components/analytics/analytics-screen";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";

function moment(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long" }).format(new Date(iso));
}

export function OneOnOneScreen({ view }: { view: PairView }) {
  const run = useRunWeekly();
  const other = view.role === "manager" ? view.report : view.manager;
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(view.planned?.date ?? nextMeetingDate(view.history[0]?.meeting.date ?? addDays(view.today, -7), view.today));
  const [finish, setFinish] = useState(false);
  const [nextDate, setNextDate] = useState(view.planned ? nextMeetingDate(view.planned.date, view.today) : addDays(view.today, 7));
  const [taskFor, setTaskFor] = useState<TopicView | null>(null);

  // Дата в поле следует за сервером, пока её не трогали руками
  const dateTouched = useRef(false);
  useEffect(() => {
    if (!dateTouched.current && view.planned) setDate(view.planned.date);
  }, [view.planned]);

  const add = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    const r = await run(() => addTopicAction(other.slug, topic), "Тема добавлена в повестку");
    setBusy(false);
    if (r) setTopic("");
  };

  const schedule = async () => {
    setBusy(true);
    const r = await run(() => scheduleMeetingAction(other.slug, date), view.planned ? `Встреча перенесена на ${formatShort(date)}` : `Встреча назначена на ${formatShort(date)}`);
    setBusy(false);
    if (r) dateTouched.current = false;
  };

  const complete = async (next: string | null) => {
    if (!view.planned) return;
    setBusy(true);
    const r = await run(() => completeMeetingAction(view.planned!.id, next), next ? `Встреча завершена, следующая ${formatShort(next)}` : "Встреча завершена");
    setBusy(false);
    if (r) setFinish(false);
  };

  const hint =
    view.role === "report"
      ? "Повестку ставите вы: что обсудить, где нужна помощь руководителя. Руководитель тоже может добавить тему"
      : `Повестку ставит ${view.report.fullName}. Свои темы можно добавить тоже`;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="oo-meeting" className="sv-card sv-card--soft flex flex-col gap-3 px-5 py-4">
          <h2 id="oo-meeting" className="text-title-sm font-semibold text-ink">
            {view.planned ? `Встреча ${formatLong(view.planned.date)}` : "Встреча не назначена"}
          </h2>
          <div className="flex flex-wrap items-end gap-3">
            <TextInput
              type="date"
              label={view.planned ? "Перенести на" : "Дата встречи"}
              id="oo-date"
              className="w-[200px]"
              value={date}
              min={view.today}
              onChange={(e) => {
                dateTouched.current = true;
                setDate(e.target.value);
              }}
            />
            <Button variant="secondary" onClick={schedule} disabled={busy || !date || (view.planned?.date === date)}>
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {view.planned ? "Перенести" : "Назначить"}
            </Button>
            {view.planned ? (
              <Button variant="dark" onClick={() => setFinish(true)} disabled={busy}>
                <Check className="h-4 w-4" aria-hidden="true" />
                Завершить встречу
              </Button>
            ) : null}
          </div>
          {!view.planned ? <p className="text-small text-muted">Итоги тем и заметки записываются к встрече: сначала назначьте её.</p> : null}
        </section>

        <section aria-labelledby="oo-agenda" className="flex flex-col gap-3">
          <div>
            <h2 id="oo-agenda" className="text-title font-semibold text-ink">
              Повестка <span className="font-normal text-muted">{view.open.length}</span>
            </h2>
            <p className="mt-1 text-small text-muted">{hint}. Незакрытые темы переходят на следующую встречу сами.</p>
          </div>
          <div className="sv-card sv-card--soft flex flex-col gap-3 px-5 py-4">
            <TextArea label="Новая тема" id="oo-topic" rows={2} maxLength={TOPIC_MAX} value={topic} onChange={(e) => setTopic(e.target.value)} hint="Одной-двумя фразами: что обсудить или где нужна помощь" />
            <div>
              <Button onClick={add} disabled={busy || !topic.trim()}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить тему
              </Button>
            </div>
          </div>
          {view.open.length ? (
            <ul className="flex flex-col gap-3">
              {view.open.map((t) => (
                <TopicCard key={t.id} topic={t} canClose={!!view.planned} onTask={() => setTaskFor(t)} />
              ))}
            </ul>
          ) : (
            <p className="sv-card sv-card--soft px-5 py-4 text-body text-muted">В повестке пусто. Добавьте тему, и {other.fullName} увидит её в «Мне».</p>
          )}
        </section>

        {view.planned ? <Notes key={view.planned.id} meetingId={view.planned.id} notes={view.planned.notes} myNote={view.planned.myNote} updatedAt={view.planned.updatedAt} /> : null}

        <section aria-labelledby="oo-history" className="flex flex-col gap-3">
          <h2 id="oo-history" className="text-title font-semibold text-ink">
            Прошлые встречи <span className="font-normal text-muted">{view.history.length}</span>
          </h2>
          {view.history.length ? (
            <ul className="flex flex-col gap-3">
              {view.history.map(({ meeting, topics }) => (
                <li key={meeting.id} className="sv-card sv-card--soft flex flex-col gap-3 px-5 py-4">
                  <p className="text-body font-semibold text-ink">{formatLong(meeting.date)}</p>
                  {topics.length ? (
                    <ul className="flex flex-col gap-2">
                      {topics.map((t) => (
                        <li key={t.id} className="flex flex-col gap-1 text-small">
                          <p className="text-ink">
                            <span className={cn("font-medium", t.status === "dropped" && "text-muted line-through")}>{t.text}</span>
                            <span className="text-muted">{t.status === "dropped" ? ", сняли" : ", обсудили"}</span>
                          </p>
                          {t.outcome ? <p className="whitespace-pre-wrap text-ink">{t.outcome}</p> : null}
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            {t.task ? (
                              <Link href={`/tasks/${t.task.number}`} className="text-link hover:underline">
                                Задача {t.task.number}
                              </Link>
                            ) : null}
                            <ReopenButton topic={t} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-small text-muted">Темы не закрывали.</p>
                  )}
                  {meeting.notes ? (
                    <div>
                      <p className="text-caption font-medium text-muted">Общие заметки</p>
                      <p className="whitespace-pre-wrap text-small text-ink">{meeting.notes}</p>
                    </div>
                  ) : null}
                  {meeting.myNote ? (
                    <div>
                      <p className="inline-flex items-center gap-1 text-caption font-medium text-muted">
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        Мои личные заметки
                      </p>
                      <p className="whitespace-pre-wrap text-small text-ink">{meeting.myNote}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted">Завершённых встреч пока нет.</p>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4" aria-label="Цифры и правила">
        <CardSummary view={view} />
        <p className="flex gap-2 text-caption text-muted">
          <Users className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Встречу видите только вы и {other.fullName}. Режим управления её не открывает, в журнал содержимое не попадает. Задача из темы становится обычной задачей и видна по правилам задач.
        </p>
      </aside>

      <Modal open={finish} onOpenChange={setFinish} title="Завершить встречу?" description="Обсуждённые темы останутся в истории этой встречи. Открытые темы перейдут на следующую.">
        <div className="flex flex-col gap-4">
          <TextInput type="date" label="Следующая встреча" id="oo-next" className="w-[200px]" value={nextDate} min={view.today} onChange={(e) => setNextDate(e.target.value)} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => void complete(null)} disabled={busy}>
              Завершить без следующей
            </Button>
            <Button variant="dark" onClick={() => void complete(nextDate)} disabled={busy || !nextDate}>
              Завершить и назначить
            </Button>
          </div>
        </div>
      </Modal>

      {taskFor ? <TaskDialog topic={taskFor} view={view} onClose={() => setTaskFor(null)} /> : null}
    </div>
  );
}

function TopicCard({ topic: t, canClose, onTask }: { topic: TopicView; canClose: boolean; onTask: () => void }) {
  const run = useRunWeekly();
  const [mode, setMode] = useState<"view" | "edit" | "outcome">("view");
  const [text, setText] = useState(t.text);
  const [outcome, setOutcome] = useState(t.outcome ?? "");
  const [busy, setBusy] = useState(false);
  const act = async <T,>(fn: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>, ok: string) => {
    setBusy(true);
    const r = await run(fn, ok);
    setBusy(false);
    return r;
  };
  return (
    <li className="sv-card sv-card--soft flex flex-col gap-2 px-5 py-4" aria-label={`Тема: ${t.text}`}>
      {mode === "edit" ? (
        <div className="flex flex-col gap-2">
          <TextArea label="Тема" id={`oo-edit-${t.id}`} rows={2} maxLength={TOPIC_MAX} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => (await act(() => editTopicAction(t.id, text), "Тема изменена")) && setMode("view")} disabled={busy || !text.trim()}>
              Сохранить
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode("view")}>
              Отмена
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-body text-ink">{t.text}</p>
      )}
      <p className="text-caption text-muted">
        {t.author ? (t.mine ? "Ваша тема" : t.author.fullName) : "Автор выключен в ресурсе"}, {moment(t.createdAt)}
        {t.task ? (
          <>
            {", "}
            <Link href={`/tasks/${t.task.number}`} className="text-link hover:underline">
              задача {t.task.number}
            </Link>
          </>
        ) : null}
      </p>
      {mode === "outcome" ? (
        <div className="flex flex-col gap-2">
          <TextArea label="О чём договорились" id={`oo-out-${t.id}`} rows={3} maxLength={OUTCOME_MAX} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => (await act(() => closeTopicAction(t.id, "discussed", outcome), "Тема обсуждена")) && setMode("view")} disabled={busy}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Сохранить итог
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode("view")}>
              Отмена
            </Button>
          </div>
        </div>
      ) : mode === "view" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMode("outcome")} disabled={!canClose} title={canClose ? undefined : "Сначала назначьте встречу"}>
            <Check className="h-4 w-4" aria-hidden="true" />
            Обсудили
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void act(() => closeTopicAction(t.id, "dropped"), "Тема снята с повестки")} disabled={!canClose || busy}>
            <X className="h-4 w-4" aria-hidden="true" />
            Снять
          </Button>
          {!t.task ? (
            <Button size="sm" variant="secondary" onClick={onTask}>
              <SquareCheck className="h-4 w-4" aria-hidden="true" />
              Поставить задачу
            </Button>
          ) : null}
          {t.mine ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setMode("edit")} aria-label={`Изменить тему: ${t.text}`}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Изменить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void act(() => deleteTopicAction(t.id), "Тема убрана")} disabled={busy} aria-label={`Убрать тему: ${t.text}`}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Убрать
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ReopenButton({ topic }: { topic: TopicView }) {
  const run = useRunWeekly();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-link hover:underline disabled:opacity-60"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await run(() => closeTopicAction(topic.id, "open"), "Тема вернулась в повестку");
        setBusy(false);
      }}
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
      Вернуть в повестку
    </button>
  );
}

/**
 * Общие заметки (видят оба) и личные (видит только автор). Свежая версия общих заметок с сервера берётся, пока здесь
 * не правили; запоздавшее обновление страницы (старше того, что уже знаем) не затирает только что сохранённое
 */
function Notes({ meetingId, notes, myNote, updatedAt }: { meetingId: string; notes: string; myNote: string; updatedAt: string }) {
  const run = useRunWeekly();
  const [shared, setShared] = useState(notes);
  const [mine, setMine] = useState(myNote);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useRef({ notes, at: updatedAt });
  // Правки во время сохранения не помечаются сохранёнными и не затираются ответом сервера
  const rev = useRef(0);
  useEffect(() => {
    if (!dirty && updatedAt > base.current.at) {
      base.current = { notes, at: updatedAt };
      setShared(notes);
    }
  }, [notes, updatedAt, dirty]);
  const save = async () => {
    const started = rev.current;
    setBusy(true);
    const r = await run(() => saveNotesAction(meetingId, { shared, mine, base: base.current.notes }), "Заметки сохранены");
    setBusy(false);
    if (r) {
      base.current = { notes: r.notes, at: r.updatedAt > base.current.at ? r.updatedAt : base.current.at };
      if (rev.current === started) {
        setShared(r.notes);
        setMine(r.myNote);
        setDirty(false);
      }
    }
  };
  return (
    <section aria-labelledby="oo-notes" className="sv-card sv-card--soft flex flex-col gap-3 px-5 py-4">
      <h2 id="oo-notes" className="text-title-sm font-semibold text-ink">
        Заметки встречи
      </h2>
      <TextArea
        label="Общие заметки"
        id="oo-shared"
        rows={4}
        maxLength={NOTES_MAX}
        value={shared}
        onChange={(e) => {
          setShared(e.target.value);
          rev.current += 1;
          setDirty(true);
        }}
        hint="Видите вы оба"
      />
      <TextArea
        label="Мои личные заметки"
        id="oo-mine"
        rows={3}
        maxLength={NOTES_MAX}
        value={mine}
        onChange={(e) => {
          setMine(e.target.value);
          rev.current += 1;
          setDirty(true);
        }}
        hint="Видите только вы"
      />
      <div>
        <Button onClick={save} disabled={busy || !dirty}>
          Сохранить заметки
        </Button>
      </div>
    </section>
  );
}

function TaskDialog({ topic, view, onClose }: { topic: TopicView; view: PairView; onClose: () => void }) {
  const run = useRunWeekly();
  const { data } = usePrototype();
  const [title, setTitle] = useState(topic.text.slice(0, 120));
  const [outcome, setOutcome] = useState(topic.outcome ?? "");
  const [owner, setOwner] = useState<string>(view.report.slug);
  const [direction, setDirection] = useState<string>(personOf(view.report.slug).direction);
  const [due, setDue] = useState(addDays(data.today, 7));
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await run(() => topicToTaskAction(topic.id, { title, outcome, owner, direction, due }), "Задача поставлена");
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Поставить задачу из темы" description="Задача станет обычной задачей и будет видна по правилам задач, сама тема и заметки останутся между вами.">
      <div className="flex flex-col gap-3">
        <TextInput label="Задача" id="oo-task-title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextArea label="Что нужно сделать" id="oo-task-outcome" rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} hint="По чему понять, что задача сделана" />
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Ответственный"
            id="oo-task-owner"
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setDirection(personOf(e.target.value as typeof view.report.slug).direction);
            }}
            options={[
              { value: view.report.slug, label: view.report.fullName },
              { value: view.manager.slug, label: view.manager.fullName },
            ]}
          />
          <TextInput type="date" label="Срок" id="oo-task-due" value={due} min={data.today} onChange={(e) => setDue(e.target.value)} />
        </div>
        <SelectField label="Направление" id="oo-task-dir" value={direction} onChange={(e) => setDirection(e.target.value)} options={dictOptions("DIRECTION", direction)} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim() || !outcome.trim()}>
            Поставить задачу
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Цифры человека: та же карточка, что у руководителя в аналитике. У специалиста карточки нет */
function CardSummary({ view }: { view: PairView }) {
  const c = view.card;
  if (!c) {
    return (
      <section aria-labelledby="oo-card" className="sv-card sv-card--soft px-5 py-4">
        <h2 id="oo-card" className="text-title-sm font-semibold text-ink">
          Цифры
        </h2>
        <p className="mt-1 text-small text-muted">Карточка с цифрами есть у руководителей команд: weekly, задачи, просьбы и цели их команды.</p>
      </section>
    );
  }
  const items: [string, string | number][] = [
    ["В работе", c.now.inWork],
    ["Просрочено", c.now.overdue],
    [staleLabel(view.staleDays), c.now.stale],
    ["Закрыто за 8 недель", c.closed],
    ["Переносов срока за 8 недель", c.transfers],
    ["Просьбы ждут ответа", c.requests.waiting],
    ["Медиана ответа", hoursText(c.requests.medianHours)],
    ["Цели квартала", c.goals.total ? `${c.goals.total}, в риске ${c.goals.atRisk}` : "нет"],
  ];
  return (
    <section aria-labelledby="oo-card" className="sv-card sv-card--soft flex flex-col gap-3 px-5 py-4">
      <div>
        <h2 id="oo-card" className="text-title-sm font-semibold text-ink">
          Цифры для разговора
        </h2>
        <p className="text-caption text-muted">{c.teams.map((t) => t.name).join(", ")}: та же карточка, что в аналитике. Для разговора, не для рейтинга.</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
        <WeeklyStrip cells={c.weekly.cells} />
        <span className="text-ink">{weeklySummary(c)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-small">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="font-semibold tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      {view.role === "manager" && c.teams[0] ? (
        <Link href={`/analytics?team=${c.teams[0].id}`} className="text-small font-medium text-link hover:underline">
          Аналитика команды
        </Link>
      ) : null}
    </section>
  );
}
