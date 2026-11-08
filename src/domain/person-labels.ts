/** Только подпись автора уже разрешённой записи. Не расширяет общий список людей для выбора. */
export type PersonLabel = { slug: string; fullName: string; shortName: string };
export type WithPersonLabels = { peopleLabels?: PersonLabel[] };

/** Собирает подписи только из явно добавленных полей DTO, не из произвольного текста/JSON. */
export function dtoPersonLabels(value: unknown): PersonLabel[] {
  const labels = new Map<string, PersonLabel>();
  const seen = new WeakSet<object>();
  function visit(v: unknown) {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { for (const x of v) visit(x); return; }
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.peopleLabels)) for (const p of obj.peopleLabels) {
      if (p && typeof p.slug === "string" && typeof p.fullName === "string" && typeof p.shortName === "string") labels.set(p.slug, { slug: p.slug, fullName: p.fullName, shortName: p.shortName });
    }
    for (const [key, x] of Object.entries(obj)) if (key !== "peopleLabels" && key !== "children") visit(x);
  }
  visit(value);
  return [...labels.values()];
}
