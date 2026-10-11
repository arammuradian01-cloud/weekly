"use client";

// Карточка человека (этап 45): одна на все вкладки «Люди». В дереве структуры она стоит в центре схемы, из таблицы
// команды и списка панели руководителя открывается выдвижной панелью. Данные из дерева подчинённых: должность,
// подразделение, руководитель, команды, вакансии; ссылки на задачи, weekly и цели человека

import Link from "next/link";
import { createContext, useContext, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronUp, UserRound } from "lucide-react";
import type { PeopleTree, TreePerson } from "@/lib/org/people-tree";
import { plural } from "@/domain/dates";
import { usePrototype } from "@/domain/store";
import { Avatar } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlays";
import { cn } from "@/lib/cn";

export function initialsOf(fullName: string): string {
  const [last, first] = fullName.split(/\s+/);
  return first ? `${first.charAt(0)}${last!.charAt(0)}` : fullName.slice(0, 2);
}

/** «4 прямых подчинённых, всего 12» или «Без подчинённых» */
export function reportsText(p: Pick<TreePerson, "reports" | "total">): string {
  if (!p.reports.length) return "Без подчинённых";
  const direct = `${p.reports.length} ${plural(p.reports.length, "прямой подчинённый", "прямых подчинённых", "прямых подчинённых")}`;
  return p.total > p.reports.length ? `${direct}, всего ${p.total}` : direct;
}

/**
 * Тело карточки: имя, должность, подчинённые, руководитель и команды, ссылки. onOpen: перейти к другому человеку
 * (в дереве и в панели). headRef только в дереве, где карточка в центре схемы. compact: в выдвижной панели, имя
 * уже в её заголовке
 */
export function PersonDetails({
  person: p,
  people,
  me,
  onOpen,
  headRef,
  compact = false,
  structureLink = true,
}: {
  person: TreePerson;
  people: Record<string, TreePerson>;
  me: string;
  onOpen?: (slug: string) => void;
  headRef?: React.RefObject<HTMLHeadingElement | null>;
  compact?: boolean;
  /** Ссылка «В структуре»: только из панели и только когда дерево загружено */
  structureLink?: boolean;
}) {
  const { teamPeople } = usePrototype();
  const manager = p.manager ? people[p.manager] : undefined;
  const functional = p.functional ? people[p.functional] : undefined;
  // Разбор задач на встрече идёт по очереди выбранной в шапке команды: ссылка только для её участников
  const inCurrentTeam = teamPeople.some((t) => t.slug === p.slug);
  const personLink = (slug: string, name: string) =>
    onOpen ? (
      <button type="button" className="text-link hover:underline" onClick={() => onOpen(slug)}>
        {name}
      </button>
    ) : (
      name
    );
  return (
    <>
      {compact ? (
        <p className="text-body text-ink">
          {[p.position, p.unit].filter(Boolean).join(", ") || "Должность не указана"}
          {p.slug === me ? <span className="ml-2 text-caption text-text-secondary">это вы</span> : null}
          <span className="block text-text-secondary">{reportsText(p)}</span>
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <Avatar text={initialsOf(p.fullName)} name={p.fullName} size="lg" />
          <div className="min-w-0 flex-1 basis-56">
            <h2 ref={headRef} tabIndex={-1} className="scroll-mt-24 font-heading text-title-sm font-bold text-ink [overflow-wrap:anywhere] focus:outline-none">
              {p.fullName}
              {p.slug === me ? <span className="ml-2 text-caption font-normal text-text-secondary">это вы</span> : null}
            </h2>
            <p className="text-body text-text-secondary">{[p.position, p.unit].filter(Boolean).join(", ") || "Должность не указана"}</p>
            <p className="mt-1 text-body text-ink">{reportsText(p)}</p>
          </div>
          {manager && onOpen ? (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => onOpen(manager.slug)} aria-label={`На уровень выше: ${manager.fullName}`}>
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
              Выше
            </Button>
          ) : null}
        </div>
      )}
      <dl className={cn("grid gap-x-6 gap-y-2 text-body sm:grid-cols-2", compact ? "mt-4" : "mt-3 border-t border-border pt-3")}>
        <div>
          <dt className="text-caption text-text-secondary">Руководитель</dt>
          <dd className="text-ink">{manager ? personLink(manager.slug, manager.fullName) : "Нет в структуре"}</dd>
        </div>
        {functional ? (
          <div>
            <dt className="text-caption text-text-secondary">Функциональный руководитель</dt>
            <dd className="text-ink">{personLink(functional.slug, functional.fullName)}</dd>
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
      {/* Цели видны шире задач (цели выше своей команды), поэтому ссылка на цели есть у всех, на задачи только у тех,
          чьи задачи смотрящему видны, на weekly у тех, кто есть в лентах видимых команд */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {p.work ? (
          <Link href={`/tasks?owner=${encodeURIComponent(p.slug)}`} className="text-body font-semibold text-link hover:underline">
            Задачи
          </Link>
        ) : null}
        {p.work && compact && inCurrentTeam ? (
          <Link href={`/tasks/review?person=${encodeURIComponent(p.slug)}`} className="text-body font-semibold text-link hover:underline">
            Разбор на встрече
          </Link>
        ) : null}
        {p.weekly ? (
          <Link href={`/weekly?author=${encodeURIComponent(p.slug)}`} className="text-body font-semibold text-link hover:underline">
            Weekly
          </Link>
        ) : null}
        <Link href={`/goals?find=${encodeURIComponent(p.fullName)}`} className="text-body font-semibold text-link hover:underline">
          Цели
        </Link>
        {compact && structureLink ? (
          <Link href={`/people/structure?person=${encodeURIComponent(p.slug)}`} className="text-body font-semibold text-link hover:underline">
            В структуре
          </Link>
        ) : null}
        <span className="text-caption text-text-secondary">откроются в команде, выбранной в верхней панели</span>
      </div>
    </>
  );
}

type PersonCardApi = { open: (slug: string) => void; has: (slug: string) => boolean };
const PersonCardContext = createContext<PersonCardApi | null>(null);

/** Карточка человека выдвижной панелью: открывается из таблицы команды и панели руководителя */
export function usePersonCard(): PersonCardApi | null {
  return useContext(PersonCardContext);
}

export function PersonCardProvider({ tree, me, children }: { tree: PeopleTree; me: string; children: React.ReactNode }) {
  const [slug, setSlug] = useState<string | null>(null);
  // Переход по ссылке из карточки на другую вкладку «Люди» (например, «В структуре»): layout не перемонтируется,
  // поэтому панель закрывается по смене адреса. Состояние меняется во время отрисовки, без эффекта
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const route = `${pathname}?${search}`;
  const [seenRoute, setSeenRoute] = useState(route);
  if (seenRoute !== route) {
    setSeenRoute(route);
    setSlug(null);
  }
  const person = slug ? tree.people[slug] : undefined;
  const api: PersonCardApi = { open: setSlug, has: (s) => !!tree.people[s] };
  return (
    <PersonCardContext.Provider value={api}>
      {children}
      <Drawer open={!!person} onOpenChange={(o) => !o && setSlug(null)} title={person?.fullName ?? ""} description="Карточка человека">
        {person ? <PersonDetails person={person} people={tree.people} me={me} onOpen={setSlug} compact structureLink={tree.loaded} /> : null}
      </Drawer>
    </PersonCardContext.Provider>
  );
}

/**
 * Имя человека, открывающее карточку. Человека нет в дереве (выключен или дерево пустое): ссылка fallbackHref, если
 * дана, иначе просто текст
 */
export function PersonName({ slug, name, className, fallbackHref }: { slug: string; name: string; className?: string; fallbackHref?: string }) {
  const card = usePersonCard();
  if (!card || !card.has(slug)) {
    return fallbackHref ? (
      <Link href={fallbackHref} className={cn("hover:text-link hover:underline", className)}>
        {name}
      </Link>
    ) : (
      <span className={className}>{name}</span>
    );
  }
  return (
    <button type="button" onClick={() => card.open(slug)} className={cn("inline-flex items-center gap-1.5 text-left hover:text-link hover:underline", className)}>
      {name}
      <UserRound className="h-3.5 w-3.5 shrink-0 text-icon" strokeWidth={1.75} aria-hidden="true" />
      <span className="sr-only">, карточка</span>
    </button>
  );
}

/** Кнопка-иконка «Карточка» рядом с именем, когда само имя занято другим действием (раскрыть задачи в панели руководителя) */
export function PersonCardButton({ slug, name }: { slug: string; name: string }) {
  const card = usePersonCard();
  if (!card || !card.has(slug)) return null;
  return (
    <button type="button" onClick={() => card.open(slug)} className="sv-icon-btn sv-icon-btn--xs shrink-0" aria-label={`Карточка: ${name}`} title="Карточка человека">
      <UserRound className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
