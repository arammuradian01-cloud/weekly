"use client";

// Встреча 2.0 (этап 23, модуль М7): повестка, живой режим, решения, протокол. Ведущий листает, экраны участников идут
// за ним: текущий пункт хранится в базе, страница обновляется живыми обновлениями. Два вида экрана: для ноутбуков
// участников и для проектора (крупнее, без лишнего).

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardCopy, Link2, ListPlus, Maximize2, Pause, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName, personOf } from "@/domain/people";
import { formatLong, formatShort } from "@/domain/dates";
import type { PersonSlug, WeekView, WeeklyEntry } from "@/domain/types";
import { AGENDA_BLOCKS, AGENDA_KIND_LABELS, blockOf, timerText, type AgendaItemView, type DecisionView, type MeetingView } from "@/domain/meeting";
import {
  addAgendaItemAction,
  addDecisionAction,
  buildAgendaAction,
  closeMeetingAction,
  goToItemAction,
  removeAgendaItemAction,
  reopenMeetingAction,
  setItemDiscussedAction,
  setTimerAction,
  startMeetingAction,
} from "@/app/(app)/meeting/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { TextArea, TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";
import { StatusBadge, WeeklyBadge } from "@/components/ui/task-badges";
import { StateSelect, StatusSelect } from "@/components/tasks/task-fields";
import { useTaskActions } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/task-drawer";
import { openNewTask } from "@/components/prototype/new-task";
import { PersonSelect } from "@/components/requests/request-parts";
import { EntryItem } from "@/components/weekly/entry-item";
import { cn } from "@/lib/cn";
import { NotionIntake } from "./notion-intake";

const DECISIONS = "decisions";

type Props = { view: WeekView; meeting: MeetingView | null; canLead: boolean; team: { id: string; name: string }; /** Цифры недели из недельного отчёта (этап 24): в шапке встречи, если выбраны */ numbers?: React.ReactNode };

export function MeetingLive({ view, meeting: initial, canLead, team, numbers }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const projector = params.get("screen") === "projector";
  const { notify, me } = usePrototype();
  const [meeting, setMeeting] = useState<MeetingView | null>(initial);
  // Свежая версия с сервера после живого обновления
  useEffect(() => setMeeting(initial), [initial]);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ ok: true; value: MeetingView } | { ok: false; error: string }>, done?: string) => {
    if (busy) return false;
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) {
        notify(r.error, "error");
        return false;
      }
      setMeeting(r.value);
      if (done) notify(done);
      router.refresh();
      return true;
    } catch {
      notify("Нет связи с сервером", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!meeting) return null;

  return <LiveBody view={view} meeting={meeting} canLead={meeting.canLead || canLead} projector={projector} busy={busy} run={run} me={me.slug} team={team} numbers={numbers} />;
}

function Header({ view, team, meeting, projector, children }: { view: WeekView; team: { id: string; name: string }; meeting: MeetingView | null; projector: boolean; children?: React.ReactNode }) {
  const status = meeting?.status;
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className={cn("font-semibold leading-tight text-ink", projector ? "text-display" : "text-page")}>
          Встреча {team.name}
          {status ? (
            <Badge tone={status === "live" ? "green" : status === "done" ? "gray" : "blue"} className="ml-3 align-middle">
              {status === "live" ? "Идёт" : status === "done" ? "Закрыта" : "Запланирована"}
            </Badge>
          ) : null}
        </h1>
        <p className="mt-1 text-body text-muted">
          Неделя {view.week.number}, {formatLong(meeting?.date ?? view.week.meetingDate)}
          {meeting?.time ? `, ${meeting.time}` : ""}
          {meeting?.leader ? `. Ведёт ${compactName(meeting.leader)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {children}
        <Button size="sm" variant="secondary" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
          На весь экран
        </Button>
        <Link
          href={`/weekly/meeting?week=${view.week.key}${projector ? "" : "&screen=projector"}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink ring-1 ring-line hover:bg-field"
        >
          {projector ? "Для ноутбука" : "Для проектора"}
        </Link>
        <Link href={`/weekly?week=${view.week.key}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink hover:bg-field">
          <X className="h-4 w-4" aria-hidden="true" />
          Выйти
        </Link>
      </div>
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: true; value: MeetingView } | { ok: false; error: string }>, done?: string) => Promise<boolean>;

function LiveBody({ view, meeting, canLead, projector, busy, run, me, team, numbers }: { view: WeekView; meeting: MeetingView; canLead: boolean; projector: boolean; busy: boolean; run: Run; me: PersonSlug; team: { id: string; name: string }; numbers?: React.ReactNode }) {
  const steps = useMemo(() => [...meeting.items.map((i) => i.id), DECISIONS], [meeting.items]);
  const leading = canLead && meeting.status === "live" && meeting.leader === me;
  // Участник идёт за ведущим, пока сам не перелистнёт. Ведущий всегда на своём пункте
  const [following, setFollowing] = useState(true);
  const [local, setLocal] = useState<string>(meeting.currentItemId ?? steps[0]!);
  const serverCurrent = meeting.status === "live" ? (meeting.currentItemId ?? DECISIONS) : null;
  const current = leading || (following && serverCurrent) ? (serverCurrent ?? local) : local;
  const index = Math.max(0, steps.indexOf(current));
  const item = meeting.items.find((i) => i.id === current) ?? null;

  // Таймер пункта: с момента, когда он стал текущим на этом экране
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const lastCurrent = useRef(current);
  useEffect(() => {
    if (lastCurrent.current !== current) {
      lastCurrent.current = current;
      setSince(Date.now());
    }
  }, [current]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.floor((now - since) / 1000);

  const go = (next: string) => {
    if (leading) void run(() => goToItemAction(meeting.id, next === DECISIONS ? DECISIONS : next));
    else {
      setFollowing(false);
      setLocal(next);
    }
  };
  const step = (delta: number) => {
    const i = Math.max(0, Math.min(steps.length - 1, index + delta));
    go(steps[i]!);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog']")) return;
      if (busy) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, steps.join("|"), leading, busy]);

  const [adding, setAdding] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const discussedCount = meeting.items.filter((i) => i.discussed).length;

  return (
    <div className={cn("flex min-h-[70vh] flex-col gap-6", projector && "meeting-projector")} data-scale={projector ? "projector" : undefined}>
      {numbers}
      <Header view={view} team={team} meeting={meeting} projector={projector}>
        {canLead && meeting.status !== "done" ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => void run(() => buildAgendaAction(team.id, view.week.key), "Повестка обновлена")} disabled={busy}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Обновить повестку
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={busy}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Пункт
            </Button>
            <NotionIntake meeting={meeting} onDone={(m) => void run(async () => ({ ok: true as const, value: m }))} />
          </>
        ) : null}
        {canLead && meeting.status === "planned" ? (
          <Button size="sm" onClick={() => void run(() => startMeetingAction(meeting.id), "Встреча началась")} disabled={busy}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Начать встречу
          </Button>
        ) : null}
        {canLead && meeting.status === "live" ? (
          <Button size="sm" onClick={() => setConfirmClose(true)} disabled={busy}>
            <Pause className="h-4 w-4" aria-hidden="true" />
            Закрыть встречу
          </Button>
        ) : null}
        {canLead && meeting.status === "done" ? (
          <Button size="sm" variant="secondary" onClick={() => void run(() => reopenMeetingAction(meeting.id), "Встреча открыта снова")} disabled={busy}>
            Открыть снова
          </Button>
        ) : null}
      </Header>

      {meeting.status === "live" && !leading ? (
        <p className="flex flex-wrap items-center gap-3 sv-card sv-card--soft px-4 py-2 text-small text-ink">
          {following ? `Экран идёт за ведущим${meeting.leader ? `: ${compactName(meeting.leader)}` : ""}` : "Вы смотрите свой пункт"}
          <Button size="sm" variant="ghost" onClick={() => setFollowing((f) => !f)}>
            {following ? "Смотреть самому" : "Снова за ведущим"}
          </Button>
          {canLead ? (
            <Button size="sm" variant="ghost" onClick={() => void run(() => goToItemAction(meeting.id, current === DECISIONS ? DECISIONS : current), "Теперь ведёте вы")} disabled={busy}>
              Вести самому
            </Button>
          ) : null}
        </p>
      ) : null}

      {meeting.status === "done" ? (
        <Protocol meeting={meeting} />
      ) : (
        <div className={cn("flex flex-col gap-6", projector ? "" : "lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-8")}>
          {!projector ? (
            <>
              {/* На телефоне повестка свёрнута, сначала текущий пункт */}
              <details className="sv-card sv-card--soft lg:hidden">
                <summary className="cursor-pointer px-4 py-3 text-body font-medium text-ink">
                  Повестка: {meeting.items.length} пунктов, обсуждено {discussedCount}
                </summary>
                <div className="px-4 pb-4">
                  <Agenda meeting={meeting} current={current} onSelect={go} canLead={canLead} busy={busy} run={run} discussed={discussedCount} />
                </div>
              </details>
              <div className="hidden lg:block">
                <Agenda meeting={meeting} current={current} onSelect={go} canLead={canLead} busy={busy} run={run} discussed={discussedCount} />
              </div>
            </>
          ) : null}
          <section className="min-w-0">
            {current === DECISIONS ? (
              <DecisionsStep meeting={meeting} canLead={canLead} busy={busy} run={run} projector={projector} />
            ) : item ? (
              <ItemBody view={view} meeting={meeting} item={item} canLead={canLead} busy={busy} run={run} projector={projector} elapsed={elapsed} />
            ) : (
              <p className="text-body text-muted">Пункта больше нет: он убран из повестки.</p>
            )}
          </section>
        </div>
      )}

      {meeting.status !== "done" ? (
        <div className="sticky bottom-20 mt-auto flex items-center justify-between gap-3 border-t border-line bg-surface/95 py-3 lg:bottom-0">
          <Button variant="secondary" onClick={() => step(-1)} disabled={index === 0}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Назад
          </Button>
          <span className="text-body tabular-nums text-muted">
            {index + 1} из {steps.length}
            {leading ? ". Вы ведёте" : ""}
          </span>
          <Button onClick={() => step(1)} disabled={index === steps.length - 1}>
            Дальше
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ) : null}

      <AddItemModal open={adding} onClose={() => setAdding(false)} meeting={meeting} run={run} />
      <Modal open={confirmClose} onOpenChange={setConfirmClose} title="Закрыть встречу?" description={`Обсуждено ${discussedCount} из ${meeting.items.length} пунктов, решений: ${meeting.decisions.length}. Протокол соберётся сам и уйдёт участникам.`}>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirmClose(false)}>
            Продолжить встречу
          </Button>
          <Button
            onClick={() => {
              setConfirmClose(false);
              void run(() => closeMeetingAction(meeting.id), "Встреча закрыта, протокол готов");
            }}
          >
            Закрыть и отправить протокол
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Agenda({ meeting, current, onSelect, canLead, busy, run, discussed }: { meeting: MeetingView; current: string; onSelect: (id: string) => void; canLead: boolean; busy: boolean; run: Run; discussed: number }) {
  const blocks = AGENDA_BLOCKS.map((b) => ({ ...b, items: meeting.items.filter((i) => blockOf(i.kind) === b.code) })).filter((b) => b.items.length);
  return (
    <nav aria-label="Повестка" className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
      <p className="text-caption text-muted">
        Повестка: {meeting.items.length} пунктов, обсуждено {discussed}
      </p>
      {blocks.map((b) => (
        <div key={b.code}>
          <p className="mb-1 text-caption font-semibold text-muted">{b.label}</p>
          <ol className="flex flex-col gap-1">
            {b.items.map((i) => (
              <li key={i.id} className="group flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(i.id)}
                  aria-current={i.id === current ? "step" : undefined}
                  className={cn(
                    "flex min-h-10 flex-1 items-start gap-2 rounded-lg px-3 py-2 text-left text-small",
                    i.id === current ? "bg-navy font-semibold text-white" : "text-ink hover:bg-field",
                    i.discussed && i.id !== current && "text-muted line-through decoration-line",
                  )}
                >
                  {i.discussed ? <Check className="mt-0.5 h-4 w-4 shrink-0" aria-label="обсуждено" /> : <span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full ring-1 ring-current opacity-40" aria-hidden="true" />}
                  <span className="min-w-0 break-words">{i.kind === "person" && i.person ? personOf(i.person).fullName : i.title}</span>
                </button>
                {canLead && meeting.status !== "done" && !i.decisions.length ? (
                  <button
                    type="button"
                    onClick={() => void run(() => removeAgendaItemAction(meeting.id, i.id))}
                    disabled={busy}
                    aria-label={`Убрать пункт: ${i.title}`}
                    className="mt-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:bg-field hover:text-danger-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onSelect(DECISIONS)}
        aria-current={current === DECISIONS ? "step" : undefined}
        className={cn("flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-left text-small font-semibold", current === DECISIONS ? "bg-navy text-white" : "text-ink hover:bg-field")}
      >
        Решения {meeting.decisions.length ? <span className="font-normal opacity-70">{meeting.decisions.length}</span> : null}
      </button>
    </nav>
  );
}

function ItemBody({ view, meeting, item, canLead, busy, run, projector, elapsed }: { view: WeekView; meeting: MeetingView; item: AgendaItemView; canLead: boolean; busy: boolean; run: Run; projector: boolean; elapsed: number }) {
  const { data } = usePrototype();
  const { open } = useOpenTask();
  const actions = useTaskActions();
  const task = item.task ? data.tasks.find((t) => t.number === item.task!.number) : undefined;
  const h1 = cn("font-semibold leading-tight text-ink", projector ? "text-display" : "text-display-sm");
  const overTime = item.kind === "person" && elapsed >= meeting.timerMinutes * 60;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="flex flex-wrap items-center gap-2 text-caption text-muted">
          <span>{AGENDA_KIND_LABELS[item.kind]}</span>
          {item.discussed ? <Badge tone="green">Обсуждено</Badge> : null}
          {item.kind === "person" ? (
            <span className={cn("tabular-nums", overTime ? "font-semibold text-danger-ink" : "")} aria-label="Таймер пункта">
              {timerText(elapsed)} из {meeting.timerMinutes}:00
            </span>
          ) : null}
        </p>
        {item.kind === "person" && item.person ? (
          <PersonStep view={view} slug={item.person} projector={projector} />
        ) : (
          <h2 className={cn(h1, "mt-1 max-w-[40ch]")}>{item.title}</h2>
        )}
        {item.note ? <p className={cn("mt-2 max-w-[70ch] text-ink", projector ? "text-headline" : "text-body")}>{item.note}</p> : null}
      </div>

      {task ? (
        <div className="rounded-xl px-4 py-3 ring-1 ring-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <button type="button" onClick={() => open(task.number)} className="text-left text-body font-medium text-ink hover:text-blue-700 hover:underline">
              <span className="mr-1.5 tabular-nums text-muted">{task.number}</span>
              {task.title}
            </button>
            <span className="text-caption tabular-nums text-muted">
              срок {formatShort(task.due)}
              {task.owner ? `, ${task.owner === "all" ? "все лидеры" : compactName(task.owner)}` : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <StatusSelect task={task} />
            <StateSelect task={task} />
            <Button size="sm" variant="ghost" onClick={() => actions.transfer(task)}>
              Перенести срок
            </Button>
          </div>
          {task.where ? <p className="mt-2 text-small text-muted">Где сейчас: {task.where}</p> : null}
        </div>
      ) : item.task ? (
        <p className="text-small text-muted">
          Задача {item.task.number}: {item.task.title}. <StatusBadge status={item.task.status as never} className="align-middle" />{" "}
          <Link href={`/tasks/${item.task.number}`} className="font-medium text-blue-700 hover:underline">
            Открыть
          </Link>
        </p>
      ) : null}

      {item.request ? (
        <p className="text-body text-ink">
          Просьба {item.request.number}: {item.request.text}. {compactName(item.request.author)} просит {compactName(item.request.addressee)}.{" "}
          <Link href={`/requests/${item.request.number}`} className="font-medium text-blue-700 hover:underline">
            Открыть просьбу
          </Link>
        </p>
      ) : null}

      {item.entry ? <EntryBlock view={view} entryId={item.entry.id} projector={projector} /> : null}

      <DecisionList decisions={item.decisions} compact />

      {canLead && meeting.status !== "done" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={item.discussed ? "secondary" : "primary"} onClick={() => void run(() => setItemDiscussedAction(meeting.id, item.id, !item.discussed))} disabled={busy}>
            <Check className="h-4 w-4" aria-hidden="true" />
            {item.discussed ? "Снять «обсуждено»" : "Обсуждено"}
          </Button>
          <DecisionButton key={item.id} meeting={meeting} itemId={item.id} run={run} busy={busy} taskNumber={item.task?.number} />
          <Button size="sm" variant="secondary" onClick={() => openNewTask({ source: "meeting", sourceNote: `Встреча, неделя ${meeting.weekNumber}`, title: item.kind === "manual" ? item.title.replace(/\?$/, "").slice(0, 120) : "" })}>
            <ListPlus className="h-4 w-4" aria-hidden="true" />
            Поставить задачу
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PersonStep({ view, slug, projector }: { view: WeekView; slug: PersonSlug; projector: boolean }) {
  const weekly = view.reports.find((w) => w.author === slug);
  const own = view.entries.filter((e) => e.author === slug && (!view.authors || view.authors.includes(slug)));
  const raised = view.entries.filter((e) => e.author !== slug && e.promoted?.some((x) => x.by === slug));
  const sort = (a: WeeklyEntry, b: WeeklyEntry) => Number(b.type === "risk" || !!b.help) - Number(a.type === "risk" || !!a.help);
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h2 className={cn("font-semibold leading-tight text-ink", projector ? "text-display" : "text-display-sm")}>{personOf(slug).fullName}</h2>
        <WeeklyBadge state={weekly?.state ?? "not-started"} />
      </div>
      {weekly?.headline ? <p className={cn("mt-3 max-w-[60ch] leading-snug text-ink", projector ? "text-display-sm" : "text-headline")}>{weekly.headline}</p> : null}
      {weekly?.thanks ? <p className="mt-2 text-body text-muted">{weekly.thanks}</p> : null}
      <ul className="mt-6 flex flex-col gap-6">
        {[...own].sort(sort).map((e) => (
          <li key={e.id} className="max-w-[72ch]">
            <EntryItem entry={e} large />
          </li>
        ))}
        {raised.map((e) => (
          <li key={e.id} className="max-w-[72ch]">
            <EntryItem entry={e} large showAuthor />
          </li>
        ))}
      </ul>
      {!own.length && !raised.length ? <p className="mt-6 text-title text-muted">Записей за неделю нет.</p> : null}
    </>
  );
}

function EntryBlock({ view, entryId, projector }: { view: WeekView; entryId: string; projector: boolean }) {
  const entry = view.entries.find((e) => e.id === entryId);
  if (!entry) {
    return (
      <Link href={`/weekly/entry/${entryId}`} className="text-body font-medium text-blue-700 hover:underline">
        Открыть запись weekly
      </Link>
    );
  }
  return (
    <div className="max-w-[72ch]">
      <EntryItem entry={entry} large={projector} showAuthor />
    </div>
  );
}

function DecisionList({ decisions, compact }: { decisions: DecisionView[]; compact?: boolean }) {
  if (!decisions.length) return null;
  return (
    <ul className={cn("flex flex-col divide-y divide-line sv-card sv-card--soft", compact && "text-small")}>
      {decisions.map((d) => (
        <li key={d.id} className="px-4 py-3">
          <p className={cn("text-ink", d.status === "cancelled" && "text-muted line-through")}>{d.text}</p>
          <p className="mt-0.5 text-caption text-muted">
            {d.owner ? `Владелец: ${compactName(d.owner)}. ` : ""}
            {d.tasks.length ? `Задачи: ${d.tasks.map((t) => t.number).join(", ")}. ` : ""}
            {d.status === "cancelled" ? `Отменено: ${d.cancelReason ?? ""}` : "В силе"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function DecisionButton({ meeting, itemId, run, busy, taskNumber }: { meeting: MeetingView; itemId: string | null; run: Run; busy: boolean; taskNumber?: number }) {
  const { me } = usePrototype();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [owner, setOwner] = useState<string>("");
  const [tasks, setTasks] = useState(taskNumber ? String(taskNumber) : "");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError("Сформулируйте решение одной фразой");
    const numbers = tasks
      .split(/[\s,;]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
    const ok = await run(() => addDecisionAction(meeting.id, { text, owner: owner || null, taskNumbers: numbers, itemId }), "Решение записано");
    if (ok) {
      setOpen(false);
      setText("");
      setOwner("");
      setError(null);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setTasks(taskNumber ? String(taskNumber) : "");
          setError(null);
          setOpen(true);
        }}
        disabled={busy}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Записать решение
      </Button>
      <Modal open={open} onOpenChange={setOpen} title="Решение встречи" description="Одна фраза: что решили. Владелец получит событие в «Мне», решение останется в журнале.">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextArea label="Что решили" id="decision-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus counter={{ value: text.length, max: 1000 }} />
          <PersonSelect id="decision-owner" label="Владелец решения, если есть" value={owner} onChange={setOwner} exclude={"" as PersonSlug} />
          <TextInput label="Связанные задачи, номера через запятую" id="decision-tasks" value={tasks} onChange={(e) => setTasks(e.target.value)} inputMode="numeric" />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              Записать
            </Button>
          </div>
        </form>
      </Modal>
      <span className="sr-only">{me.slug}</span>
    </>
  );
}

function DecisionsStep({ meeting, canLead, busy, run, projector }: { meeting: MeetingView; canLead: boolean; busy: boolean; run: Run; projector: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className={cn("font-semibold leading-tight text-ink", projector ? "text-display" : "text-display-sm")}>Решения встречи</h2>
        <p className="mt-2 text-title text-muted">
          {meeting.decisions.length ? `Записано: ${meeting.decisions.length}. Проверяем формулировки и владельцев` : "Пока ни одного решения. Запишите, что решили, или закройте встречу без решений"}
        </p>
      </div>
      <DecisionList decisions={meeting.decisions} />
      {canLead && meeting.status !== "done" ? (
        <div className="flex flex-wrap gap-2">
          <DecisionButton meeting={meeting} itemId={null} run={run} busy={busy} />
          <TimerSetting meeting={meeting} run={run} busy={busy} />
        </div>
      ) : null}
    </div>
  );
}

function TimerSetting({ meeting, run, busy }: { meeting: MeetingView; run: Run; busy: boolean }) {
  const [value, setValue] = useState(String(meeting.timerMinutes));
  useEffect(() => setValue(String(meeting.timerMinutes)), [meeting.timerMinutes]);
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => setTimerAction(meeting.id, Number(value)), "Таймер сохранён");
      }}
    >
      <TextInput label="Минут на человека" id="timer-minutes" value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" className="w-36" />
      <Button type="submit" size="sm" variant="secondary" className="h-11" disabled={busy || value === String(meeting.timerMinutes)}>
        Сохранить
      </Button>
    </form>
  );
}

function AddItemModal({ open, onClose, meeting, run }: { open: boolean; onClose: () => void; meeting: MeetingView; run: Run }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Пункт повестки" description="Сформулируйте вопросом: так на встрече понятно, что надо решить.">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return setError("Сформулируйте пункт вопросом");
          const ok = await run(() => addAgendaItemAction(meeting.id, title, note || null), "Пункт добавлен");
          if (ok) {
            setTitle("");
            setNote("");
            setError(null);
            onClose();
          }
        }}
        className="flex flex-col gap-4"
      >
        <TextInput label="Вопрос" id="item-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Например: «Запускаем ли КАСКО для такси в ноябре?»" />
        <TextArea label="Пояснение, если нужно" id="item-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        <FormError message={error ?? undefined} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Добавить</Button>
        </div>
      </form>
    </Modal>
  );
}

function Protocol({ meeting }: { meeting: MeetingView }) {
  const { notify } = usePrototype();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(meeting.protocol ?? "");
      notify("Протокол скопирован");
    } catch {
      notify("Не получилось скопировать: выделите текст вручную", "error");
    }
  };
  return (
    <section aria-labelledby="protocol" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="protocol" className="text-title font-semibold text-ink">
            Протокол
          </h2>
          <p className="text-small text-muted">
            {meeting.protocolSentAt ? `Отправлен участникам ${new Date(meeting.protocolSentAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "Письма не ушли: почта не настроена или у участников нет адресов. Протокол виден здесь и в «Мне»"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={copy}>
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
            Скопировать
          </Button>
          {meeting.notionUrl ? (
            <a href={meeting.notionUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink ring-1 ring-line hover:bg-field">
              <Link2 className="h-4 w-4" aria-hidden="true" />
              Заметка в Notion
            </a>
          ) : null}
        </div>
      </div>
      <pre className="whitespace-pre-wrap sv-card sv-card--soft p-5 font-sans text-body leading-relaxed text-ink">{meeting.protocol}</pre>
      <DecisionList decisions={meeting.decisions} />
    </section>
  );
}
