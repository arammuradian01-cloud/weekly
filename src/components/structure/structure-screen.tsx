"use client";

// Страница «Структура» (этап 14): подразделения департамента и команды руководителей.
// Владелец в режиме управления загружает структуру из таблицы, правит команды, людей и подразделения.
// Руководитель команды сам добавляет и убирает участников своей команды.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus, Upload, Users } from "lucide-react";
import type { StructureView, TeamView, UnitView } from "@/lib/org/view";
import { usePrototype } from "@/domain/store";
import { TOP_TEAM } from "@/domain/teams";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Segmented, SelectField, TextInput } from "@/components/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import {
  addMemberAction,
  createTeamAction,
  removeMemberAction,
  setPersonOrgAction,
  setTeamRhythmAction,
  syncTeamsAction,
  updateTeamAction,
  updateUnitAction,
} from "@/app/(app)/structure/actions";
import { StructureImport } from "./structure-import";
import { PeopleTreeView } from "./people-tree";
import type { PeopleTree } from "@/lib/org/people-tree";
import { WEEKDAY_NAMES, slotText, type Slot } from "@/lib/org/rhythm";
import { deadlineText } from "@/components/weekly/weekly-feed";

type Candidate = { slug: string; fullName: string; position: string | null };

export function StructureScreen({ view, tree, owner, me, candidates, leads = [] }: { view: StructureView; tree: PeopleTree; owner: boolean; me: string; candidates: Candidate[]; leads?: string[] }) {
  // Дерево подчинённых первым (этап 34): так смотрят структуру чаще всего. Пока руководители не заданы, первыми подразделения
  const [tab, setTab] = useState<"people" | "units" | "teams">(tree.loaded ? "people" : "units");
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const { notify } = usePrototype();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) notify(r.error ?? "Не получилось", "error");
      else {
        notify(ok);
        router.refresh();
      }
    });

  const empty = view.units.filter((u) => u.kind !== "DEPARTMENT").length === 0;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Что показать"
          value={tab}
          onChange={setTab}
          options={[
            { value: "people", label: "Подчинённые" },
            { value: "units", label: "Подразделения" },
            { value: "teams", label: "Команды", count: view.teams.length },
          ]}
        />
        {owner ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Загрузить структуру
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(async () => {
              const r = await syncTeamsAction();
              return r.ok ? { ok: true } : r;
            }, "Команды руководителей подразделений проверены")}>
              Создать команды по структуре
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Новая команда
            </Button>
          </div>
        ) : null}
      </div>

      {tab === "people" ? (
        <PeopleTreeView tree={tree} me={me} />
      ) : tab === "units" ? (
        empty ? (
          <EmptyState title="Структура ещё не загружена">
            {owner ? "Загрузите лист структуры из таблицы: кнопка «Загрузить структуру» выше." : "Её загрузит владелец ресурса. Пока работают команды из раздела «Команды»."}
          </EmptyState>
        ) : (
          <UnitTree units={view.units} owner={owner} people={candidates} onSave={run} />
        )
      ) : (
        <TeamTree teams={view.teams} owner={owner} me={me} candidates={candidates} onSave={run} pending={pending} leads={leads} />
      )}

      {owner && tab === "units" && view.unplaced.length ? (
        <section aria-labelledby="unplaced" className="sv-card sv-card--soft p-4">
          <h2 id="unplaced" className="text-title-sm font-semibold text-ink">
            Не в структуре: {view.unplaced.length}
          </h2>
          <p className="mt-1 text-small text-muted">Эти люди есть в ресурсе, но не стоят ни в одном подразделении. Их можно оставить так или поставить в подразделение.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {view.unplaced.map((p) => (
              <li key={p.slug} className="rounded-md bg-field px-2.5 py-1 text-small text-ink">
                {p.fullName}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {owner ? <StructureImport open={importing} onOpenChange={setImporting} /> : null}
      {owner ? <NewTeamModal open={creating} onOpenChange={setCreating} teams={view.teams} people={candidates} onSave={run} /> : null}
    </div>
  );
}

// ---------- Подразделения ----------

function UnitTree({ units, owner, people, onSave }: { units: UnitView[]; owner: boolean; people: Candidate[]; onSave: Runner }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(units.filter((u) => u.depth <= 1).map((u) => u.id)));
  const [editing, setEditing] = useState<{ slug: string; fullName: string; position: string | null; unit: string } | null>(null);
  const [editingUnit, setEditingUnit] = useState<UnitView | null>(null);
  const hidden = useMemo(() => {
    // Подразделение скрыто, если свёрнут кто-то выше
    const byId = new Map(units.map((u) => [u.id, u]));
    const out = new Set<string>();
    for (const u of units) {
      let cur = u.parentId ? byId.get(u.parentId) : undefined;
      while (cur) {
        if (!openIds.has(cur.id)) {
          out.add(u.id);
          break;
        }
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return out;
  }, [units, openIds]);
  const toggle = (id: string) => setOpenIds((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <>
      <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft" aria-label="Подразделения департамента">
        {units.filter((u) => !hidden.has(u.id)).map((u) => {
          const open = openIds.has(u.id);
          return (
            <li key={u.id} className={cn("px-3 py-3 sm:px-4", !u.active && "opacity-60")}>
              <div className="flex items-start gap-2" style={{ paddingLeft: `${Math.min(u.depth, 5) * 16}px` }}>
                <button
                  type="button"
                  onClick={() => toggle(u.id)}
                  aria-expanded={open}
                  aria-label={`${open ? "Свернуть" : "Развернуть"}: ${u.name}`}
                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-field hover:text-ink"
                >
                  {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-body text-ink">
                    <span className="text-small text-muted">{u.kindLabel}</span> <span className="font-semibold">{u.name}</span>
                    {!u.active ? <span className="ml-2 text-caption text-muted">выключено</span> : null}
                  </p>
                  <p className="text-small text-muted">
                    {u.head ? `Руководитель: ${u.head.fullName}` : u.headNote || "Руководитель не выделен"}
                    {`, человек в ветке: ${u.total}`}
                  </p>
                  {open ? (
                    <div className="mt-2 flex flex-col gap-2">
                      {u.people.length ? (
                        <ul className="flex flex-col gap-1">
                          {u.people.map((p) => (
                            <li key={p.slug} className="flex flex-wrap items-baseline gap-x-2 text-small">
                              <span className="text-ink">{p.fullName}</span>
                              {p.position ? <span className="text-muted">{p.position}</span> : null}
                              {p.functional ? <span className="text-muted">функционально: {p.functional}</span> : null}
                              {owner ? (
                                <button type="button" className="text-blue-700 hover:underline" onClick={() => setEditing({ slug: p.slug, fullName: p.fullName, position: p.position, unit: u.id })}>
                                  Изменить
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {u.vacancies?.length ? (
                        <p className="text-small text-muted">
                          Вакансии: {u.vacancies.join(", ")}
                        </p>
                      ) : null}
                      {owner && u.kind !== "DEPARTMENT" ? (
                        <button type="button" className="self-start text-small text-blue-700 hover:underline" onClick={() => setEditingUnit(u)}>
                          Изменить подразделение
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? <PersonOrgModal person={editing} units={units} people={people} onClose={() => setEditing(null)} onSave={onSave} /> : null}
      {editingUnit ? <UnitModal unit={editingUnit} units={units} people={people} onClose={() => setEditingUnit(null)} onSave={onSave} /> : null}
    </>
  );
}

type Runner = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void;

function PersonOrgModal({
  person,
  units,
  people,
  onClose,
  onSave,
}: {
  person: { slug: string; fullName: string; position: string | null; unit: string };
  units: UnitView[];
  people: Candidate[];
  onClose: () => void;
  onSave: Runner;
}) {
  const [position, setPosition] = useState(person.position ?? "");
  const [unit, setUnit] = useState(person.unit);
  const [manager, setManager] = useState("");
  const [functional, setFunctional] = useState("");
  const others = people.filter((p) => p.slug !== person.slug).map((p) => ({ value: p.slug, label: p.fullName }));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={person.fullName} description="Должность, подразделение и руководители. Изменение попадёт в журнал">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(
            () =>
              setPersonOrgAction(person.slug, {
                position,
                unit,
                ...(manager ? { manager: manager === "-" ? null : manager } : {}),
                ...(functional ? { functional: functional === "-" ? null : functional } : {}),
              }),
            "Сохранено",
          );
          onClose();
        }}
      >
        <TextInput label="Должность" id="po-position" value={position} onChange={(e) => setPosition(e.target.value)} maxLength={120} />
        <SelectField label="Подразделение" id="po-unit" value={unit} onChange={(e) => setUnit(e.target.value)} options={units.map((u) => ({ value: u.id, label: `${"  ".repeat(u.depth)}${u.name}` }))} />
        <SelectField label="Руководитель" id="po-manager" value={manager} onChange={(e) => setManager(e.target.value)} options={[{ value: "", label: "Не менять" }, { value: "-", label: "Нет руководителя" }, ...others]} />
        <SelectField
          label="Функциональный руководитель"
          id="po-functional"
          value={functional}
          onChange={(e) => setFunctional(e.target.value)}
          options={[{ value: "", label: "Не менять" }, { value: "-", label: "Нет" }, ...others]}
          hint="Видит задачи человека, но не управляет ими"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}

function UnitModal({ unit, units, people, onClose, onSave }: { unit: UnitView; units: UnitView[]; people: Candidate[]; onClose: () => void; onSave: Runner }) {
  const [name, setName] = useState(unit.name);
  const [head, setHead] = useState(unit.head?.slug ?? "");
  const [headNote, setHeadNote] = useState(unit.headNote ?? "");
  const [parent, setParent] = useState(unit.parentId ?? "");
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={unit.name} description="Название, руководитель и место в структуре">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(() => updateUnitAction(unit.id, { name, head: head || null, headNote, parent: parent || null }), "Подразделение сохранено");
          onClose();
        }}
      >
        <TextInput label="Название" id="un-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <SelectField label="Руководитель" id="un-head" value={head} onChange={(e) => setHead(e.target.value)} options={[{ value: "", label: "Не выделен" }, ...people.map((p) => ({ value: p.slug, label: p.fullName }))]} />
        {!head ? <TextInput label="Пометка о руководителе" id="un-note" value={headNote} onChange={(e) => setHeadNote(e.target.value)} placeholder="Например, роль делят CPO, PMM и CRM Lead" /> : null}
        <SelectField
          label="Подразделение выше"
          id="un-parent"
          value={parent}
          onChange={(e) => setParent(e.target.value)}
          options={units.filter((u) => u.id !== unit.id).map((u) => ({ value: u.id, label: `${"  ".repeat(u.depth)}${u.name}` }))}
        />
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onSave(() => updateUnitAction(unit.id, { active: !unit.active }), unit.active ? "Подразделение выключено" : "Подразделение включено");
              onClose();
            }}
          >
            {unit.active ? "Выключить" : "Включить"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit">Сохранить</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Команды ----------

function orderTeams(teams: TeamView[]): { team: TeamView; depth: number }[] {
  const ids = new Set(teams.map((t) => t.id));
  const children = new Map<string | null, TeamView[]>();
  for (const t of teams) {
    const parent = t.parentId && ids.has(t.parentId) ? t.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), t]);
  }
  const out: { team: TeamView; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const t of children.get(parent) ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({ team: t, depth });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const t of teams) if (!seen.has(t.id)) out.push({ team: t, depth: 0 });
  return out;
}

function TeamTree({
  teams,
  owner,
  me,
  candidates,
  onSave,
  pending,
  leads,
}: {
  teams: TeamView[];
  owner: boolean;
  me: string;
  candidates: Candidate[];
  onSave: Runner;
  pending: boolean;
  leads: string[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamView | null>(null);
  const [rhythm, setRhythm] = useState<TeamView | null>(null);
  return (
    <>
      <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft" aria-label="Команды">
        {orderTeams(teams).map(({ team: t, depth }) => {
          const canEdit = owner || (t.id !== TOP_TEAM && t.leader?.slug === me);
          const open = openId === t.id;
          const addable = candidates.filter((c) => c.slug !== t.leader?.slug && !t.members.some((m) => m.slug === c.slug));
          return (
            <li key={t.id} className={cn("px-3 py-3 sm:px-4", !t.active && "opacity-60")}>
              <div className="flex items-start gap-2" style={{ paddingLeft: `${Math.min(depth, 5) * 16}px` }}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : t.id)}
                  aria-expanded={open}
                  aria-label={`${open ? "Свернуть" : "Показать участников"}: ${t.name}`}
                  className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-field hover:text-ink"
                >
                  {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-ink">
                    {t.name}
                    {!t.active ? <span className="ml-2 text-caption font-normal text-muted">выключена</span> : null}
                  </p>
                  <p className="text-small text-muted">
                    {t.leader ? `Руководитель: ${t.leader.fullName}` : "Руководитель не назначен"}, участников {t.members.length}, открытых задач {t.openTasks}
                    {t.overdue ? <span className="text-danger-ink">, просрочено {t.overdue}</span> : null}
                  </p>
                  {t.active ? <WeeklyLight weekly={t.weekly} /> : null}
                  {open ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <p className="text-small text-muted">{rhythmText(t)}</p>
                      {t.members.length ? (
                        <ul className="flex flex-col gap-1">
                          {t.members.map((m) => (
                            <li key={m.slug} className="flex flex-wrap items-baseline gap-x-2 text-small">
                              <span className="text-ink">{m.fullName}</span>
                              {m.position ? <span className="text-muted">{m.position}</span> : null}
                              {canEdit ? (
                                <button type="button" disabled={pending} className="text-blue-700 hover:underline disabled:opacity-50" onClick={() => onSave(() => removeMemberAction(t.id, m.slug), `${m.fullName} убран из команды`)}>
                                  Убрать
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-small text-muted">Участников пока нет.</p>
                      )}
                      {canEdit && addable.length ? <AddMember team={t} people={addable} onSave={onSave} /> : null}
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {t.active && t.id !== TOP_TEAM && (owner || leads.includes(t.id)) ? (
                          <button type="button" className="text-small text-blue-700 hover:underline" onClick={() => setRhythm(t)}>
                            Ритм weekly
                          </button>
                        ) : null}
                        {owner ? (
                          <button type="button" className="text-small text-blue-700 hover:underline" onClick={() => setEditing(t)}>
                            Изменить команду
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? <TeamModal team={editing} teams={teams} people={candidates} onClose={() => setEditing(null)} onSave={onSave} /> : null}
      {rhythm ? <RhythmModal team={rhythm} onClose={() => setRhythm(null)} onSave={onSave} /> : null}
    </>
  );
}

const WEEKDAY_OPTIONS = WEEKDAY_NAMES.map((d, i) => ({ value: String(i + 1), label: d.charAt(0).toUpperCase() + d.slice(1) }));

/** «Сдача: пятница, 16:00. Встреча: понедельник следующей недели, 11:00. Weekly сдают руководители» */
function rhythmText(t: TeamView): string {
  if (t.id === TOP_TEAM) return "Срок и встреча как у департамента. Weekly сдают все участники";
  const deadline = t.rhythm.deadline ? `Сдача: ${slotText(t.rhythm.deadline)}` : "Сдача как у департамента";
  const meeting = t.rhythm.meeting ? `встреча: ${slotText(t.rhythm.meeting)}` : "встреча как у департамента";
  return `${deadline}, ${meeting}. Weekly сдают ${t.rhythm.specialists ? "все участники" : "руководители команд, специалисты обновляют задачи"}`;
}

/** Светофор сдачи weekly за отчётную неделю (этап 15) */
function WeeklyLight({ weekly }: { weekly: TeamView["weekly"] }) {
  const done = weekly.submitted + weekly.late;
  if (weekly.expected === 0 && weekly.absent === 0) return <p className="mt-0.5 text-small text-muted">Weekly в этой команде не ждём</p>;
  const tone = done >= weekly.expected ? "bg-green" : weekly.passed ? "bg-danger" : "bg-amber";
  const word = done >= weekly.expected ? "все сдали" : weekly.passed ? "срок прошёл" : `срок ${deadlineText(weekly.deadline).replace("срок ", "")}`;
  return (
    <p className="mt-0.5 inline-flex items-center gap-2 text-small text-ink">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tone)} aria-hidden="true" />
      Weekly: сдали {done} из {weekly.expected}
      {weekly.late ? `, с опозданием ${weekly.late}` : ""}
      {weekly.absent ? `, нет на неделе ${weekly.absent}` : ""}
      <span className="text-muted">({word}{weekly.closed ? ", неделя закрыта" : ""})</span>
    </p>
  );
}

type SlotDraft = { own: boolean; week: "0" | "1"; weekday: string; time: string };
const draftOf = (slot: Slot | null, fallback: SlotDraft): SlotDraft => (slot ? { own: true, week: String(slot.week) as "0" | "1", weekday: String(slot.weekday), time: slot.time } : fallback);
const slotFrom = (d: SlotDraft): Slot | null => (d.own ? { week: Number(d.week) as 0 | 1, weekday: Number(d.weekday), time: d.time } : null);

/** Ритм weekly команды: срок сдачи, встреча и кто сдаёт. Задают руководитель команды, руководитель выше и владелец */
function RhythmModal({ team, onClose, onSave }: { team: TeamView; onClose: () => void; onSave: Runner }) {
  const [deadline, setDeadline] = useState<SlotDraft>(draftOf(team.rhythm.deadline, { own: false, week: "0", weekday: "5", time: "16:00" }));
  const [meeting, setMeeting] = useState<SlotDraft>(draftOf(team.rhythm.meeting, { own: false, week: "1", weekday: "1", time: "11:00" }));
  const [specialists, setSpecialists] = useState(team.rhythm.specialists);
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Ритм weekly: ${team.name}`} description="Срок сдачи команды не позже срока департамента: руководитель должен успеть собрать weekly команды и сдать свой">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(() => setTeamRhythmAction(team.id, { deadline: slotFrom(deadline), meeting: slotFrom(meeting), specialists }), "Ритм команды сохранён");
          onClose();
        }}
      >
        <SlotFields legend="Срок сдачи" id="rh-deadline" value={deadline} onChange={setDeadline} />
        <SlotFields legend="Встреча команды" id="rh-meeting" value={meeting} onChange={setMeeting} />
        <label className="flex items-start gap-3 text-body text-ink">
          <input type="checkbox" checked={specialists} onChange={(e) => setSpecialists(e.target.checked)} className="mt-1 h-4 w-4 accent-blue-700" />
          <span>
            Weekly сдают и специалисты
            <span className="block text-small text-muted">Выключено: weekly сдают только руководители команд, специалисты обновляют задачи</span>
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit">Сохранить</Button>
        </div>
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

function AddMember({ team, people, onSave }: { team: TeamView; people: Candidate[]; onSave: Runner }) {
  const [slug, setSlug] = useState("");
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!slug) return;
        const name = people.find((p) => p.slug === slug)?.fullName ?? slug;
        onSave(() => addMemberAction(team.id, slug), `${name} в команде`);
        setSlug("");
      }}
    >
      <SelectField
        label="Добавить участника"
        id={`add-${team.id}`}
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        options={[{ value: "", label: "Выберите человека" }, ...people.map((p) => ({ value: p.slug, label: p.position ? `${p.fullName}, ${p.position}` : p.fullName }))]}
        className="sm:w-80"
      />
      <Button size="sm" type="submit" disabled={!slug}>
        <Users className="h-4 w-4" aria-hidden="true" />
        Добавить
      </Button>
    </form>
  );
}

function TeamModal({ team, teams, people, onClose, onSave }: { team: TeamView; teams: TeamView[]; people: Candidate[]; onClose: () => void; onSave: Runner }) {
  const [name, setName] = useState(team.name);
  const [leader, setLeader] = useState(team.leader?.slug ?? "");
  const [parent, setParent] = useState(team.parentId ?? TOP_TEAM);
  const top = team.id === TOP_TEAM;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={team.name} description="Название, руководитель и команда уровнем выше, куда руководитель сдаёт weekly">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(() => updateTeamAction(team.id, { name, leader: leader || null, ...(top ? {} : { parent }) }), "Команда сохранена");
          onClose();
        }}
      >
        <TextInput label="Название" id="tm-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <SelectField label="Руководитель" id="tm-leader" value={leader} onChange={(e) => setLeader(e.target.value)} options={[...(top ? [] : [{ value: "", label: "Не назначен" }]), ...people.map((p) => ({ value: p.slug, label: p.fullName }))]} />
        {!top ? (
          <SelectField label="Команда выше" id="tm-parent" value={parent} onChange={(e) => setParent(e.target.value)} options={teams.filter((t) => t.id !== team.id).map((t) => ({ value: t.id, label: t.name }))} />
        ) : null}
        <div className="flex flex-wrap justify-between gap-2">
          {!top ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onSave(() => updateTeamAction(team.id, { active: !team.active }), team.active ? "Команда выключена" : "Команда включена");
                onClose();
              }}
            >
              {team.active ? "Выключить команду" : "Включить команду"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit">Сохранить</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function NewTeamModal({ open, onOpenChange, teams, people, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; teams: TeamView[]; people: Candidate[]; onSave: Runner }) {
  const [name, setName] = useState("");
  const [leader, setLeader] = useState("");
  const [parent, setParent] = useState(TOP_TEAM);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Новая команда" description="Например, проектная команда поверх подразделений. Участников добавите после">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(async () => {
            const r = await createTeamAction({ name, leader: leader || null, parent });
            return r.ok ? { ok: true } : r;
          }, `Команда «${name}» создана`);
          onOpenChange(false);
          setName("");
        }}
      >
        <TextInput label="Название" id="nt-team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <SelectField label="Руководитель" id="nt-team-leader" value={leader} onChange={(e) => setLeader(e.target.value)} options={[{ value: "", label: "Не назначен" }, ...people.map((p) => ({ value: p.slug, label: p.fullName }))]} />
        <SelectField label="Команда выше" id="nt-team-parent" value={parent} onChange={(e) => setParent(e.target.value)} options={teams.map((t) => ({ value: t.id, label: t.name }))} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            Создать команду
          </Button>
        </div>
      </form>
    </Modal>
  );
}
