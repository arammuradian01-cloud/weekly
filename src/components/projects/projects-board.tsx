"use client";

// Weekly-проекты (этап 57). Решение Арама 21.10: готовые команды департаментов собраны по структуре, руководитель
// перетаскивает к себе целую команду или отдельных людей, чтобы вести свой weekly-проект. Люди из других веток
// входят после согласия своего непосредственного руководителя. Без мыши, с клавиатуры и на телефоне то же самое
// кнопкой «В проект» у строки.

import { useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Plus, UserPlus, Users, X } from "lucide-react";
import { addToProjectAction, cancelProjectRequestAction, closeProjectAction, createProjectAction, removeFromProjectAction, renameProjectAction } from "@/app/(app)/people/projects/actions";
import type { AddPeopleResult, ProjectPerson, ProjectUnit, ProjectView, ProjectsView } from "@/lib/org/projects";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";
import { plural } from "@/domain/dates";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { TextInput } from "@/components/ui/primitives";
import { searchKey } from "@/components/ui/search-picker";

const NAME_MAX = 120;

type Drag = { kind: "unit"; id: string; label: string; count: number } | { kind: "person"; slug: string; label: string };
type Target = { kind: "new" } | { kind: "project"; id: string; name: string };
type Dialog =
  | { kind: "add"; target: Target; what: Drag | null }
  | { kind: "rename"; project: ProjectView }
  | { kind: "close"; project: ProjectView };

const people = (n: number) => `${n} ${plural(n, "человек", "человека", "человек")}`;

/** Подразделения деревом: дети по родителю, люди по подразделению, сколько людей в ветке */
function useTree(units: ProjectUnit[], persons: ProjectPerson[]) {
  return useMemo(() => {
    const children = new Map<string | null, ProjectUnit[]>();
    for (const u of units) children.set(u.parentId, [...(children.get(u.parentId) ?? []), u]);
    const byUnit = new Map<string, ProjectPerson[]>();
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

/** Куда добавить без перетаскивания: свои проекты и новый проект */
function AddMenu({ projects, onPick, subject }: { projects: ProjectView[]; onPick: (target: Target) => void; subject: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={buttonClass("secondary", "sm", "shrink-0 gap-1.5")} aria-label={`${subject}: добавить в проект`} onPointerDown={(e) => e.stopPropagation()}>
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        <span aria-hidden="true">В проект</span>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="end" sideOffset={4} className="z-50 max-h-80 min-w-56 overflow-y-auto rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
          <Menu.Label className="sv-menu__group">В проект</Menu.Label>
          {projects.map((p) => (
            <Menu.Item key={p.id} onSelect={() => onPick({ kind: "project", id: p.id, name: p.name })} className="sv-menu__item cursor-pointer select-none outline-none data-[highlighted]:bg-field">
              {p.name}
            </Menu.Item>
          ))}
          <Menu.Item onSelect={() => onPick({ kind: "new" })} className="sv-menu__item cursor-pointer select-none font-medium text-blue-700 outline-none data-[highlighted]:bg-field">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Новый проект
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

type Pick = (target: Target, what: Drag) => void;

function PersonChip({ person, canDrag: canDragAll, projects, onPick, me }: { person: ProjectPerson; canDrag: boolean; projects: ProjectView[]; onPick: Pick; me: string }) {
  // Себя в свой проект не добавляют: руководитель в нём и так
  const canDrag = canDragAll && person.slug !== me;
  const drag: Drag = { kind: "person", slug: person.slug, label: person.fullName };
  // Без клавиатурного перетаскивания: с клавиатуры и экранным диктором добавляют кнопкой «В проект»
  const { listeners, setNodeRef, isDragging } = useDraggable({ id: `p:${person.slug}`, data: drag, disabled: !canDrag });
  return (
    <li className={cn("flex items-center justify-between gap-2 rounded-control px-2 py-1.5 hover:bg-field", isDragging && "opacity-40")} data-testid={`person-${person.slug}`}>
      <span ref={setNodeRef} {...(canDrag ? listeners : {})} data-testid={`drag-person-${person.slug}`} className={cn("flex min-w-0 flex-1 items-center gap-2", canDrag && "cursor-grab")}>
        {canDrag ? <Grip /> : null}
        <span className="min-w-0">
          <span className="block text-small text-ink">{person.fullName}</span>
          {person.position ? <span className="block truncate text-caption text-muted">{person.position}</span> : null}
        </span>
      </span>
      {canDrag ? <AddMenu projects={projects} subject={person.fullName} onPick={(t) => onPick(t, drag)} /> : null}
    </li>
  );
}

/** Подразделение: строка тянется целиком (вся ветка), раскрывается в людей и подразделения ниже. В поиске без раскрытия:
 * найденные люди идут отдельным списком, и один человек не появляется на экране дважды */
function UnitNode({ unit, depth, tree, canDrag, projects, onPick, open, toggle, me, leaf = false }: { unit: ProjectUnit; depth: number; tree: ReturnType<typeof useTree>; canDrag: boolean; projects: ProjectView[]; onPick: Pick; open: Set<string>; toggle: (id: string) => void; me: string; leaf?: boolean }) {
  const count = tree.count.get(unit.id) ?? 0;
  const draggable = canDrag && count > 0 && unit.kind !== "COMPANY";
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
        <div ref={setNodeRef} {...(draggable ? listeners : {})} data-testid={`drag-unit-${unit.id}`} className={cn("flex min-w-0 flex-1 items-center gap-2", draggable && "cursor-grab")}>
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
        {draggable ? <AddMenu projects={projects} subject={`${unit.name}, ${people(count)}`} onPick={(t) => onPick(t, drag)} /> : null}
      </div>
      {expanded ? (
        <div className="mt-2 flex flex-col gap-2">
          {persons.length ? (
            <ul className="m-0 flex list-none flex-col p-0">
              {persons.map((p) => (
                <PersonChip key={p.slug} person={p} canDrag={canDrag} projects={projects} onPick={onPick} me={me} />
              ))}
            </ul>
          ) : null}
          {kids.map((k) => (
            <UnitNode key={k.id} unit={k} depth={depth + 1} tree={tree} canDrag={canDrag} projects={projects} onPick={onPick} open={open} toggle={toggle} me={me} />
          ))}
        </div>
      ) : null}
    </Wrapper>
  );
}

function ProjectCard({ project, busy, onRemove, onCancel, onRename, onClose }: { project: ProjectView; busy: boolean; onRemove: (slug: string, name: string) => void; onCancel: (id: string, name: string) => void; onRename: () => void; onClose: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `t:${project.id}` });
  const [all, setAll] = useState(false);
  const shown = all ? project.members : project.members.slice(0, 8);
  return (
    <section ref={setNodeRef} aria-labelledby={`pr-${project.id}`} className={cn("sv-card bg-surface p-3 transition-shadow", isOver && "ring-2 ring-blue")} data-testid={`project-${project.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`pr-${project.id}`} className="flex items-center gap-2 text-body font-semibold text-ink">
            <Users className="h-4 w-4 shrink-0 text-icon" aria-hidden="true" />
            {project.name}
          </h3>
          <p className="mt-0.5 text-caption text-muted">
            {project.members.length} {plural(project.members.length, "участник", "участника", "участников")}
            {project.waiting.length ? `, ждут согласия ${project.waiting.length}` : ""}
            {project.kind === "UNIT" ? ", команда по структуре" : ""}
          </p>
        </div>
        {project.kind === "CUSTOM" ? (
          <Menu.Root>
            <Menu.Trigger className="sv-icon-btn shrink-0" aria-label={`Проект «${project.name}»: действия`}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" sideOffset={4} className="z-50 min-w-48 rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
                <Menu.Item onSelect={onRename} className="sv-menu__item cursor-pointer select-none outline-none data-[highlighted]:bg-field">
                  Переименовать
                </Menu.Item>
                <Menu.Item onSelect={onClose} className="sv-menu__item cursor-pointer select-none text-danger-ink outline-none data-[highlighted]:bg-field">
                  Закрыть проект
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        ) : null}
      </div>
      {project.members.length ? (
        <ul className="m-0 mt-2 flex list-none flex-wrap gap-1.5 p-0">
          {shown.map((m) => (
            <li key={m.slug} className="inline-flex items-center gap-0.5 rounded-full bg-field py-0.5 pl-2.5 pr-0.5 text-caption text-ink">
              {m.fullName}
              {m.external ? <span className="text-muted">, другая ветка</span> : null}
              <button type="button" disabled={busy} onClick={() => onRemove(m.slug, m.fullName)} className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink" aria-label={`Убрать из проекта «${project.name}»: ${m.fullName}`}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
          {project.members.length > shown.length ? (
            <li>
              <button type="button" onClick={() => setAll(true)} className="min-h-6 text-caption font-medium text-blue-700 hover:underline">
                Ещё {project.members.length - shown.length}
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-2 rounded-control-lg border border-dashed border-line p-3 text-small text-muted">Перетащите сюда команду или людей либо нажмите «В проект» у строки</p>
      )}
      {project.waiting.length ? (
        <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 p-0 text-caption text-muted" aria-label="Ждут согласия руководителя">
          {project.waiting.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2">
              <span>
                {w.fullName}: ждёт согласия, {w.approver}
              </span>
              <button type="button" disabled={busy} onClick={() => onCancel(w.id, w.fullName)} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-field hover:text-ink" aria-label={`Отменить запрос: ${w.fullName}`}>
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function NewProjectZone({ onClick }: { onClick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: "new" });
  return (
    <button ref={setNodeRef} type="button" onClick={onClick} className={cn("flex w-full items-center justify-center gap-2 rounded-panel border border-dashed border-border-strong p-4 text-small font-medium text-blue-700 hover:bg-field", isOver && "bg-blue-soft ring-2 ring-blue")} data-testid="project-new">
      <Plus className="h-4 w-4" aria-hidden="true" />
      Новый проект: перетащите сюда команду или нажмите
    </button>
  );
}

function summary(name: string, r: AddPeopleResult | null): string {
  if (!r) return `Проект «${name}» создан`;
  const parts = [`добавлено ${r.added.length}`];
  if (r.requested.length) parts.push(`ждут согласия руководителя ${r.requested.length}`);
  if (r.already.length) parts.push(`уже были в проекте или ждут согласия ${r.already.length}`);
  if (r.skipped.length) parts.push(`не добавлено ${r.skipped.length}: ${r.skipped.slice(0, 2).map((s) => s.reason).join("; ")}`);
  return `Проект «${name}»: ${parts.join(", ")}`;
}

/** Озвучка перетаскивания для экранного диктора по-русски, с именами, а не внутренними номерами */
function announcements(label: (id: string | number) => string, target: (id: string | number | undefined) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Взяли: ${label(active.id)}`,
    onDragOver: ({ active, over }) => (over ? `${label(active.id)} над: ${target(over.id)}` : `${label(active.id)} вне проектов`),
    onDragEnd: ({ active, over }) => (over ? `${label(active.id)} отпущено в: ${target(over.id)}` : `${label(active.id)} отпущено вне проектов`),
    onDragCancel: ({ active }) => `Перетаскивание отменено: ${label(active.id)}`,
  };
}

export function ProjectsBoard({ view }: { view: ProjectsView }) {
  const run = useRunWeekly();
  const { notify } = usePrototype();
  const tree = useTree(view.units, view.people);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Окно, для которого идёт сохранение: запоздалый ответ не закрывает следующее окно
  const pendingRef = useRef<Dialog | null>(null);
  const canDrag = view.canCreate;
  // Мышь и палец отдельно: пальцем перетаскивание начинается долгим нажатием, свайп прокручивает страницу
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));

  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ask = (target: Target, what: Drag | null) => {
    setName(target.kind === "new" ? (what?.kind === "unit" ? `Weekly: ${what.label}` : "Мой weekly-проект").slice(0, NAME_MAX) : "");
    setDialog({ kind: "add", target, what });
  };

  const finish = (d: Dialog) => {
    setBusy(false);
    if (pendingRef.current === d) setDialog((cur) => (cur === d ? null : cur));
    pendingRef.current = null;
  };

  const confirm = async () => {
    const d = dialog;
    if (!d || busy) return;
    setBusy(true);
    pendingRef.current = d;
    if (d.kind === "add") {
      const who = !d.what ? null : d.what.kind === "unit" ? { unit: d.what.id } : { slugs: [d.what.slug] };
      if (d.target.kind === "new") {
        const r = await run(() => createProjectAction(name, who));
        if (r) notify(summary(r.name, r.result));
      } else if (who) {
        const target = d.target;
        const r = await run(() => addToProjectAction(target.id, who));
        if (r) notify(summary(target.name, r));
      }
    } else if (d.kind === "rename") {
      await run(() => renameProjectAction(d.project.id, name), "Проект переименован");
    } else {
      await run(() => closeProjectAction(d.project.id), `Проект «${d.project.name}» закрыт`);
    }
    finish(d);
  };

  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current as Drag) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const what = e.active.data.current as Drag | undefined;
    if (!what || !e.over) return;
    const overId = String(e.over.id);
    if (overId === "new") return ask({ kind: "new" }, what);
    const project = view.projects.find((p) => `t:${p.id}` === overId);
    if (project) ask({ kind: "project", id: project.id, name: project.name }, what);
  };

  const remove = async (teamId: string, slug: string, fullName: string) => {
    setBusy(true);
    await run(() => removeFromProjectAction(teamId, slug), `${fullName} убран из проекта`);
    setBusy(false);
  };
  const cancel = async (requestId: string, fullName: string) => {
    setBusy(true);
    await run(() => cancelProjectRequestAction(requestId), `Запрос отменён: ${fullName}`);
    setBusy(false);
  };

  // Поиск: люди и подразделения по имени, плоским списком
  const q = searchKey(query);
  const foundPeople = q ? view.people.filter((p) => searchKey(`${p.fullName} ${p.position ?? ""}`).includes(q)).slice(0, 40) : [];
  const foundUnits = q ? view.units.filter((u) => u.kind !== "COMPANY" && searchKey(u.name).includes(q)).slice(0, 20) : [];

  const labelOf = (id: string | number) => {
    const s = String(id);
    if (s.startsWith("p:")) return tree.bySlug.get(s.slice(2))?.fullName ?? "человек";
    const unit = view.units.find((u) => `u:${u.id}` === s);
    return unit ? `${unit.name}, ${people(tree.count.get(unit.id) ?? 0)}` : "команда";
  };
  const targetOf = (id: string | number | undefined) => (id === "new" ? "новый проект" : `проект «${view.projects.find((p) => `t:${p.id}` === String(id))?.name ?? ""}»`);

  const rule = view.direct ? "В режиме управления люди других веток входят сразу, их руководители получат событие." : "Люди вашей ветки войдут сразу, из других веток после согласия их непосредственного руководителя.";
  const add = dialog?.kind === "add" ? dialog : null;
  const what = add?.what ?? null;
  const addText = !what ? "Проект появится у вас со своим weekly и задачами. Людей добавите перетаскиванием или кнопкой «В проект»." : what.kind === "unit" ? `${people(what.count)} из «${what.label}». ${rule}` : `${what.label}. ${rule}`;
  const title = !dialog ? "" : dialog.kind === "rename" ? "Название проекта" : dialog.kind === "close" ? `Закрыть проект «${dialog.project.name}»?` : dialog.target.kind === "new" ? "Новый weekly-проект" : `В проект «${dialog.target.name}»`;
  const description = !dialog ? "" : dialog.kind === "rename" ? "Название видно в переключателе команд, в weekly и задачах." : dialog.kind === "close" ? "Проект пропадёт из переключателя команд, ожидающие запросы отменятся. Закрыть можно, когда в нём нет открытых задач." : addText;
  const needsName = dialog?.kind === "rename" || (dialog?.kind === "add" && dialog.target.kind === "new");

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)} accessibility={{ announcements: announcements(labelOf, targetOf), screenReaderInstructions: { draggable: "Чтобы добавить без перетаскивания, нажмите кнопку «В проект» рядом." } }}>
      <div className={cn("grid gap-6", canDrag && "lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]")}>
        <section aria-labelledby="ready-teams" className="flex min-w-0 flex-col gap-3">
          <div>
            <h2 id="ready-teams" className="text-title font-semibold text-ink">
              Готовые команды по структуре
            </h2>
            <p className="mt-1 max-w-[72ch] text-small text-muted">
              {!view.people.length
                ? "Структура компании ещё не загружена: команды появятся после загрузки владельцем."
                : canDrag
                  ? "Перетащите департамент, подразделение или человека в карточку своего проекта в «Моих weekly-проектах» либо нажмите «В проект» у строки. Люди из других веток войдут после согласия их непосредственного руководителя."
                  : "Собирать weekly-проекты могут руководители, войдя лично."}
            </p>
          </div>
          {view.people.length ? <TextInput label="Найти человека или подразделение" id="projects-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Фамилия, должность или название" /> : null}
          {q ? (
            <div className="sv-card bg-surface p-3" data-testid="projects-found">
              {!foundPeople.length && !foundUnits.length ? <p className="text-small text-muted">Никого не нашли: проверьте написание</p> : null}
              {foundUnits.length ? (
                <div className="flex flex-col gap-2">
                  {foundUnits.map((u) => (
                    <UnitNode key={u.id} unit={u} depth={1} tree={tree} canDrag={canDrag} projects={view.projects} onPick={ask} open={open} toggle={toggle} me={view.me} leaf />
                  ))}
                </div>
              ) : null}
              {foundPeople.length ? (
                <ul className="m-0 mt-2 flex list-none flex-col p-0">
                  {foundPeople.map((p) => (
                    <PersonChip key={p.slug} person={p} canDrag={canDrag} projects={view.projects} onPick={ask} me={view.me} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3" data-testid="ready-teams">
              {tree.ready.map((u) => (
                <UnitNode key={u.id} unit={u} depth={0} tree={tree} canDrag={canDrag} projects={view.projects} onPick={ask} open={open} toggle={toggle} me={view.me} />
              ))}
            </div>
          )}
        </section>

        {canDrag || view.projects.length ? (
          <aside aria-labelledby="my-projects" className="flex flex-col gap-3 self-start lg:sticky lg:top-20">
            <h2 id="my-projects" className="text-title font-semibold text-ink">
              Мои weekly-проекты
            </h2>
            {view.projects.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                busy={busy}
                onRemove={(slug, fullName) => void remove(p.id, slug, fullName)}
                onCancel={(id, fullName) => void cancel(id, fullName)}
                onRename={() => {
                  setName(p.name);
                  setDialog({ kind: "rename", project: p });
                }}
                onClose={() => setDialog({ kind: "close", project: p })}
              />
            ))}
            {canDrag ? <NewProjectZone onClick={() => ask({ kind: "new" }, null)} /> : null}
          </aside>
        ) : null}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="sv-card max-w-72 bg-surface px-3 py-2 text-small font-medium text-ink shadow-medium">
            {dragging.label}
            {dragging.kind === "unit" ? <span className="block text-caption text-muted">{people(dragging.count)}</span> : null}
          </div>
        ) : null}
      </DragOverlay>

      <Modal open={!!dialog} onOpenChange={(v) => !v && !busy && setDialog(null)} title={title} description={description}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
          className="mt-4 flex flex-col gap-4"
        >
          {needsName ? <TextInput label="Название проекта" id="project-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoFocus /> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setDialog(null)}>
              Отмена
            </Button>
            <Button type="submit" variant={dialog?.kind === "close" ? "danger" : undefined} disabled={busy || (needsName && !name.trim())}>
              {busy ? "Сохраняем" : dialog?.kind === "rename" ? "Сохранить" : dialog?.kind === "close" ? "Закрыть проект" : add?.target.kind === "new" ? "Создать проект" : "Добавить"}
            </Button>
          </div>
        </form>
      </Modal>
    </DndContext>
  );
}
