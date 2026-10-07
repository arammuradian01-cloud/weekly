"use client";

// Сохранённые виды списка (этап 25): фильтры из адреса под своим именем. Личные, но ссылкой можно поделиться

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkPlus, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { SavedViewDto } from "@/lib/views/service";
import { normalizeQuery } from "@/lib/views/query";
import { deleteViewAction, saveViewAction } from "@/app/(app)/tasks/view-actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { TextInput } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export function SavedViews({ views, path, current, canSave }: { views: SavedViewDto[]; path: string; current: string; canSave: boolean }) {
  const router = useRouter();
  const { notify, notifyUndo } = usePrototype();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeQuery(current);
  const activeView = views.find((v) => v.query === normalized) ?? null;
  if (!views.length && !canSave) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await saveViewAction({ path, name, query: current });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    setName("");
    setError(null);
    notify(`Вид «${r.value.name}» сохранён`);
    router.refresh();
  };
  const remove = async (v: SavedViewDto) => {
    const r = await deleteViewAction(v.id);
    if (!r.ok) return notify(r.error, "error");
    router.refresh();
    notifyUndo(`Вид «${v.name}» удалён`, () => {
      saveViewAction({ path, name: v.name, query: v.query })
        .then((res) => {
          if (res.ok) router.refresh();
          else notify(res.error, "error");
        })
        .catch(() => notify("Нет связи с сервером", "error"));
    });
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Сохранённые виды">
      {views.length ? <Bookmark className="h-4 w-4 text-muted" aria-hidden="true" /> : null}
      {views.map((v) => {
        const isActive = activeView?.id === v.id;
        return (
          <span key={v.id} className={cn("inline-flex h-9 items-center rounded-full border text-small", isActive ? "border-blue bg-blue-soft text-blue-700" : "border-line bg-white text-ink hover:border-steel")}>
            <Link href={v.query ? `${path}?${v.query}` : path} aria-current={isActive ? "page" : undefined} className="inline-flex h-full items-center pl-3.5 pr-2 font-medium">
              {v.name}
            </Link>
            <button type="button" onClick={() => void remove(v)} className="inline-flex h-full w-8 items-center justify-center rounded-r-full text-muted hover:text-ink" aria-label={`Удалить вид ${v.name}`}>
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        );
      })}
      {canSave && !activeView ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-small font-medium text-blue-700 hover:bg-blue-soft">
          <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
          Сохранить вид
        </button>
      ) : null}
      <Modal open={open} onOpenChange={setOpen} title="Сохранить вид" description="Нынешние фильтры, группировка и сортировка откроются по имени. Вид виден только вам, ссылкой с фильтрами можно поделиться">
        <form onSubmit={save} className="flex flex-col gap-4">
          <TextInput label="Имя вида" id="view-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Например, мои критичные" autoFocus />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Сохраняю…" : "Сохранить"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
