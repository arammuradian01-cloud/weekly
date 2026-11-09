import type { PersonLabel } from "@/domain/person-labels";

/** Вызывать только после отбора доступных записей. Не делает запросов к общей истории людей. */
export function personLabelsOf(value: unknown): PersonLabel[] {
  const labels = new Map<string, PersonLabel>();
  const seen = new WeakSet<object>();
  function visit(v: unknown) {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    const obj = v as Record<string, unknown>;
    if (typeof obj.slug === "string" && typeof obj.fullName === "string") labels.set(obj.slug, { slug: obj.slug, fullName: obj.fullName, shortName: typeof obj.shortName === "string" ? obj.shortName : obj.fullName });
    for (const x of Object.values(obj)) visit(x);
  }
  visit(value);
  return [...labels.values()];
}
