import { createHash } from "node:crypto";
import { prisma } from "./db";
import { getSetting } from "./settings";
import type { RegistrySnapshot } from "@/domain/registry";
import type { DictEntry, EditableDictKind } from "@/domain/dictionaries";
import type { Role } from "@/domain/types";

export const EDITABLE_KINDS: EditableDictKind[] = ["DIRECTION", "WEEKLY_BLOCK", "ENTRY_TYPE", "TASK_SOURCE"];

/** Люди и справочники, которые правят в настройках: снимок для экранов */
export async function loadRegistry(access: { management: boolean; visibleTeams: readonly string[] }): Promise<RegistrySnapshot> {
  const [people, items, staleDays, teams] = await Promise.all([
    prisma.person.findMany({ where: access.management ? {} : { active: true }, orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }], include: { defaultDirection: true } }),
    prisma.dictionaryItem.findMany({ where: { kind: { in: EDITABLE_KINDS } }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    getSetting<number>("tasks.staleDays", 14),
    prisma.team.findMany({
      where: access.management ? {} : { id: { in: [...access.visibleTeams] } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { leader: { select: { slug: true, active: true } }, members: { select: { person: { select: { slug: true, sortOrder: true, fullName: true, active: true } } } } },
    }),
  ]);
  const dicts = Object.fromEntries(EDITABLE_KINDS.map((k) => [k, [] as DictEntry[]])) as Record<EditableDictKind, DictEntry[]>;
  for (const i of items) dicts[i.kind as EditableDictKind].push({ code: i.code, label: i.label, active: i.active });
  const body = {
    people: people.map((p) => ({
      slug: p.slug,
      fullName: p.fullName,
      shortName: p.shortName,
      selectable: p.active && p.role !== "OBSERVER",
      ...(access.management ? { role: p.role as Role, zone: p.zone, direction: p.defaultDirection?.code ?? "department", active: p.active } : {}),
      position: p.position,
    })),
    dicts,
    staleDays,
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      leader: t.leader && (access.management || t.leader.active) ? t.leader.slug : null,
      parent: access.management || (t.parentId && access.visibleTeams.includes(t.parentId)) ? t.parentId : null,
      members: t.members
        .map((m) => m.person)
        .filter((p) => access.management || p.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.fullName.localeCompare(b.fullName, "ru"))
        .map((m) => m.slug),
      active: t.active,
    })),
  };
  const version = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { version, ...body };
}
