import type { DirectoryPerson, RegistrySnapshot } from "./registry";
import type { Owner, PersonSlug } from "./types";
import { ALL_TEAMS, TOP_TEAM, TOP_TEAM_NAME } from "./teams";
import type { PersonLabel } from "./person-labels";

/** Каждый набор функций замкнут на свой снимок; общих изменяемых массивов здесь нет. */
export function createRegistryLookup(snapshot: RegistrySnapshot, labels: PersonLabel[] = []) {
  const all = snapshot.people;
  const PEOPLE = all.filter((p) => p.selectable);
  const bySlug = new Map(all.map((p) => [p.slug, p]));
  for (const p of labels) if (!bySlug.has(p.slug)) bySlug.set(p.slug, { ...p, selectable: false });
  const byTeam = new Map(snapshot.teams.map((t) => [t.id, t]));
  const personOf = (slug: PersonSlug): DirectoryPerson => bySlug.get(slug) ?? { slug, fullName: slug, shortName: slug, selectable: false };
  const teamOf = (id: string | null | undefined) => id ? byTeam.get(id) : undefined;
  return {
    source: snapshot,
    labels,
    PEOPLE,
    allPeople: () => all,
    peopleOf: (slugs: PersonSlug[]) => { const wanted = new Set(slugs); return PEOPLE.filter((p) => wanted.has(p.slug)); },
    personOf,
    positionOf: (slug: PersonSlug) => bySlug.get(slug)?.position ?? null,
    ...personNames(personOf),
    hasPerson: (slug: PersonSlug) => bySlug.has(slug),
    teamOf,
    teamName: (id: string | null | undefined) => id === ALL_TEAMS ? "Все мои команды" : teamOf(id)?.name ?? (id === TOP_TEAM ? TOP_TEAM_NAME : "Команда"),
  };
}

export type RegistryLookup = ReturnType<typeof createRegistryLookup>;

/** Локальные подписи расширяют lookup без копирования всего справочника для каждой строки. */
export function extendRegistryLookup(parent: RegistryLookup, labels: PersonLabel[]): RegistryLookup {
  const extra = new Map(labels.filter((p) => !parent.hasPerson(p.slug)).map((p) => [p.slug, { ...p, selectable: false }]));
  if (!extra.size) return parent;
  const personOf = (slug: PersonSlug): DirectoryPerson => extra.get(slug) ?? parent.personOf(slug);
  return { ...parent, personOf, hasPerson: (slug) => extra.has(slug) || parent.hasPerson(slug), ...personNames(personOf) };
}

function personNames(personOf: (slug: PersonSlug) => DirectoryPerson) {
  const compactName = (slug: PersonSlug) => {
    const [last, first] = personOf(slug).fullName.split(" ");
    return first ? `${first} ${last!.charAt(0)}.` : last!;
  };
  const ownerName = (owner: Owner, short = false) => owner === "all" ? "Все лидеры" : short ? personOf(owner).shortName : personOf(owner).fullName;
  return { compactName, ownerName,
    initials: (slug: PersonSlug) => {
      const [last, first] = personOf(slug).fullName.split(" ");
      return first ? `${first.charAt(0)}${last!.charAt(0)}` : last!.slice(0, 2);
    },
    authorName: (slug: PersonSlug | null, style: "short" | "compact" | "full" = "compact", empty = "Общее") => !slug ? empty : style === "short" ? personOf(slug).shortName : style === "full" ? personOf(slug).fullName : compactName(slug),
  };
}
