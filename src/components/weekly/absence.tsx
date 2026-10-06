"use client";

import { personOf } from "@/domain/people";
import type { PersonSlug, PersonWeekly } from "@/domain/types";
import { Badge } from "@/components/ui/badge";

/** «замещает Влад» или пусто */
export function substituteText(substitute: PersonSlug | null): string {
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
export function absentLine(reports: PersonWeekly[]): string | null {
  const absent = reports.filter((r) => r.absent);
  if (!absent.length) return null;
  return absent.map((r) => `${personOf(r.author).shortName}, ${substituteText(r.absent!.substitute)}`).join("; ");
}
