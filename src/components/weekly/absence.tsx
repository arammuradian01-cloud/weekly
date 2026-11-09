"use client";


import type { PersonSlug, PersonWeekly } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import type { RegistryLookup } from "@/domain/registry-lookup";

/** «замещает Влад» или пусто */
export function substituteText(substitute: PersonSlug | null, personOf: RegistryLookup["personOf"]): string {
  return substitute ? `замещает ${personOf(substitute).shortName}` : "без замещающего";
}

/** Метка вместо состояния сдачи: человека нет на неделе, weekly не ждём (этап 9) */
export function AbsentBadge({ className }: { className?: string }) {
  return (
    <Badge tone="gray" className={className}>
      Нет на неделе
    </Badge>
  );
}

/** Кто отсутствует на неделе, одной строкой: «Тарас, замещает Влад; Света, без замещающего» */
export function absentLine(reports: PersonWeekly[], personOf: RegistryLookup["personOf"]): string | null {
  const absent = reports.filter((r) => r.absent);
  if (!absent.length) return null;
  return absent.map((r) => `${personOf(r.author).shortName}, ${substituteText(r.absent!.substitute, personOf)}`).join("; ");
}
