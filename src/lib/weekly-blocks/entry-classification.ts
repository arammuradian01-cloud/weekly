import type { EntryTypeCode } from "@/domain/dictionaries";

/** Скрытые поля старого справочника для новой строки, добавленной в блок отчёта. */
export function classificationForSection(section: string): { block: string; type: EntryTypeCode } {
  switch (section) {
    case "risks": return { block: "risks", type: "risk" };
    case "plan": return { block: "key-changes", type: "plan" };
    case "news": return { block: "team", type: "event" };
    case "products": return { block: "product", type: "result" };
    case "partners": return { block: "partners", type: "result" };
    default: return { block: "key-changes", type: "event" };
  }
}
