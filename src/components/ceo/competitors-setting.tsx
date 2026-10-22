"use client";

// Конкуренты для блока «Конкуренты» отчёта CEO (этап 66): название и ключевые слова через запятую. Слово ловится по
// началу слова, в кавычках только целиком, как ключевые слова новостей. Меняет владелец в режиме управления,
// администраторы видят список.

import { useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { Competitor } from "@/lib/weekly-blocks/assemble";
import { COMPETITOR_LIMITS } from "@/lib/weekly-blocks/competitors";
import { saveCompetitorsAction } from "@/app/(app)/weekly/blocks-actions";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";

type Row = { key: number; name: string; keywords: string };
let rowKey = 0;
const toRow = (c: Competitor): Row => ({ key: ++rowKey, name: c.name, keywords: c.keywords.join(", ") });

export function CompetitorsSetting({ initial, canEdit }: { initial: Competitor[]; canEdit: boolean }) {
  const { notify } = usePrototype();
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<Row>) => {
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveCompetitorsAction(rows.filter((x) => x.name.trim()).map((x) => ({ name: x.name, keywords: x.keywords })));
      if (!r.ok) return setError(r.error);
      setRows(r.value.map(toRow));
      setDirty(false);
      notify("Список конкурентов сохранён: блок «Конкуренты» соберётся по нему");
    } catch {
      setError("Нет связи с сервером: список не сохранён");
    } finally {
      setBusy(false);
    }
  };
  if (!canEdit) {
    return (
      <ul className="flex flex-col gap-1 text-small text-ink" data-testid="competitors-list">
        {initial.map((c) => (
          <li key={c.name} className="break-words">
            <span className="font-medium">{c.name}:</span> {c.keywords.join(", ")}
          </li>
        ))}
        <li className="text-caption text-muted">Список меняет владелец в режиме управления.</li>
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="competitors-setting">
      <p className="text-small text-muted">
        Новость за неделю попадает в блок «Конкуренты», если в заголовке или описании есть слово конкурента. Слово ловится по началу, в кавычках только целиком. В ресурсе только новости, которые привязались к продуктам.
      </p>
      {rows.map((r, i) => (
        <div key={r.key} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
          <TextInput label={`Конкурент ${i + 1}`} id={`competitor-${r.key}-name`} value={r.name} maxLength={COMPETITOR_LIMITS.name} onChange={(e) => set(i, { name: e.target.value })} />
          <TextInput label="Слова через запятую" id={`competitor-${r.key}-words`} value={r.keywords} onChange={(e) => set(i, { keywords: e.target.value })} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-11 justify-self-end"
            aria-label={`Убрать конкурента ${r.name || i + 1}`}
            onClick={() => {
              setRows((list) => list.filter((_, j) => j !== i));
              setDirty(true);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-2">
        {rows.length < COMPETITOR_LIMITS.count ? (
          <Button
            type="button"
            size="sm"
            variant="soft"
            onClick={() => {
              setRows((list) => [...list, { key: ++rowKey, name: "", keywords: "" }]);
              setDirty(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Добавить конкурента
          </Button>
        ) : null}
        <Button type="button" size="sm" disabled={!dirty || busy} loading={busy} onClick={() => void save()}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Сохранить список
        </Button>
      </div>
    </div>
  );
}
