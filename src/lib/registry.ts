import { createHash } from "node:crypto";
import { prisma } from "./db";
import { getSetting } from "./settings";
import type { RegistrySnapshot } from "@/domain/registry";
import type { DictEntry, EditableDictKind } from "@/domain/dictionaries";
import type { Role } from "@/domain/types";

export const EDITABLE_KINDS: EditableDictKind[] = ["DIRECTION", "WEEKLY_BLOCK", "ENTRY_TYPE", "TASK_SOURCE"];

/** Люди и справочники, которые правят в настройках: снимок для экранов */
export async function loadRegistry(): Promise<RegistrySnapshot> {
  const [people, items, staleDays, teams] = await Promise.all([
    prisma.person.findMany({ orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }], include: { defaultDirection: true } }),
    prisma.dictionaryItem.findMany({ where: { kind: { in: EDITABLE_KINDS } }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    getSetting<number>("tasks.staleDays", 14),
    prisma.team.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { leader: { select: { slug: true } }, members: { select: { person: { select: { slug: true, sortOrder: true, fullName: true } } } } },
    }),
  ]);
  const dicts = Object.fromEntries(EDITABLE_KINDS.map((k) => [k, [] as DictEntry[]])) as Record<EditableDictKind, DictEntry[]>;
  for (const i of items) dicts[i.kind as EditableDictKind].push({ code: i.code, label: i.label, active: i.active });
  const body = {
    people: people.map((p) => ({
      slug: p.slug,
      fullName: p.fullName,
      shortName: p.shortName,
      role: p.role as Role,
      zone: p.zone,
      direction: p.defaultDirection?.code ?? "department",
      active: p.active,
      position: p.position,
    })),
    dicts,
    staleDays,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      leader: t.leader?.slug ?? null,
      parent: t.parentId,
      members: t.members
        .map((m) => m.person)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.fullName.localeCompare(b.fullName, "ru"))
        .map((m) => m.slug),
      active: t.active,
    })),
  };
  const version = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { version, ...body };
}
