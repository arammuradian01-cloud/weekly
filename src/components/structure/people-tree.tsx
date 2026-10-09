"use client";

// Дерево подчинённых (этап 34). Схема: человек в центре с руководителем и путём до верха, под ним прямые подчинённые
// карточками, нажатие спускает на уровень ниже. Список: всё дерево с отступами, сворачивается по веткам. Поиск по
// имени и должности открывает человека на схеме

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Search } from "lucide-react";
import type { PeopleTree, TreePerson } from "@/lib/org/people-tree";
import { Avatar, Segmented, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/cn";

const initialsOf = (fullName: string) => {
  const [last, first] = fullName.split(/\s+/);
  return first ? `${first.charAt(0)}${last!.charAt(0)}` : fullName.slice(0, 2);
};

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** Поиск без регистра и без разницы «ё» и «е», как в остальном ресурсе */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** «4 прямых, всего 12» или «Без подчинённых» */
export function reportsText(p: Pick<TreePerson, "reports" | "total">): string {
  if (!p.reports.length) return "Без подчинённых";
  const direct = `${p.reports.length} ${plural(p.reports.length, "прямой подчинённый", "прямых подчинённых", "прямых подчинённых")}`;
  return p.total > p.reports.length ? `${direct}, всего ${p.total}` : direct;
}

export function PeopleTreeView({ tree, me, owner = false }: { tree: PeopleTree; me: string; owner?: boolean }) {
  const [picked, setPicked] = useState<string | null>(tree.start);
  const [mode, setMode] = useState<"chart" | "list">("chart");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const people = tree.people;
  // Человек мог пропасть после обновления структуры: тогда снова с начала
  const focus = picked && people[picked] ? picked : tree.start;
  // После перехода к другому человеку фокус клавиатуры и экран переходят на его карточку
  const headRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    headRef.current?.focus({ preventScroll: true });
    headRef.current?.scrollIntoView({ block: "nearest" });
  }, [focus, mode]);

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
    moved.current = true;
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
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-control border border-border bg-surface shadow-[var(--shadow-menu)]" aria-label="Найденные люди">
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

          <FocusCard person={p} people={people} me={me} onOpen={open} headRef={headRef} />

          {p.reports.length ? (
            <>
              <div className="sv-org__stem" aria-hidden="true" />
              <section className="sv-org__level" aria-label={`Подчинённые: ${p.fullName}`}>
                <h3 className="sv-org__level-title">
                  {p.reports.length} {plural(p.reports.length, "прямой подчинённый", "прямых подчинённых", "прямых подчинённых")}
                </h3>
                <ul className="sv-org__grid">
                  {p.reports.map((slug) => (
                    <li key={slug}>
                      <PersonCard person={people[slug]!} me={me} onOpen={open} />
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}

          {otherRoots.length ? (
            <section className="mt-2" aria-label="Другие ветки">
              <p className="text-caption text-text-secondary">
                {`Другие ветки и люди без руководителя в структуре: ${otherRoots.length}`}
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {otherRoots.slice(0, 30).map((slug) => (
                  <li key={slug}>
                    <button type="button" className="rounded-tag bg-field px-2 py-1 text-caption text-ink hover:bg-accent-soft" onClick={() => open(slug)}>
                      {people[slug]!.fullName}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <TreeList tree={tree} focus={focus} onOpen={open} />
      )}
    </div>
  );
}

function PersonCard({ person: p, me, onOpen }: { person: TreePerson; me: string; onOpen: (slug: string) => void }) {
  return (
    <button type="button" className={cn("sv-person", p.reports.length > 0 && "sv-person--lead")} onClick={() => onOpen(p.slug)} aria-label={`${p.fullName}${p.position ? `, ${p.position}` : ""}. ${reportsText(p)}`} data-testid={`person-${p.slug}`}>
      <Avatar text={initialsOf(p.fullName)} name={p.fullName} />
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

function FocusCard({
  person: p,
  people,
  me,
  onOpen,
  headRef,
}: {
  person: TreePerson;
  people: Record<string, TreePerson>;
  me: string;
  onOpen: (slug: string) => void;
  headRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const manager = p.manager ? people[p.manager] : undefined;
  const functional = p.functional ? people[p.functional] : undefined;
  return (
    <section className="sv-org__focus" aria-label={`Карточка: ${p.fullName}`} data-testid="person-focus">
      <div className="flex items-start gap-3">
        <Avatar text={initialsOf(p.fullName)} name={p.fullName} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 ref={headRef} tabIndex={-1} className="scroll-mt-24 font-heading text-title-sm font-bold text-ink [overflow-wrap:anywhere] focus:outline-none">
            {p.fullName}
            {p.slug === me ? <span className="ml-2 text-caption font-normal text-text-secondary">это вы</span> : null}
          </h2>
          <p className="text-body text-text-secondary">{[p.position, p.unit].filter(Boolean).join(", ") || "Должность не указана"}</p>
          <p className="mt-1 text-body text-ink">{reportsText(p)}</p>
        </div>
        {manager ? (
          <Button variant="secondary" size="sm" onClick={() => onOpen(manager.slug)} aria-label={`На уровень выше: ${manager.fullName}`}>
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
            Выше
          </Button>
        ) : null}
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-border pt-3 text-body sm:grid-cols-2">
        <div>
          <dt className="text-caption text-text-secondary">Руководитель</dt>
          <dd className="text-ink">{manager ? manager.fullName : "Нет в структуре"}</dd>
        </div>
        {functional ? (
          <div>
            <dt className="text-caption text-text-secondary">Функциональный руководитель</dt>
            <dd className="text-ink">{functional.fullName}</dd>
          </div>
        ) : null}
        {p.leads.length ? (
          <div>
            <dt className="text-caption text-text-secondary">Руководит командами</dt>
            <dd className="text-ink">{p.leads.map((t) => t.name).join(", ")}</dd>
          </div>
        ) : null}
        {p.memberOf.length ? (
          <div>
            <dt className="text-caption text-text-secondary">Участник команд</dt>
            <dd className="text-ink">{p.memberOf.map((t) => t.name).join(", ")}</dd>
          </div>
        ) : null}
        {p.vacancies?.length ? (
          <div className="sm:col-span-2">
            <dt className="text-caption text-text-secondary">Открытые вакансии в подразделении</dt>
            <dd className="text-ink">{p.vacancies.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      {p.work ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link href={`/tasks?owner=${encodeURIComponent(p.slug)}`} className="text-body font-semibold text-link hover:underline">
            Задачи
          </Link>
          <Link href={`/goals?find=${encodeURIComponent(p.fullName)}`} className="text-body font-semibold text-link hover:underline">
            Цели
          </Link>
          <span className="text-caption text-text-secondary">откроются в команде, выбранной в верхней панели</span>
        </div>
      ) : null}
    </section>
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
          <button type="button" className="sv-tree-list__name" aria-current={slug === focus ? "true" : undefined} onClick={() => onOpen(slug)}>
            {p.fullName}
          </button>
          <span className="sv-tree-list__meta">
            {[p.position, p.reports.length ? `подчинённых: ${p.total}` : null].filter(Boolean).join(", ")}
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
