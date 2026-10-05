import { createHash } from "node:crypto";
import { prisma } from "./db";
import { getSetting } from "./settings";
import type { RegistrySnapshot } from "@/domain/registry";
import type { DictEntry, EditableDictKind } from "@/domain/dictionaries";
import type { Role } from "@/domain/types";

export const EDITABLE_KINDS: EditableDictKind[] = ["DIRECTION", "WEEKLY_BLOCK", "ENTRY_TYPE", "TASK_SOURCE"];

/** Люди и справочники, которые правят в настройках: снимок для экранов */
export async function loadRegistry(): Promise<RegistrySnapshot> {
  const [people, items, staleDays] = await Promise.all([
    prisma.person.findMany({ orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }], include: { defaultDirection: true } }),
    prisma.dictionaryItem.findMany({ where: { kind: { in: EDITABLE_KINDS } }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] }),
    getSetting<number>("tasks.staleDays", 14),
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
    })),
    dicts,
    staleDays,
  };
  const version = createHash("sha1").update(JSON.stringify(body)).digest("hex").slice(0, 16);
  return { version, ...body };
}
