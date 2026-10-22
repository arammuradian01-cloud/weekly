"use client";

// «Собрать из структуры» (этап 57, с этапа 64 помощник внутри экрана «Weekly-команды», свёрнут по умолчанию).
// Готовые команды департаментов по структуре: руководитель перетаскивает к себе целое подразделение или отдельных
// людей. Люди из других веток входят после согласия своего непосредственного руководителя. Без мыши, с клавиатуры
// и на телефоне то же самое кнопкой «В команду» у строки. Главный путь теперь «Добавить участников» в карточке.

import { useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, GripVertical, Plus, UserPlus, Users } from "lucide-react";
import { addPeopleAction, createTeamAction } from "@/app/(app)/people/teams/actions";
import type { PickPerson, PickUnit, WeeklyTeam } from "@/lib/org/teams";
import { addSummary, sizeText, teamSearchKey, teamSize } from "@/lib/org/team-rights";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";
import { plural } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { TextInput } from "@/components/ui/primitives";
import { BATCH_MAX, NAME_MAX } from "./team-dialogs";

/** Перетаскиваемая область: долгое нажатие на телефоне не выделяет текст и не открывает системное меню */
const dragArea = "cursor-grab select-none [-webkit-touch-callout:none]";

type Drag = { kind: "unit"; id: string; label: string; count: number } | { kind: "person"; slug: string; label: string };
type Target = { kind: "new" } | { kind: "team"; id: string; name: string };
type Dialog = { target: Target; what: Drag };

const people = (n: number) => `${n} ${plural(n, "человек", "человека", "человек")}`;

/** Подразделения деревом: дети по родителю, люди по подразделению, сколько людей в ветке */
function useTree(units: PickUnit[], persons: PickPerson[]) {
  return useMemo(() => {
    const children = new Map<string | null, PickUnit[]>();
    for (const u of units) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u]);
    const byUnit = new Map<string, PickPerson[]>();
    for (const p of persons) if (p.unitId) byUnit.set(p.unitId, [...(byUnit.get(p.unitId) ?? []), p]);
    const count = new Map<string, number>();
    const walk = (id: string, seen: Set<string>): number => {
      if (count.has(id)) return count.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const n = (byUnit.get(id)?.length ?? 0) + (children.get(id) ?? []).reduce((s, c) => s + walk(c.id, seen), 0);
      count.set(id, n);
      return n;
    };
    for (const u of units) walk(u.id, new Set());
    const bySlug = new Map(persons.map((p) => [p.slug, p]));
    const company = units.find((u) => u.kind === "COMPANY");
    // Готовые команды: департаменты и подразделения прямо под компанией; без компании: верхние подразделения
    const ready = company ? (children.get(company.id) ?? []) : (children.get(null) ?? []);
    return { children, byUnit, count, ready, bySlug };
  }, [units, persons]);
}

/** Ручка перетаскивания: на телефоне тянут долгим нажатием, обычное движение пальцем прокручивает список */
function Grip() {
  return <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-icon" aria-hidden="true" />;
}

/** Куда добавить без перетаскивания: команды, которые человек собирает, и новая команда */
function AddMenu({ targets, canCreate, onPick, subject }: { targets: WeeklyTeam[]; canCreate: boolean; onPick: (target: Target) => void; subject: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={buttonClass("secondary", "sm", "shrink-0 gap-1.5")} aria-label={`${subject}: добавить в команду`} onPointerDown={(e) => e.stopPropagation()}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        <span aria-hidden="true">В команду</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-50 max-h-80 min-w-56 overflow-y-auto rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
          <Menu.Label className="sv-menu__group">В команду</Menu.Label>
          {targets.map((t) => (
            <Menu.Item key={t.id} onSelect={() => onPick({ kind: "team", id: t.id, name: t.name })} className="sv-menu__item cursor-pointer select-none outline-none">
              {t.name}
            </Menu.Item>
          ))}
          {canCreate ? (
            <Menu.Item onSelect={() => onPick({ kind: "new" })} className="sv-menu__item cursor-pointer select-none font-medium text-blue-700 outline-none">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Новая команда
            </Menu.Item>
          ) : null}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

type Pick = (target: Target, what: Drag) => void;
type Where = { targets: WeeklyTeam[]; canCreate: boolean; onPick: Pick; me: string };

function PersonChip({ person, where }: { person: PickPerson; where: Where }) {
  // Себя в свою команду не добавляют: руководитель в ней и так
  const canDrag = person.slug !== where.me;
  const drag: Drag = { kind: "person", slug: person.slug, label: person.fullName };
  // Без клавиатурного перетаскивания: с клавиатуры и экранным диктором добавляют кнопкой «В команду»
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: `p:${person.slug}`, data: drag, disabled: !canDrag });
  return (
    <li className={cn("flex items-center justify-between gap-2 rounded-control px-2 py-1.5 hover:bg-field", isDragging && "opacity-40")} data-testid={`person-${person.slug}`}>
      <span ref={setNodeRef} {...(canDrag ? listeners : {})} data-testid={`drag-person-${person.slug}`} className={cn("flex min-w-0 flex-1 items-center gap-2", canDrag && dragArea)}>
        {canDrag ? <Grip /> : null}
        <span className="min-w-0">
          <span className="block text-small text-ink">{person.fullName}</span>
          {person.position ? <span className="block truncate text-caption text-muted">{person.position}</span> : null}
        </span>
      </span>
      {canDrag ? <AddMenu targets={where.targets} canCreate={where.canCreate} subject={person.fullName} onPick={(t) => where.onPick(t, drag)} /> : null}
    </li>
  );
}

/** Подразделение: строка тянется целиком (вся ветка), раскрывается в людей и подразделения ниже. В поиске без раскрытия:
 * найденные люди идут отдельным списком, и один человек не появляется на экране дважды */
function UnitNode({ unit, depth, tree, where, open, toggle, leaf = false }: { unit: PickUnit; depth: number; tree: ReturnType<typeof useTree>; where: Where; open: Set<string>; toggle: (id: string) => void; leaf?: boolean }) {
  const count = tree.count.get(unit.id) ?? 0;
  const draggable = count > 0 && unit.kind !== "COMPANY";
  const drag: Drag = { kind: "unit", id: unit.id, label: unit.name, count };
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: `u:${unit.id}`, data: drag, disabled: !draggable });
  const expanded = !leaf && open.has(unit.id);
  const kids = tree.children.get(unit.id) ?? [];
  const persons = tree.byUnit.get(unit.id) ?? [];
  const head = unit.head ? (tree.bySlug.get(unit.head) ?? null) : null;
  const Wrapper = depth === 0 ? "article" : "div";
  const caption = (
    <span className="block text-caption text-muted">
      {head ? `${head.fullName}, ` : ""}
      {people(count)}
    </span>
  );
  return (
    <Wrapper className={cn(depth === 0 ? "sv-card bg-surface p-3" : "border-l border-line pl-3", isDragging && "opacity-40")} data-testid={`unit-${unit.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div ref={setNodeRef} {...(draggable ? listeners : {})} data-testid={`drag-unit-${unit.id}`} className={cn("flex min-w-0 flex-1 items-center gap-2", draggable && dragArea)}>
          {draggable ? <Grip /> : null}
          {leaf ? (
            <span className="min-w-0">
              <span className="block text-small font-medium text-ink">{unit.name}</span>
              {caption}
            </span>
          ) : (
            <button type="button" onClick={() => toggle(unit.id)} aria-expanded={expanded} className="flex min-h-9 min-w-0 items-center gap-1.5 rounded-control text-left">
              {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-icon" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0 text-icon" aria-hidden="true" />}
              <span className="min-w-0">
                <span className={cn("block text-ink", depth === 0 ? "text-body font-semibold" : "text-small font-medium")}>{unit.name}</span>
                {caption}
              </span>
            </button>
          )}
        </div>
        {draggable ? <AddMenu targets={where.targets} canCreate={where.canCreate} subject={`${unit.name}, ${people(count)}`} onPick={(t) => where.onPick(t, drag)} /> : null}
      </div>
      {expanded ? (
        <div className="mt-2 flex flex-col gap-2">
          {persons.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {persons.map((p) => (
                <PersonChip key={p.slug} person={p} where={where} />
              ))}
            </ul>
          ) : null}
          {kids.map((k) => (
            <UnitNode key={k.id} unit={k} depth={depth + 1} tree={tree} where={where} open={open} toggle={toggle} />
          ))}
        </div>
      ) : null}
    </Wrapper>
  );
}

/** Карточка команды, куда можно бросить подразделение или человека */
function TargetCard({ team }: { team: WeeklyTeam }) {
  const { setNodeRef, isOver } = useDroppable({ id: `t:${team.id}` });
  return (
    <section ref={setNodeRef} aria-labelledby={`as-${team.id}`} className={cn("sv-card bg-surface p-3 transition-shadow", isOver && "ring-2 ring-blue")} data-testid={`assemble-target-${team.id}`}>
      <h3 id={`as-${team.id}`} className="flex items-center gap-2 text-body font-semibold text-ink">
        <Users className="h-4 w-4 shrink-0 text-icon" aria-hidden="true" />
        {team.name}
      </h3>
      <p className="mt-0.5 text-caption text-muted">
        {sizeText(teamSize(team))}
        {team.waiting.length ? `, ждут согласия ${team.waiting.length}` : ""}
      </p>
    </section>
  );
}

function NewTeamZone({ onClick }: { onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "new" });
  return (
    <button ref={setNodeRef} type="button" onClick={onClick} className={cn("flex w-full items-center justify-center gap-2 rounded-panel border border-dashed border-border-strong p-4 text-small font-medium text-blue-700 hover:bg-field", isOver && "bg-blue-soft ring-2 ring-blue")} data-testid="assemble-new">
      <Plus className="h-4 w-4" aria-hidden="true" />
      Новая команда: перетащите сюда подразделение
    </button>
  );
}

/** Озвучка перетаскивания для экранного диктора по-русски, с именами, а не внутренними номерами */
function announcements(label: (id: string | number) => string, target: (id: string | number | undefined) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Взяли: ${label(active.id)}`,
    onDragOver: ({ active, over }) => (over ? `${label(active.id)} над: ${target(over.id)}` : `${label(active.id)} вне команд`),
    onDragEnd: ({ active, over }) => (over ? `${label(active.id)} отпущено в: ${target(over.id)}` : `${label(active.id)} отпущено вне команд`),
    onDragCancel: ({ active }) => `Перетаскивание отменено: ${label(active.id)}`,
  };
}

export function StructureAssembler({
  units,
  persons,
  targets,
  canCreate,
  direct,
  me,
  onCreateEmpty,
  onDone,
}: {
  units: PickUnit[];
  persons: PickPerson[];
  /** Команды, куда этот человек может добавлять людей */
  targets: WeeklyTeam[];
  canCreate: boolean;
  /** Режим управления владельца: люди других веток входят сразу */
  direct: boolean;
  me: string;
  /** «Новая команда» без людей: обычное окно создания */
  onCreateEmpty: () => void;
  /** После добавления: открыть карточку этой команды */
  onDone: (teamId: string) => void;
}) {
  const run = useRunWeekly();
  const { notify } = usePrototype();
  const tree = useTree(units, persons);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Окно, для которого идёт сохранение: запоздалый ответ не закрывает следующее окно
  const pendingRef = useRef<Dialog | null>(null);
  // Мышь и палец отдельно: пальцем перетаскивание начинается долгим нажатием, свайп прокручивает страницу
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ask: Pick = (target, what) => {
    setName(target.kind === "new" ? (what.kind === "unit" ? `Weekly: ${what.label}` : "Моя weekly-команда").slice(0, NAME_MAX) : "");
    setDialog({ target, what });
  };

  const confirm = async () => {
    const d = dialog;
    if (!d || busy) return;
    setBusy(true);
    pendingRef.current = d;
    const who = d.what.kind === "unit" ? { unit: d.what.id } : { slugs: [d.what.slug] };
    let doneId: string | null = null;
    if (d.target.kind === "new") {
      const r = await run(() => createTeamAction(name, who));
      if (r) {
        notify(addSummary(r.name, r.result));
        doneId = r.id;
      }
    } else {
      const target = d.target;
      const r = await run(() => addPeopleAction(target.id, who));
      if (r) {
        notify(addSummary(target.name, r));
        doneId = target.id;
      }
    }
    setBusy(false);
    // Удалось: окно закрывается и открывается карточка команды. Не удалось: окно остаётся, причина в уведомлении
    if (doneId && pendingRef.current === d) {
      setDialog((cur) => (cur === d ? null : cur));
      onDone(doneId);
    }
    pendingRef.current = null;
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as Drag) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const what = e.active.data.current as Drag | undefined;
    if (!what || !e.over) return;
    const overId = String(e.over.id);
    if (overId === "new") return ask({ kind: "new" }, what);
    const team = targets.find((t) => `t:${t.id}` === overId);
    if (team) ask({ kind: "team", id: team.id, name: team.name }, what);
  };

  // Поиск: люди и подразделения по имени, плоским списком
  const q = teamSearchKey(query);
  const foundPeople = q ? persons.filter((p) => teamSearchKey(`${p.fullName} ${p.position ?? ""}`).includes(q)).slice(0, 40) : [];
  const foundUnits = q ? units.filter((u) => u.kind !== "COMPANY" && teamSearchKey(u.name).includes(q)).slice(0, 20) : [];

  const labelOf = (id: string | number) => {
    const s = String(id);
    if (s.startsWith("p:")) return tree.bySlug.get(s.slice(2))?.fullName ?? "человек";
    const unit = units.find((u) => `u:${u.id}` === s);
    return unit ? `${unit.name}, ${people(tree.count.get(unit.id) ?? 0)}` : "подразделение";
  };
  const targetOf = (id: string | number | undefined) => (id === "new" ? "новая команда" : `команда «${targets.find((t) => `t:${t.id}` === String(id))?.name ?? ""}»`);
  const where: Where = { targets, canCreate, onPick: ask, me };

  const rule = direct ? "В режиме управления люди других веток входят сразу, их руководители получат событие." : "Люди ветки руководителя команды войдут сразу, из других веток после согласия их непосредственного руководителя.";
  const what = dialog?.what ?? null;
  const tooBig = what?.kind === "unit" && what.count > BATCH_MAX;
  const addText = !what
    ? ""
    : what.kind === "unit"
      ? tooBig
        ? `В «${what.label}» ${people(what.count)}, за раз можно добавить до ${BATCH_MAX}: выберите подразделение поменьше.`
        : `${people(what.count)} из «${what.label}». ${rule}`
      : `${what.label}. ${rule}`;
  const isNew = dialog?.target.kind === "new";
  const title = !dialog ? "" : dialog.target.kind === "new" ? "Новая weekly-команда" : `В команду «${dialog.target.name}»`;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)} accessibility={{ announcements: announcements(labelOf, targetOf) }}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <section aria-labelledby="ready-teams" className="flex min-w-0 flex-col gap-3">
          <div>
            <h3 id="ready-teams" className="text-title-sm font-semibold text-ink">
              Готовые команды по структуре
            </h3>
            <p className="mt-1 max-w-[72ch] text-small text-muted">
              {!persons.length
                ? "Структура компании ещё не загружена: подразделения появятся после загрузки владельцем."
                : "Перетащите департамент, подразделение или человека в команду справа либо нажмите «В команду» у строки."}
            </p>
          </div>
          {persons.length ? <TextInput label="Найти человека или подразделение" id="assemble-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фамилия, должность или название" /> : null}
          {q ? (
            <div className="sv-card bg-surface p-3" data-testid="assemble-found">
              {!foundPeople.length && !foundUnits.length ? <p className="text-small text-muted">Никого не нашли: проверьте написание</p> : null}
              {foundUnits.length ? (
                <div className="flex flex-col gap-2">
                  {foundUnits.map((u) => (
                    <UnitNode key={u.id} unit={u} depth={1} tree={tree} where={where} open={open} toggle={toggle} leaf />
                  ))}
                </div>
              ) : null}
              {foundPeople.length ? (
                <ul className="m-0 mt-2 flex list-none flex-col p-0">
                  {foundPeople.map((p) => (
                    <PersonChip key={p.slug} person={p} where={where} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3" data-testid="ready-teams">
              {tree.ready.map((u) => (
                <UnitNode key={u.id} unit={u} depth={0} tree={tree} where={where} open={open} toggle={toggle} />
              ))}
            </div>
          )}
        </section>

        <aside aria-labelledby="assemble-targets" className="flex flex-col gap-3 self-start lg:sticky lg:top-20">
          <h3 id="assemble-targets" className="text-title-sm font-semibold text-ink">
            Куда добавить
          </h3>
          {targets.map((t) => (
            <TargetCard key={t.id} team={t} />
          ))}
          {canCreate ? <NewTeamZone onClick={onCreateEmpty} /> : null}
        </aside>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="sv-card max-w-72 bg-surface px-3 py-2 text-small font-medium text-ink shadow-medium">
            {dragging.label}
            {dragging.kind === "unit" ? <span className="block text-caption text-muted">{people(dragging.count)}</span> : null}
          </div>
        ) : null}
      </DragOverlay>

      <Modal open={!!dialog} onOpenChange={(v) => !v && !busy && setDialog(null)} title={title} description={addText}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
          className="flex flex-col gap-4"
        >
          {isNew ? <TextInput label="Название команды" id="assemble-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoFocus /> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setDialog(null)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy || tooBig || (isNew && !name.trim())} loading={busy}>
              {isNew ? "Создать команду" : "Добавить"}
            </Button>
          </div>
        </form>
      </Modal>
    </DndContext>
  );
}
