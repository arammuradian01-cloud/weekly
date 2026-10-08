"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { allPeople } from "@/domain/people";
import { ALL_TEAMS, TOP_TEAM, teamOf, teamPeople } from "@/domain/teams";
import { addDays } from "@/domain/dates";
import { dictOptions, PRIORITIES, SOURCES, type DirectionCode, type PriorityCode, type SourceCode } from "@/domain/dictionaries";
import type { Owner } from "@/domain/types";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { openCommandPalette } from "@/components/shell/command-palette";
import { REPEAT_KINDS, type RepeatKindCode } from "@/lib/tasks/repeat";

const OPEN_EVENT = "weekly:new-task";
/** Задачу поставили по записи weekly: форма записи показывает её номер, человек остаётся на экране сдачи */
export const TASK_FROM_ENTRY_EVENT = "weekly:task-from-entry";

/** Кнопка «Новая задача» из любого места открывает один и тот же диалог */
type Prefill = { title?: string; outcome?: string; source?: SourceCode; sourceNote?: string; weeklyEntryId?: string };

export function openNewTask(prefill?: Prefill) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: prefill }));
}

export function NewTaskButton({ size = "md" }: { size?: "md" | "sm" }) {
  return (
    <Button size={size} onClick={() => openNewTask()} aria-keyshortcuts="N">
      <Plus className="h-4 w-4" aria-hidden="true" />
      Новая задача
    </Button>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/**
 * Горячие клавиши (раздел 7 ТЗ): N новая задача, / поиск.
 * Диалог создания задачи живёт здесь один на всё приложение.
 */
/** «Встреча», если её не скрыли в справочнике, иначе первый видимый источник */
const defaultSource = (): SourceCode => (SOURCES.some((s) => s.code === "meeting") ? "meeting" : (SOURCES[0]?.code ?? "meeting"));

export function GlobalHotkeys() {
  const { data, me, manage, observer, createTask, team, leads, teamPeople: selectedPeople } = usePrototype();
  // Куда можно поставить задачу: свои команды, команды, которыми руковожу, а в режиме управления любая видимая
  const teamChoices = team.options.filter((o) => manage || o.relation === "member" || o.relation === "leader" || o.relation === "below");
  const defaultTeam = (): string =>
    team.id && team.id !== ALL_TEAMS && teamChoices.some((o) => o.id === team.id) ? team.id : (teamChoices.find((o) => o.relation === "member" || o.relation === "leader")?.id ?? teamChoices[0]?.id ?? TOP_TEAM);
  const [taskTeam, setTaskTeam] = useState<string>(defaultTeam());
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [owner, setOwner] = useState<Owner>(me.slug);
  const [direction, setDirection] = useState<DirectionCode>(me.direction);
  const [priority, setPriority] = useState<PriorityCode>("medium");
  const [due, setDue] = useState(addDays(data.today, 7));
  const [source, setSource] = useState<SourceCode>(defaultSource());
  const [sourceNote, setSourceNote] = useState("");
  const [weeklyEntryId, setWeeklyEntryId] = useState<string | undefined>(undefined);
  // Повтор (этап 25): «нет» или вид повтора, следующая создаётся при закрытии
  const [repeat, setRepeat] = useState<"" | RepeatKindCode>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as Prefill | undefined;
      setWeeklyEntryId(detail?.weeklyEntryId);
      setTitle(detail?.title ?? "");
      setOutcome(detail?.outcome ?? "");
      setSource(detail?.source ?? defaultSource());
      setSourceNote(detail?.sourceNote ?? "");
      setOwner(me.slug);
      setDirection(me.direction);
      setPriority("medium");
      setDue(addDays(data.today, 7));
      setRepeat("");
      setTaskTeam(defaultTeam());
      setError(null);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (!observer && (e.key === "n" || e.key === "N" || e.key === "т" || e.key === "Т")) {
        e.preventDefault();
        openNewTask();
      }
      if (e.key === "/") {
        // Поиск с этапа 25 живёт в командной строке
        e.preventDefault();
        openCommandPalette();
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
    // Выбор команды по умолчанию зависит от выбранной команды и режима управления: при их смене обработчик пересоздаётся
  }, [data.today, me.slug, me.direction, observer, team.id, manage]);

  // Себе ставит каждый. Другому: режим управления и руководитель команды задачи, остальные только предлагают (этап 14)
  const leadsTarget = leads.includes(taskTeam);
  const proposing = !manage && !leadsTarget && owner !== me.slug;

  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setError("Напишите, что за задача");
    if (title.length > 120) return setError("Название длиннее 120 знаков: оставьте одну мысль");
    if (!outcome.trim()) return setError("Опишите результат: по чему понять, что задача сделана");
    if (!due) return setError("Укажите срок");
    setBusy(true);
    const result = await createTask({
      title: title.trim(),
      outcome: outcome.trim(),
      owner,
      direction,
      priority,
      due,
      source,
      sourceNote: sourceNote.trim() || undefined,
      weeklyEntryId,
      team: taskTeam,
      ...(repeat ? { repeat: { kind: repeat, mode: "on-close" as const } } : {}),
    });
    setBusy(false);
    if ("error" in result) return setError(result.error);
    setOpen(false);
    if (weeklyEntryId) {
      window.dispatchEvent(new CustomEvent(TASK_FROM_ENTRY_EVENT, { detail: { entryId: weeklyEntryId, number: result.number } }));
      return;
    }
    router.push(`/tasks?task=${result.number}`);
  };

  // Ответственный из людей команды задачи. У команды не из снимка (старый снимок): люди выбранной команды
  const target = teamOf(taskTeam);
  const pool = target
    ? allPeople().filter((p) => p.active && p.role !== "OBSERVER" && (teamPeople(target).includes(p.slug) || p.slug === me.slug))
    : selectedPeople;
  const ownerOptions = [
    ...pool.map((p) => ({ value: p.slug, label: p.slug === me.slug ? `${p.fullName} (я)` : p.fullName })),
    ...(manage && taskTeam === TOP_TEAM ? [{ value: "all", label: "Все лидеры" }] : []),
  ];

  return (
    <Modal open={open} onOpenChange={setOpen} title="Новая задача" description="Одна мысль в названии, понятный результат и срок">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextInput
          label="Задача"
          id="nt-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          autoFocus
          hint={`${title.length} из 120 знаков`}
        />
        <TextArea label="Что нужно сделать" id="nt-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} hint="По чему понять, что задача сделана" />
        <div className="grid gap-4 sm:grid-cols-2">
          {teamChoices.length > 1 ? (
            <SelectField
              label="Команда"
              id="nt-team"
              value={taskTeam}
              onChange={(e) => {
                setTaskTeam(e.target.value);
                setOwner(me.slug);
              }}
              options={teamChoices.map((o) => ({ value: o.id, label: o.name }))}
              className="sm:col-span-2"
            />
          ) : null}
          <SelectField label="Ответственный" id="nt-owner" value={owner} onChange={(e) => setOwner(e.target.value as Owner)} options={ownerOptions} />
          <SelectField label="Направление" id="nt-dir" value={direction} onChange={(e) => setDirection(e.target.value as DirectionCode)} options={dictOptions("DIRECTION", direction)} />
          <SelectField label="Приоритет" id="nt-pr" value={priority} onChange={(e) => setPriority(e.target.value as PriorityCode)} options={PRIORITIES.map((p) => ({ value: p.code, label: p.label }))} />
          <TextInput label="Срок" id="nt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <SelectField label="Источник" id="nt-src" value={source} onChange={(e) => setSource(e.target.value as SourceCode)} options={dictOptions("TASK_SOURCE", source)} />
          <TextInput label="Подробнее об источнике" id="nt-src-note" value={sourceNote} onChange={(e) => setSourceNote(e.target.value)} placeholder="Например, встреча 6 октября" />
          <SelectField label="Повтор" id="nt-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as "" | RepeatKindCode)} options={[{ value: "", label: "Не повторяется" }, ...REPEAT_KINDS.map((k) => ({ value: k.code, label: k.label }))]} hint={repeat ? "Следующая появится при закрытии этой, режим можно сменить в карточке" : undefined} />
        </div>
        {proposing ? (
          <p className="sv-alert sv-alert--info">
            Задача уйдёт со статусом «Предложена». Адресат примет её или отклонит с причиной.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="sv-alert sv-alert--danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Сохраняю…" : proposing ? "Предложить задачу" : "Поставить задачу"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
