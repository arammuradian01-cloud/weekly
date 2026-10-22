"use client";

// Дерево подчинённых (этап 34). Схема: человек в центре с руководителем и путём до верха, под ним прямые подчинённые
// карточками, разложенные по отделам и секторам его ветки (этап 57), нажатие спускает на уровень ниже. Список: всё дерево с отступами, сворачивается по веткам. Поиск по
// имени и должности открывает человека на схеме

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { PeopleTree, TreePerson } from "@/lib/org/people-tree";
import { Avatar, Segmented, TextInput } from "@/components/ui/primitives";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/cn";
import { PersonDetails, initialsOf, reportsText } from "@/components/people/person-card";
import { avatarPhoto } from "@/domain/people";
import { plural } from "@/domain/dates";
import { groupReports, unitTitle, type ReportGroup } from "@/lib/org/tree-groups";

/** Поиск без регистра и без разницы «ё» и «е», как в остальном ресурсе */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export function PeopleTreeView({ tree, me, owner = false, start = null }: { tree: PeopleTree; me: string; owner?: boolean; /** Человек из адреса (?person=), этап 45 */ start?: string | null }) {
  const [picked, setPicked] = useState<string | null>(start && tree.people[start] ? start : tree.start);
  const [mode, setMode] = useState<"chart" | "list">("chart");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const people = tree.people;
  // Человек мог пропасть после обновления структуры: тогда снова с начала
  const focus = picked && people[picked] ? picked : tree.start;
  // После перехода к человеку (и к тому же самому) фокус клавиатуры и экран переходят на его карточку
  const headRef = useRef<HTMLHeadingElement>(null);
  const [jump, setJump] = useState(0);
  useEffect(() => {
    if (!jump) return;
    headRef.current?.focus({ preventScroll: true });
    headRef.current?.scrollIntoView({ block: "nearest" });
  }, [jump]);

  const path = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur = focus ? people[focus] : undefined;
    while (cur && !seen.has(cur.slug)) {
      seen.add(cur.slug);
      out.unshift(cur.slug);
      cur = cur.manager ? people[cur.manager] : undefined;
    }
    return out;
  }, [focus, people]);

  const q = norm(query.trim());
  const found = q.length >= 2 ? Object.values(people).filter((p) => [p.fullName, p.position, p.unit].some((v) => v && norm(v).includes(q))).slice(0, 8) : [];

  if (!tree.loaded) {
    return (
      <EmptyState title="Руководители в структуре ещё не заданы">
        {owner
          ? "Дерево строится по колонке «Руководитель» из листа структуры. Загрузите лист кнопкой «Загрузить структуру» выше."
          : "Дерево строится по колонке «Руководитель» из листа структуры. Лист загружает владелец ресурса."}
      </EmptyState>
    );
  }

  const open = (slug: string) => {
    setJump((n) => n + 1);
    setPicked(slug);
    setMode("chart");
    setQuery("");
    setSearchOpen(false);
  };
  const p = focus ? people[focus] : undefined;
  const otherRoots = tree.roots.filter((r) => r !== path[0]);

  return (
    <div className="flex flex-col gap-4" data-testid="people-tree">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div
          className="relative w-full sm:max-w-sm"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSearchOpen(false);
          }}
        >
          <TextInput
            id="people-search"
            label="Найти человека"
            hideLabel
            placeholder="Найти человека: имя или должность"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setSearchOpen(false);
              }
            }}
            autoComplete="off"
          />
          <Search className="pointer-events-none absolute right-3 top-[18px] h-4 w-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
          {!searchOpen ? null : found.length ? (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-control border border-border bg-surface shadow-menu" aria-label="Найденные люди">
              {found.map((f) => (
                <li key={f.slug}>
                  <button type="button" className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-field" onMouseDown={(e) => e.preventDefault()} onClick={() => open(f.slug)}>
                    <span className="text-body text-ink">{f.fullName}</span>
                    <span className="text-caption text-text-secondary">{[f.position, f.unit].filter(Boolean).join(", ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : q.length >= 2 ? (
            <p className="mt-1 text-caption text-text-secondary">Никого не нашли</p>
          ) : null}
        </div>
        <Segmented label="Вид дерева" value={mode} onChange={setMode} options={[{ value: "chart", label: "Схема" }, { value: "list", label: "Список" }]} />
      </div>

      {mode === "chart" && p ? (
        <div className="sv-org">
          <nav className="sv-org__crumbs" aria-label="Путь до верха">
            {path.map((slug, i) => (
              <span key={slug} className="inline-flex items-center gap-1">
                {i > 0 ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                {slug === focus ? (
                  <span className="sv-org__crumb" aria-current="page">
                    {people[slug]!.fullName}
                  </span>
                ) : (
                  <button type="button" className="sv-org__crumb" onClick={() => open(slug)}>
                    {people[slug]!.fullName}
                  </button>
                )}
              </span>
            ))}
          </nav>

          <section className="sv-org__focus" aria-label={`Карточка: ${p.fullName}`} data-testid="person-focus">
            <PersonDetails person={p} people={people} me={me} onOpen={open} headRef={headRef} />
          </section>

          {p.reports.length ? (
            <>
              <div className="sv-org__stem" aria-hidden="true" />
              <section className="sv-org__level" aria-label={`Подчинённые: ${p.fullName}`}>
                <h3 className="sv-org__level-title">
                  {p.reports.length} {plural(p.reports.length, "прямой подчинённый", "прямых подчинённых", "прямых подчинённых")}
                </h3>
                <Reports person={p} tree={tree} me={me} onOpen={open} />
              </section>
            </>
          ) : null}

          {/* Этап 45: другие ветки свёрнуты по умолчанию, чтобы не отвлекать от выбранной */}
          {otherRoots.length ? (
            <details className="mt-2 text-caption text-text-secondary" data-testid="other-roots">
              <summary className="cursor-pointer rounded-tag py-1 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                {`Другие ветки и люди без руководителя в структуре: ${otherRoots.length}`}
              </summary>
              <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Другие ветки">
                {otherRoots.slice(0, 30).map((slug) => (
                  <li key={slug}>
                    <button type="button" className="rounded-tag bg-field px-2 py-1 text-caption text-ink hover:bg-accent-soft" onClick={() => open(slug)}>
                      {people[slug]!.fullName}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : (
        <TreeList tree={tree} focus={focus} onOpen={open} />
      )}
    </div>
  );
}

function PeopleGrid({ slugs, people, me, onOpen }: { slugs: string[]; people: PeopleTree["people"]; me: string; onOpen: (slug: string) => void }) {
  return (
    <ul className="sv-org__grid">
      {slugs.map((slug) => (
        <li key={slug}>
          <TreePersonButton person={people[slug]!} me={me} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

const peopleCount = (n: number) => `${n} ${plural(n, "человек", "человека", "человек")}`;

/** Подчинённые по подразделениям ветки на всю глубину (этап 57); нечего раскладывать: обычная сетка */
function Reports({ person, tree, me, onOpen }: { person: TreePerson; tree: PeopleTree; me: string; onOpen: (slug: string) => void }) {
  const grouped = groupReports(person, tree);
  if (!grouped) return <PeopleGrid slugs={person.reports} people={tree.people} me={me} onOpen={onOpen} />;
  const root = unitTitle(grouped.root);
  return (
    <div className="flex flex-col gap-4" data-testid="tree-units">
      {grouped.direct.length ? (
        <div className="flex flex-col gap-2">
          <p className="text-center text-caption text-text-secondary">
            Прямо в подразделении: {root.kind ? `${root.kind.toLowerCase()} ` : ""}
            {root.name}
          </p>
          <PeopleGrid slugs={grouped.direct} people={tree.people} me={me} onOpen={onOpen} />
        </div>
      ) : null}
      {grouped.groups.map((g) => (
        <UnitBlock key={g.unit.id} group={g} depth={0} tree={tree} me={me} onOpen={onOpen} />
      ))}
      {grouped.other.length ? (
        <section aria-label="Из других подразделений" className="rounded-panel border border-dashed border-line p-3 sm:p-4" data-testid="tree-unit-other">
          <h4 className="mb-3 text-center text-body font-semibold text-ink">Из других подразделений</h4>
          <PeopleGrid slugs={grouped.other} people={tree.people} me={me} onOpen={onOpen} />
        </section>
      ) : null}
    </div>
  );
}

function UnitBlock({ group, depth, tree, me, onOpen }: { group: ReportGroup; depth: number; tree: PeopleTree; me: string; onOpen: (slug: string) => void }) {
  const t = unitTitle(group.unit);
  const head = group.unit.head ? tree.people[group.unit.head] : undefined;
  const title = `${t.kind ? `${t.kind} ` : ""}${t.name}`;
  return (
    <section aria-label={title} className={cn("rounded-panel border border-line p-3 sm:p-4", depth % 2 ? "bg-surface" : "bg-field/50")} data-testid={`tree-unit-${group.unit.id}`}>
      <header className="mb-3 text-center">
        <h4 className="text-body font-semibold text-ink">
          {t.kind ? <span className="font-normal text-text-secondary">{t.kind} </span> : null}
          {t.name}
        </h4>
        <p className="mt-0.5 text-caption text-text-secondary">
          {head ? (
            <>
              Руководитель:{" "}
              <button type="button" className="font-medium text-blue-700 underline-offset-2 hover:underline" onClick={() => onOpen(head.slug)}>
                {head.fullName}
              </button>
            </>
          ) : (
            "Руководитель не отмечен в структуре"
          )}
          , {peopleCount(group.total)}
        </p>
      </header>
      {group.people.length ? <PeopleGrid slugs={group.people} people={tree.people} me={me} onOpen={onOpen} /> : null}
      {group.children.length ? (
        <div className={cn("flex flex-col gap-3", group.people.length && "mt-3")}>
          {group.children.map((c) => (
            <UnitBlock key={c.unit.id} group={c} depth={depth + 1} tree={tree} me={me} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TreePersonButton({ person: p, me, onOpen }: { person: TreePerson; me: string; onOpen: (slug: string) => void }) {
  return (
    <button type="button" className={cn("sv-person", p.reports.length > 0 && "sv-person--lead")} onClick={() => onOpen(p.slug)} aria-label={`${p.fullName}${p.position ? `, ${p.position}` : ""}. ${reportsText(p)}`} data-testid={`person-${p.slug}`}>
      <Avatar text={initialsOf(p.fullName)} name={p.fullName} photo={avatarPhoto(p.slug)} />
      <span className="sv-person__body">
        <span className="sv-person__name">
          {p.fullName}
          {p.slug === me ? <span className="ml-1.5 text-caption font-normal text-text-secondary">это вы</span> : null}
        </span>
        {p.position ? <span className="sv-person__meta">{p.position}</span> : null}
        {p.unit ? <span className="sv-person__meta">{p.unit}</span> : null}
        <span className="sv-person__count">{reportsText(p)}</span>
      </span>
    </button>
  );
}

function TreeList({ tree, focus, onOpen }: { tree: PeopleTree; focus: string | null; onOpen: (slug: string) => void }) {
  // Раскрыт верхний уровень и путь до выбранного человека
  const [openSet, setOpenSet] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const p of Object.values(tree.people)) if (p.depth < 1) s.add(p.slug);
    let cur = focus ? tree.people[focus] : undefined;
    const guard = new Set<string>();
    while (cur && !guard.has(cur.slug)) {
      guard.add(cur.slug);
      s.add(cur.slug);
      cur = cur.manager ? tree.people[cur.manager] : undefined;
    }
    return s;
  });
  const toggle = (slug: string) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });

  const node = (slug: string, guard: Set<string>): React.ReactNode => {
    const p = tree.people[slug];
    if (!p || guard.has(slug)) return null;
    const next = new Set(guard).add(slug);
    const isOpen = openSet.has(slug);
    return (
      <li key={slug}>
        <div className="sv-tree-list__row">
          {p.reports.length ? (
            <button type="button" className="sv-tree-list__toggle" onClick={() => toggle(slug)} aria-expanded={isOpen} aria-label={`${isOpen ? "Свернуть" : "Развернуть"}: ${p.fullName}`}>
              {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
            </button>
          ) : (
            <span className="inline-block w-[26px]" aria-hidden="true" />
          )}
          <span className="sv-tree-list__text">
            <button type="button" className="sv-tree-list__name" aria-current={slug === focus ? "true" : undefined} onClick={() => onOpen(slug)}>
              {p.fullName}
            </button>
            <span className="sv-tree-list__meta">
              {[p.position, p.reports.length ? `подчинённых: ${p.total}` : null].filter(Boolean).join(", ")}
            </span>
          </span>
        </div>
        {p.reports.length && isOpen ? (
          <ul className="sv-tree-list">
            {p.reports.map((r) => node(r, next))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <ul className="sv-tree-list" aria-label="Дерево подчинённых" data-testid="people-tree-list">
      {tree.roots.map((r) => node(r, new Set()))}
    </ul>
  );
}
