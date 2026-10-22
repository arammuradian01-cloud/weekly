"use client";

// Шаблон смысловых блоков weekly команды (этап 66): руководитель выбирает блоки из стандартного набора и свои, задаёт
// порядок. Участники сдают weekly по этим блокам, руководитель видит отчёт команды по ним. Нет шаблона: weekly как
// раньше. Отдельный компонент со своим сохранением: его можно встроить и в карточку команды.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { BLOCK_LIMITS, STANDARD_BLOCKS, STANDARD_TEMPLATE, isStandardKey, newCustomKey, type TemplateBlock } from "@/lib/weekly-blocks/types";
import type { TeamTemplateView } from "@/lib/weekly-blocks/team";
import { saveTeamTemplateAction } from "@/app/(app)/weekly/blocks-actions";
import { Button } from "@/components/ui/button";
import { SelectField, TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";

export function TeamBlocksTemplate({ initial, onSaved }: { initial: TeamTemplateView; onSaved?: (view: TeamTemplateView) => void }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [blocks, setBlocks] = useState<TemplateBlock[]>(() => initial.blocks ?? []);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const missing = STANDARD_BLOCKS.filter((b) => !blocks.some((x) => x.key === b.key));
  const [pick, setPick] = useState<string>("");
  const [custom, setCustom] = useState("");
  const change = (next: TemplateBlock[]) => {
    setBlocks(next);
    setDirty(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j]!, next[i]!];
    change(next);
  };
  const save = async (list: TemplateBlock[], ok: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveTeamTemplateAction(initial.teamId, list);
      if (!r.ok) return setError(r.error);
      setBlocks(r.value.blocks ?? []);
      setDirty(false);
      notify(ok);
      onSaved?.(r.value);
      router.refresh();
    } catch {
      setError("Нет связи с сервером: блоки не сохранились");
    } finally {
      setBusy(false);
    }
  };

  if (!initial.canEdit) {
    return initial.blocks ? (
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-body text-ink" data-testid="team-template-view">
        {initial.blocks.map((b) => (
          <li key={b.key}>{b.title}</li>
        ))}
      </ol>
    ) : (
      <p className="text-body text-muted">Блоки weekly команды не заданы: weekly как раньше.</p>
    );
  }

  const add = (key: string) => {
    const std = STANDARD_BLOCKS.find((b) => b.key === key);
    if (std) change([...blocks, { key: std.key, title: std.title }]);
    setPick("");
  };
  const addCustom = () => {
    const title = custom.replace(/[—–]/g, "-").replace(/\s+/g, " ").trim().slice(0, BLOCK_LIMITS.title);
    if (!title) return;
    change([...blocks, { key: newCustomKey(), title }]);
    setCustom("");
  };

  return (
    <div className="flex flex-col gap-4" data-testid="team-template">
      <p className="text-small text-muted">
        Участники команды сдают weekly по этим блокам, отчёт команды собирается по ним же, в этом порядке. Без блоков weekly команды как раньше.
      </p>
      {blocks.length ? (
        <ol className="flex flex-col gap-2">
          {blocks.map((b, i) => (
            <li key={b.key} className="flex min-w-0 items-center gap-2 rounded-lg bg-field px-3 py-2" data-testid="team-template-block">
              <span className="min-w-0 flex-1 break-words text-body text-ink">
                <span className="text-muted">{i + 1}.</span> {b.title}
                {isStandardKey(b.key) ? null : <span className="ml-1.5 text-caption text-muted">свой блок</span>}
              </span>
              <Button type="button" size="sm" variant="ghost" aria-label={`Поднять блок «${b.title}»`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Опустить блок «${b.title}»`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Убрать блок «${b.title}»`} onClick={() => change(blocks.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg bg-field px-4 py-3">
          <p className="text-body text-ink">Блоков пока нет: weekly команды как раньше.</p>
          <div>
            <Button type="button" size="sm" variant="soft" onClick={() => change(STANDARD_TEMPLATE.map((b) => ({ ...b })))}>
              Взять стандартный набор
            </Button>
          </div>
        </div>
      )}
      {blocks.length < BLOCK_LIMITS.templateBlocks ? (
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
          {missing.length ? (
            <div className="flex items-end gap-2">
              <SelectField
                className="min-w-0 flex-1"
                label="Добавить стандартный блок"
                id={`team-${initial.teamId}-add`}
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                options={[{ value: "", label: "Выберите блок" }, ...missing.map((b) => ({ value: b.key, label: b.title }))]}
              />
              <Button type="button" size="sm" variant="secondary" className="h-11" disabled={!pick} onClick={() => add(pick)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить
              </Button>
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <TextInput className="min-w-0 flex-1" label="Свой блок" id={`team-${initial.teamId}-custom`} value={custom} maxLength={BLOCK_LIMITS.title} placeholder="Например: Найм и команда" onChange={(e) => setCustom(e.target.value)} />
            <Button type="button" size="sm" variant="secondary" className="h-11" disabled={!custom.trim()} onClick={addCustom}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Добавить свой
            </Button>
          </div>
        </div>
      ) : null}
      <FormError message={error ?? undefined} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!dirty || busy} loading={busy} onClick={() => void save(blocks, blocks.length ? "Блоки weekly команды сохранены" : "Блоки убраны: weekly команды как раньше")}>
          <Save className="h-4 w-4" aria-hidden="true" />
          Сохранить блоки
        </Button>
        {initial.blocks && blocks.length ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void save([], "Блоки убраны: weekly команды как раньше")}>
            Убрать блоки
          </Button>
        ) : null}
      </div>
    </div>
  );
}
