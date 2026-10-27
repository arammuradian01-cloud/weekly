"use client";

// Окна экрана «Weekly-команды» (этап 64): новая команда, добавить участников, переименовать, закрыть, руководитель
// и команда выше, ритм weekly. Каждое окно зовёт действие с сервиса; не получилось (дубль названия, открытые задачи,
// нет прав) окно остаётся с введённым, причина в уведомлении.

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextInput } from "@/components/ui/primitives";
import { SearchPicker } from "@/components/ui/search-picker";
import { usePrototype } from "@/domain/store";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { plural } from "@/domain/dates";
import { addPeopleAction, closeTeamAction, createTeamAction, renameTeamAction, setRhythmAction, updateTeamAction } from "@/app/(app)/people/teams/actions";
import type { PickPerson, WeeklyTeam } from "@/lib/org/teams";
import { addSummary, inBranch, parentChoices, parentHint, type ManagementOff, type ParentChoice } from "@/lib/org/team-rights";
import { WEEKDAY_NAMES, type Slot } from "@/lib/org/rhythm";
import { TOP_TEAM } from "@/domain/teams";
import { PeoplePicker, type PickOption } from "./people-picker";

export const NAME_MAX = 120;
/** Сколько людей за раз: как на сервере (BATCH_MAX этапа 57) */
export const BATCH_MAX = 150;

const people = (n: number) => `${n} ${plural(n, "человек", "человека", "человек")}`;

/** Пометка «другая ветка» относительно руководителя команды. В режиме управления не нужна: входят все сразу */
function useOptions(all: PickPerson[], leader: string | null, direct: boolean, blocked: Map<string, string>): PickOption[] {
  return useMemo(() => {
    const managerOf = new Map(all.map((p) => [p.slug, p.manager]));
    return all.map((p) => ({
      slug: p.slug,
      fullName: p.fullName,
      position: p.position,
      unit: p.unit,
      note: direct || !leader || inBranch(managerOf, p.slug, leader) ? null : "другая ветка",
      blocked: blocked.get(p.slug) ?? null,
    }));
  }, [all, leader, direct, blocked]);
}

function Actions({ busy, onCancel, submit, disabled, danger = false }: { busy: boolean; onCancel: () => void; submit: string; disabled?: boolean; danger?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
        Отмена
      </Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy || disabled} loading={busy}>
        {submit}
      </Button>
    </div>
  );
}

const rule = (direct: boolean) =>
  direct
    ? "В режиме управления люди других веток входят сразу, их руководители получат событие на «Моей неделе»."
    : "Люди ветки руководителя команды входят сразу. Люди других веток войдут, когда согласится их руководитель: запрос появится у него на «Моей неделе».";

/**
 * Новая команда сразу с людьми. Руководит ею тот, кто создаёт; владелец в режиме управления сразу выбирает другого
 * руководителя (одной транзакцией: команда сразу с ним, ветка людей по нему), остальным окно говорит, где его назначают
 */
export function CreateTeamModal({
  open,
  onOpenChange,
  all,
  me,
  direct,
  managementOff,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  all: PickPerson[];
  me: string;
  /** Владелец в режиме управления: поле «Руководитель», люди других веток входят сразу */
  direct: boolean;
  managementOff: ManagementOff;
  onCreated: (id: string) => void;
}) {
  const run = useRunWeekly();
  const { notify } = usePrototype();
  const [name, setName] = useState("");
  const [leader, setLeader] = useState("");
  const [slugs, setSlugs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const head = direct && leader ? leader : me;
  // Руководитель в команде и так. Выбрали другого руководителя: себя можно добавить участником
  const blocked = useMemo(() => new Map([[head, head === me ? "вы руководитель" : "руководитель команды"]]), [me, head]);
  const options = useOptions(all, head, direct, blocked);
  const external = options.filter((o) => o.note && slugs.includes(o.slug)).length;
  const leaders = useMemo(() => all.map((p) => ({ value: p.slug, label: p.fullName, hint: [p.position, p.unit].filter(Boolean).join(", ") || null })), [all]);
  const whoLeads = direct
    ? "Руководителя выберите ниже, пусто: руководите вы."
    : managementOff === "owner"
      ? "Руководите командой вы. Другого руководителя назначите в карточке команды, включив режим управления."
      : "Руководите командой вы. Другого руководителя назначает владелец в режиме управления.";
  const close = () => {
    if (busy) return;
    onOpenChange(false);
  };
  return (
    <Modal open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())} title="Новая weekly-команда" description={`У команды будет своё weekly и свои задачи. ${whoLeads} ${rule(direct)}`} wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !name.trim()) return;
          setBusy(true);
          const r = await run(() => createTeamAction(name, { slugs: slugs.filter((s) => s !== head) }, direct && leader ? leader : null));
          setBusy(false);
          if (!r) return;
          notify(addSummary(r.name, r.result) + (r.leader ? `. Руководитель: ${r.leader}` : ""));
          setName("");
          setLeader("");
          setSlugs([]);
          onOpenChange(false);
          onCreated(r.id);
        }}
      >
        <TextInput label="Название команды" id="team-new-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} placeholder="Например, Кросс-продажи с кредитами" autoFocus />
        {direct && all.length ? <SearchPicker id="team-new-leader" label="Руководитель" value={leader} onChange={setLeader} options={leaders} inline placeholder="Вы" hint="Пусто: руководите командой вы. Руководитель ведёт weekly и задачи команды" /> : null}
        {all.length ? <PeoplePicker id="team-new-people" label="Участники, можно добавить и позже" people={options} value={slugs} onChange={setSlugs} /> : null}
        {external ? <p className="text-small text-muted">Из других веток: {people(external)}. Они войдут после согласия своего руководителя.</p> : null}
        {slugs.length > BATCH_MAX ? <p className="text-small text-danger-ink">За раз можно добавить до {BATCH_MAX} человек.</p> : null}
        <Actions busy={busy} onCancel={close} submit="Создать команду" disabled={!name.trim() || slugs.length > BATCH_MAX} />
      </form>
    </Modal>
  );
}

/** Добавить участников поиском по всей компании, несколько сразу. Правило согласия считает сервер */
export function AddPeopleModal({ team, all, direct, onClose }: { team: WeeklyTeam; all: PickPerson[]; direct: boolean; onClose: () => void }) {
  const run = useRunWeekly();
  const { notify } = usePrototype();
  const [slugs, setSlugs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const blocked = useMemo(() => {
    const m = new Map<string, string>();
    if (team.leader) m.set(team.leader.slug, "руководитель команды");
    for (const x of team.members) m.set(x.slug, "уже в команде");
    for (const w of team.waiting) m.set(w.slug, "ждёт согласия");
    return m;
  }, [team]);
  const options = useOptions(all, team.leader?.slug ?? null, direct, blocked);
  const external = options.filter((o) => o.note && slugs.includes(o.slug)).length;
  return (
    <Modal open onOpenChange={(o) => !o && !busy && onClose()} title={`Добавить участников: ${team.name}`} description={rule(direct)} wide>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !slugs.length) return;
          setBusy(true);
          const r = await run(() => addPeopleAction(team.id, { slugs }));
          setBusy(false);
          if (!r) return;
          notify(addSummary(team.name, r));
          onClose();
        }}
      >
        <PeoplePicker id="team-add-people" label="Найти человека" people={options} value={slugs} onChange={setSlugs} />
        {external ? <p className="text-small text-muted" data-testid="team-add-external">Из других веток: {people(external)}. Они войдут в команду, когда согласится их руководитель. Задачи этих людей вне команды руководителю не видны.</p> : null}
        {slugs.length > BATCH_MAX ? <p className="text-small text-danger-ink">За раз можно добавить до {BATCH_MAX} человек.</p> : null}
        <Actions busy={busy} onCancel={onClose} submit="Добавить" disabled={!slugs.length || slugs.length > BATCH_MAX} />
      </form>
    </Modal>
  );
}

export function RenameModal({ team, onClose }: { team: WeeklyTeam; onClose: () => void }) {
  const run = useRunWeekly();
  const [name, setName] = useState(team.name);
  const [busy, setBusy] = useState(false);
  const same = name.replace(/\s+/g, " ").trim() === team.name;
  return (
    <Modal open onOpenChange={(o) => !o && !busy && onClose()} title="Название команды" description="Название видно в переключателе команд, в weekly и задачах.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || same || !name.trim()) return;
          setBusy(true);
          const r = await run(() => renameTeamAction(team.id, name), "Команда переименована");
          setBusy(false);
          if (r) onClose();
        }}
      >
        <TextInput label="Название команды" id="team-rename" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoFocus />
        <Actions busy={busy} onCancel={onClose} submit="Сохранить" disabled={same || !name.trim()} />
      </form>
    </Modal>
  );
}

export function CloseModal({ team, onClose, onClosed }: { team: WeeklyTeam; onClose: () => void; onClosed: () => void }) {
  const run = useRunWeekly();
  const [busy, setBusy] = useState(false);
  const blocked = team.openTasks > 0;
  const text = blocked
    ? `В команде открытых задач: ${team.openTasks}. Сначала передайте их в другую команду или закройте, потом закройте команду.`
    : "Команда пропадёт из переключателя команд и из списка. Ожидающие запросы на согласие отменятся. Задачи, weekly и журнал остаются.";
  return (
    <Modal open onOpenChange={(o) => !o && !busy && onClose()} title={`Закрыть команду «${team.name}»?`} description={text}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || blocked) return;
          setBusy(true);
          const r = await run(() => closeTeamAction(team.id), `Команда «${team.name}» закрыта`);
          setBusy(false);
          if (r === null) return;
          onClose();
          onClosed();
        }}
      >
        <Actions busy={busy} onCancel={onClose} submit="Закрыть команду" disabled={blocked} danger />
      </form>
    </Modal>
  );
}

/** Руководитель и команда выше: владелец в режиме управления. Топ-командой руководит владелец ресурса */
export function LeaderModal({ team, all, owners, parents, onClose }: { team: WeeklyTeam; all: PickPerson[]; owners: string[]; parents: ParentChoice[]; onClose: () => void }) {
  const run = useRunWeekly();
  const top = team.id === TOP_TEAM;
  const [leader, setLeader] = useState(team.leader?.slug ?? "");
  const [parent, setParent] = useState(team.parent?.id ?? "");
  const [busy, setBusy] = useState(false);
  const allowed = top ? all.filter((p) => owners.includes(p.slug)) : all;
  const options = allowed.map((p) => ({ value: p.slug, label: p.fullName, hint: [p.position, p.unit].filter(Boolean).join(", ") || null }));
  // Команды выше десятки: поиск по названию (этап 70). Саму команду, команды ниже неё и закрытые не предлагаем, сервер
  // это тоже проверяет. Подсказкой руководитель и команда выше: одноимённые команды не спутать
  const parentOptions = useMemo(() => parentChoices(parents, team.id).map((p) => ({ value: p.id, label: p.name, hint: parentHint(p, parents) })), [parents, team.id]);
  // Нынешней команды выше нет среди вариантов (закрыта): поле не делает вид, что команда выше не выбрана
  const missing = team.parent && !parentOptions.some((o) => o.value === team.parent!.id) ? team.parent : null;
  const missingClosed = missing ? parents.find((p) => p.id === missing.id)?.active === false : false;
  const leaderChanged = leader !== (team.leader?.slug ?? "");
  const parentChanged = !top && parent !== (team.parent?.id ?? "");
  return (
    <Modal open onOpenChange={(o) => !o && !busy && onClose()} title={`Руководитель: ${team.name}`} description="Руководитель ведёт weekly и задачи команды, собирает её состав. Команда выше: туда руководитель сдаёт свой weekly.">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || (!leaderChanged && !parentChanged)) return;
          setBusy(true);
          const r = await run(() => updateTeamAction(team.id, { ...(leaderChanged ? { leader: leader || null } : {}), ...(parentChanged ? { parent: parent || null } : {}) }), "Команда сохранена");
          setBusy(false);
          if (r !== null) onClose();
        }}
      >
        <SearchPicker id="team-leader" label="Руководитель" value={leader} onChange={setLeader} options={options} inline placeholder={top ? "Владелец ресурса" : "Не назначен"} hint={top ? "Этой командой руководит владелец ресурса" : "Очистите поле, если руководителя пока нет"} />
        {!top ? (
          <SearchPicker
            id="team-parent"
            label="Команда выше"
            value={parent}
            onChange={setParent}
            options={parentOptions}
            // Команду выше можно сменить, но не убрать: без неё команда встала бы под топ-команду
            clearable={!team.parent}
            inline
            placeholder={missing ? missing.name : "Не выбрана"}
            hint={
              missing
                ? `Сейчас команда выше «${missing.name}»${missingClosed ? ", она закрыта" : ""}. Выберите другую поиском по названию или руководителю`
                : "Найдите по названию команды или руководителю. Саму команду и команды ниже неё выбрать нельзя"
            }
            emptyText="Такой команды нет: проверьте написание"
          />
        ) : null}
        <Actions busy={busy} onCancel={onClose} submit="Сохранить" disabled={!leaderChanged && !parentChanged} />
      </form>
    </Modal>
  );
}

const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((d, i) => ({ value: String(i + 1), label: d.charAt(0).toUpperCase() + d.slice(1) }));

type SlotDraft = { own: boolean; week: "0" | "1"; weekday: string; time: string };
const draftOf = (slot: Slot | null, fallback: SlotDraft): SlotDraft => (slot ? { own: true, week: String(slot.week) as "0" | "1", weekday: String(slot.weekday), time: slot.time } : fallback);
const slotFrom = (d: SlotDraft): Slot | null => (d.own ? { week: Number(d.week) as 0 | 1, weekday: Number(d.weekday), time: d.time } : null);

/** Ждём weekly и срок (этап 15): кто сдаёт, срок сдачи и встреча. Задают руководитель команды, руководитель выше и владелец */
export function RhythmModal({ team, onClose }: { team: WeeklyTeam; onClose: () => void }) {
  const run = useRunWeekly();
  const [deadline, setDeadline] = useState<SlotDraft>(draftOf(team.rhythm.deadline, { own: false, week: "0", weekday: "5", time: "16:00" }));
  const [meeting, setMeeting] = useState<SlotDraft>(draftOf(team.rhythm.meeting, { own: false, week: "1", weekday: "1", time: "11:00" }));
  const [specialists, setSpecialists] = useState(team.rhythm.specialists);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onOpenChange={(o) => !o && !busy && onClose()} title={`Ритм weekly: ${team.name}`} description="Срок сдачи команды не позже срока департамента: руководитель должен успеть собрать weekly команды и сдать свой">
      <form
        className="flex flex-col gap-5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          const r = await run(() => setRhythmAction(team.id, { deadline: slotFrom(deadline), meeting: slotFrom(meeting), specialists }), "Ритм команды сохранён");
          setBusy(false);
          if (r !== null) onClose();
        }}
      >
        <label className="flex items-start gap-3 text-body text-ink">
          <input type="checkbox" checked={specialists} onChange={(e) => setSpecialists(e.target.checked)} className="mt-1 h-4 w-4 accent-blue-700" />
          <span>
            Weekly сдают и специалисты
            <span className="block text-small text-muted">Выключено: weekly сдают только руководители команд, специалисты обновляют задачи</span>
          </span>
        </label>
        <SlotFields legend="Срок сдачи" id="rh-deadline" value={deadline} onChange={setDeadline} />
        <SlotFields legend="Встреча команды" id="rh-meeting" value={meeting} onChange={setMeeting} />
        <Actions busy={busy} onCancel={onClose} submit="Сохранить" />
      </form>
    </Modal>
  );
}

function SlotFields({ legend, id, value, onChange }: { legend: string; id: string; value: SlotDraft; onChange: (v: SlotDraft) => void }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-body font-semibold text-ink">{legend}</legend>
      <SelectField
        label="Когда"
        id={`${id}-mode`}
        value={value.own ? "own" : "department"}
        onChange={(e) => onChange({ ...value, own: e.target.value === "own" })}
        options={[
          { value: "department", label: "Как у департамента" },
          { value: "own", label: "Свой день и время" },
        ]}
      />
      {value.own ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="Неделя"
            id={`${id}-week`}
            value={value.week}
            onChange={(e) => onChange({ ...value, week: e.target.value as "0" | "1" })}
            options={[
              { value: "0", label: "Отчётная" },
              { value: "1", label: "Следующая" },
            ]}
          />
          <SelectField label="День" id={`${id}-day`} value={value.weekday} onChange={(e) => onChange({ ...value, weekday: e.target.value })} options={WEEKDAY_OPTIONS} />
          <TextInput label="Время" id={`${id}-time`} type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />
        </div>
      ) : null}
    </fieldset>
  );
}
