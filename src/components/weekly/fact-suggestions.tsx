"use client";

// Предложения из фактов недели в шаге «Главное за неделю» (этап 22б, модуль М6): что закрыто, что перенесено, что
// заблокировано, какие просьбы выполнены. «Добавить» делает из факта запись, её можно сразу поправить.

import { useState } from "react";
import { EyeOff, Plus } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { WeekKey, WeeklyEntry } from "@/domain/types";
import { addFactAction, hideFactAction } from "@/app/(app)/weekly/actions";
import { FACT_LABELS, type WeekFact } from "@/lib/weekly/facts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function FactSuggestions({ week, facts, setFacts, onAdded }: { week: WeekKey; facts: WeekFact[]; setFacts: (update: (prev: WeekFact[]) => WeekFact[]) => void; onAdded: (entry: WeeklyEntry) => void }) {
  const { notify } = usePrototype();
  const [busy, setBusy] = useState<string | null>(null);
  if (!facts.length) return null;
  const drop = (key: string) => setFacts((prev) => prev.filter((f) => f.key !== key));

  const add = async (f: WeekFact) => {
    if (busy) return;
    setBusy(f.key);
    try {
      const r = await addFactAction(week, f.key);
      if (!r.ok) return notify(r.error, "error");
      drop(f.key);
      onAdded(r.value);
      notify("Запись добавлена, её можно поправить");
    } catch {
      notify("Нет связи с сервером: запись не добавилась", "error");
    } finally {
      setBusy(null);
    }
  };

  const hide = async (f: WeekFact) => {
    if (busy) return;
    setBusy(f.key);
    try {
      const r = await hideFactAction(week, f.key);
      if (!r.ok) return notify(r.error, "error");
      drop(f.key);
    } catch {
      notify("Нет связи с сервером", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="facts-title" className="flex flex-col gap-3 rounded-xl bg-surface p-4 sm:p-5">
      <div>
        <h3 id="facts-title" className="text-lead font-semibold text-ink">
          Из фактов недели <span className="font-normal text-muted">{facts.length}</span>
        </h3>
        <p className="mt-0.5 text-small text-muted">Ресурс собрал, что произошло с вашими задачами и просьбами. Добавьте нужное записью и поправьте текст.</p>
      </div>
      <ul className="flex flex-col gap-2">
        {facts.map((f) => (
          <li key={f.key} className="flex flex-col gap-2 rounded-lg bg-white px-4 py-3 ring-1 ring-line sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={f.kind === "closed" ? "green" : f.kind === "request" ? "blue" : "orange"}>{FACT_LABELS[f.kind]}</Badge>
                {f.taskNumber ? <span className="text-caption tabular-nums text-muted">задача {f.taskNumber}</span> : null}
              </p>
              <p className="mt-1 text-body font-medium text-ink">{f.what}</p>
              {f.details ? <p className="text-small text-muted">{f.details}</p> : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="secondary" onClick={() => void add(f)} disabled={busy !== null} aria-label={`Добавить записью: ${f.what}`}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void hide(f)} disabled={busy !== null} aria-label={`Скрыть: ${f.what}`}>
                <EyeOff className="h-4 w-4" aria-hidden="true" />
                Скрыть
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
