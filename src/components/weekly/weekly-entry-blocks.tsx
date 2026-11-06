"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { directionLabel } from "@/domain/dictionaries";
import type { WeekKey, WeeklyEntry } from "@/domain/types";
import type { WeekFact } from "@/lib/weekly/facts";
import { entryBlockKey } from "@/lib/weekly-blocks/assemble";
import { LIVE_FIGURE_KEYS, type TemplateBlock } from "@/lib/weekly-blocks/types";
import { Button } from "@/components/ui/button";
import { BlockTemplateContext } from "./block-template-context";
import { EntryForm } from "./entry-form";
import { EntryItem } from "./entry-item";
import { FactSuggestions } from "./fact-suggestions";

type Props = {
  week: WeekKey;
  blocks: TemplateBlock[];
  entries: WeeklyEntry[];
  facts: WeekFact[];
  canEdit: boolean;
  draft: WeeklyEntry | null;
  draftId: string | null;
  editing: string | null;
  onAdd: (section: string) => void;
  onEdit: (id: string) => void;
  onDelete: (entry: WeeklyEntry) => void;
  onSaved: (entry: WeeklyEntry) => void;
  onAutosaved: (entry: WeeklyEntry) => void;
  onDraftAutosaved: (entry: WeeklyEntry) => void;
  onCancel: () => void;
  onFactAdded: (entry: WeeklyEntry) => void;
  setFacts: (update: (prev: WeekFact[]) => WeekFact[]) => void;
};

/** Отчёт читается строками; только выбранная строка занимает место формой. */
export function WeeklyEntryBlocks(props: Props) {
  const { blocks, entries, facts, draft, draftId, editing, canEdit } = props;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editorHome, setEditorHome] = useState<{ id: string; key: string } | null>(null);
  const keys = blocks.map((b) => b.key);
  const keyOf = (entry: Pick<WeeklyEntry, "section" | "type" | "block" | "direction">) => entryBlockKey({ ...entry, section: entry.section ?? null }, keys);
  const editorOpen = !!draft || editing !== null;
  const editingEntry = entries.find((e) => e.id === editing);
  const placementOf = (entry: WeeklyEntry) => editing === entry.id && editorHome?.id === entry.id ? editorHome.key : keyOf(entry);
  const activeKey = draft ? keyOf(draft) : editingEntry ? placementOf(editingEntry) : null;

  return (
    <BlockTemplateContext value={blocks}><div className="divide-y divide-line rounded-panel border border-line bg-surface" data-testid="weekly-entry-blocks">
      {blocks.map((block) => {
        const items = entries.filter((e) => e.id !== (draft ? draftId : null) && placementOf(e) === block.key);
        const suggestions = facts.filter((f) => keyOf(f) === block.key);
        const active = activeKey === block.key;
        const open = active || !collapsed[block.key];
        const live = LIVE_FIGURE_KEYS.includes(block.key);
        const hasContent = items.length > 0 || suggestions.length > 0 || active;
        const bodyId = `weekly-block-${block.key}`;
        return (
          <section key={block.key} aria-labelledby={`${bodyId}-title`} className="min-w-0 px-4 py-1 sm:px-5 sm:py-2" data-testid={`weekly-block-${block.key}`}>
            <div className="flex items-center justify-between gap-3">
              <h2 id={`${bodyId}-title`} className="min-w-0 text-body font-semibold sm:text-lead">
                <button type="button" aria-expanded={open && hasContent} aria-controls={bodyId} disabled={active || !hasContent} onClick={() => setCollapsed((prev) => ({ ...prev, [block.key]: open }))} className="flex min-h-11 items-center gap-2 text-left">
                  {hasContent ? <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" /> : null}
                  <span>{block.title}</span>
                  {items.length || active ? <span className="shrink-0 text-small font-normal tabular-nums text-muted">{items.length + (draft && active ? 1 : 0)}</span> : null}
                </button>
              </h2>
              {canEdit && !live ? <Button size="sm" variant="ghost" disabled={editorOpen} onClick={() => { setCollapsed((prev) => ({ ...prev, [block.key]: false })); props.onAdd(block.key); }} aria-label={`Добавить запись: ${block.title}`}>
                <Plus className="h-4 w-4" aria-hidden="true" />Строка
              </Button> : null}
            </div>
            {live && !hasContent ? <p className="pb-2 text-caption text-muted">Из прогноза при сборке отчёта команды</p> : null}
            <div id={bodyId} hidden={!open || !hasContent} className="space-y-3 pb-2 pt-2">
              <ul className="divide-y divide-line">
                {items.map((entry) => <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  {editing === entry.id ? <EntryForm initial={entry} template={blocks} onSaved={props.onSaved} onAutosaved={props.onAutosaved} onCancel={props.onCancel} /> : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-caption text-muted">{directionLabel(entry.direction)}</p>
                        <h3 className="break-words text-body font-semibold">{entry.what}</h3>
                        {entry.fact ? <p className="mt-1 break-words text-small"><span className="text-muted">Факт: </span>{entry.fact}</p> : null}
                        {entry.next ? <p className="mt-1 break-words text-small"><span className="text-muted">Дальше: </span>{entry.next}</p> : null}
                        {entry.taskNumber ? <Link href={`/tasks/${entry.taskNumber}`} className="mt-1 inline-block text-small text-link">Задача {entry.taskNumber}</Link> : null}
                        <EntryDetails entry={entry} />
                      </div>
                      {canEdit ? <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant="ghost" disabled={editorOpen} onClick={() => { setEditorHome({ id: entry.id, key: block.key }); props.onEdit(entry.id); }} aria-label={`Изменить запись «${entry.what}»`}><Pencil className="h-4 w-4" aria-hidden="true" />Изменить</Button>
                        <Button size="sm" variant="ghost" disabled={editorOpen} onClick={() => props.onDelete(entry)} aria-label={`Удалить запись «${entry.what}»`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                      </div> : null}
                    </div>
                  )}
                </li>)}
              </ul>
              {draft && active ? <EntryForm key={draft.id} initial={draft} template={blocks} onSaved={props.onSaved} onAutosaved={props.onDraftAutosaved} onCancel={props.onCancel} /> : null}
              {canEdit && !editorOpen ? <FactSuggestions week={props.week} facts={suggestions} setFacts={props.setFacts} onAdded={props.onFactAdded} /> : null}
            </div>
          </section>
        );
      })}
    </div></BlockTemplateContext>
  );
}

function EntryDetails({ entry }: { entry: WeeklyEntry }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-1 text-small" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="w-fit cursor-pointer py-1 text-link">Подробности записи</summary>
    {open ? <div className="pt-2"><EntryItem entry={entry} discussion={false} compact /></div> : null}
  </details>;
}
