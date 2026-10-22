"use client";

// Страница «Структура» (этап 14): подразделения департамента и команды руководителей.
// Владелец в режиме управления загружает структуру из таблицы, правит людей и подразделения.
// Этап 64: команды здесь только для просмотра, состав и настройки команд правятся на экране «Weekly-команды».

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Settings2, Upload } from "lucide-react";
import type { StructureView, TeamView, UnitView } from "@/lib/org/view";
import { usePrototype } from "@/domain/store";
import { cn } from "@/lib/cn";
import { Button, buttonClass } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Segmented, SelectField, TextInput } from "@/components/ui/primitives";
import { SearchPicker } from "@/components/ui/search-picker";
import { EmptyState } from "@/components/empty-state";
import { setPersonOrgAction, updateUnitAction } from "@/app/(app)/people/structure/actions";
import { StructureImport } from "./structure-import";
import { unitTitle } from "@/lib/org/tree-groups";
import { PeopleTreeView } from "./people-tree";
import type { PeopleTree } from "@/lib/org/people-tree";
import { WeeklyLine, rhythmText } from "@/components/teams/weekly-line";

type Candidate = { slug: string; fullName: string; position: string | null; unit?: string | null; own?: boolean };

export function StructureScreen({
  view,
  tree,
  owner,
  me,
  candidates,
  focus = null,
  toApprove = 0,
}: {
  view: StructureView;
  tree: PeopleTree;
  owner: boolean;
  me: string;
  candidates: Candidate[];
  /** Человек из адреса: дерево открывается на нём (этап 45) */
  focus?: string | null;
  /** Сколько запросов в команды ждут вашего согласия: решают на экране «Weekly-команды» (этап 64) */
  toApprove?: number;
}) {
  // Дерево подчинённых первым (этап 34): так смотрят структуру чаще всего. Пока руководители не заданы, первыми подразделения
  const [tab, setTab] = useState<"people" | "units" | "teams">(tree.loaded ? "people" : "units");
  const [importing, setImporting] = useState(false);
  const { notify } = usePrototype();
  const router = useRouter();
  const [, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) notify(r.error ?? "Не получилось", "error");
      else {
        notify(ok);
        router.refresh();
      }
    });

  // Пусто, пока под корнем (компанией или департаментом) нет ни одного подразделения
  const empty = view.units.filter((u) => u.depth > 0).length === 0;
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
        <div className="flex flex-wrap gap-2">
          {owner ? (
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              Загрузить структуру
            </Button>
          ) : null}
          <Link href="/people/teams" className={buttonClass("secondary", "sm")} data-testid="manage-teams">
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Управлять командами
          </Link>
        </div>
      </div>

      {toApprove ? (
        // Старые ссылки «Запрос в команду» вели сюда с якорем: отсюда одна ссылка на экран, где решают
        <p id="join-requests" className="sv-card sv-card--soft scroll-mt-24 p-4 text-body text-ink">
          Ваших сотрудников зовут в команды: {toApprove}.{" "}
          <Link href="/people/teams#join-requests" className="font-medium text-link hover:underline">
            Решить в «Weekly-командах»
          </Link>
        </p>
      ) : null}

      {tab === "people" ? (
        <PeopleTreeView key={focus ?? "start"} tree={tree} me={me} owner={owner} start={focus} />
      ) : tab === "units" ? (
        empty ? (
          <EmptyState title="Структура ещё не загружена">
            {owner ? "Загрузите лист структуры из таблицы: кнопка «Загрузить структуру» выше." : "Её загрузит владелец ресурса. Пока работают команды из раздела «Команды»."}
          </EmptyState>
        ) : (
          <UnitTree units={view.units} owner={owner} people={candidates} onSave={run} />
        )
      ) : (
        <TeamTree teams={view.teams} />
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
      <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft" aria-label="Подразделения">
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
                    {/* Вид подразделения не повторяется, если название с него начинается: «Департамент Департамент страхования» */}
                    {unitTitle({ name: u.name, kind: u.kind }).kind ? <span className="text-small text-muted">{u.kindLabel} </span> : null}
                    <span className="font-semibold">{u.name}</span>
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
                      {owner && u.depth > 0 ? (
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
        {/* Людей в компании сотни: выбор с поиском (этап 53). Пусто: не менять */}
        <SearchPicker label="Руководитель" id="po-manager" value={manager} onChange={setManager} options={[{ value: "-", label: "Нет руководителя" }, ...others]} placeholder="Не менять" />
        <SearchPicker label="Функциональный руководитель" id="po-functional" value={functional} onChange={setFunctional} options={[{ value: "-", label: "Нет" }, ...others]} placeholder="Не менять" hint="Видит задачи человека, но не управляет ими" />
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
        <SearchPicker label="Руководитель" id="un-head" value={head} onChange={setHead} options={people.map((p) => ({ value: p.slug, label: p.fullName, hint: p.position }))} placeholder="Не выделен" hint="Очистите поле, если руководитель не выделен" />
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

/** Команды деревом только для просмотра (этап 64): состав и настройки правятся на экране «Weekly-команды» */
function TeamTree({ teams }: { teams: TeamView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-muted">
        Команды компании деревом: кто куда сдаёт weekly. Состав, руководителя и срок weekly меняют на экране{" "}
        <Link href="/people/teams" className="font-medium text-link hover:underline">
          «Weekly-команды»
        </Link>
        .
      </p>
      <ul className="flex flex-col divide-y divide-line sv-card sv-card--soft" aria-label="Команды">
        {orderTeams(teams).map(({ team: t, depth }) => {
          const open = openId === t.id;
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
                  {t.active ? <WeeklyLine weekly={t.weekly} className="mt-0.5" /> : null}
                  {open ? (
                    <div className="mt-2 flex flex-col gap-2">
                      <p className="text-small text-muted">{rhythmText(t)}</p>
                      {t.members.length ? (
                        <ul className="flex flex-col gap-1">
                          {t.members.map((m) => (
                            <li key={m.slug} className="flex flex-wrap items-baseline gap-x-2 text-small">
                              <span className="text-ink">{m.fullName}</span>
                              {m.position ? <span className="text-muted">{m.position}</span> : null}
                              {m.external ? <span className="text-caption text-muted">из другой ветки</span> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-small text-muted">Участников пока нет.</p>
                      )}
                      {t.active ? (
                        <Link href={`/people/teams?team=${encodeURIComponent(t.id)}`} className="self-start text-small font-medium text-link hover:underline">
                          Карточка команды
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
