"use client";

// Массовые действия (этап 25, модуль М10): статус, ответственный, срок с причиной и приоритет сразу у нескольких
// задач. По каждой задаче сервер проверяет те же права и правила, что и поодиночке, и возвращает, что не прошло

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { addDays, formatLong, type IsoDate } from "@/domain/dates";
import { PRIORITIES, STATUSES, statusOf, type PriorityCode, type StatusCode } from "@/domain/dictionaries";
import { statusNeedsNote } from "@/lib/tasks/rules";
import type { Owner, Task } from "@/domain/types";
import type { BulkChange } from "@/lib/tasks/service";
import { bulkChangeAction } from "@/app/(app)/tasks/actions";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextArea } from "@/components/ui/primitives";
import { DueField, PersonSelect } from "@/components/requests/request-parts";
import { FormError } from "@/components/ui/field";
import type { Selection } from "./task-list";

export function useBulkSelection(visible: Task[]): Selection {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Задача ушла из списка (сменили фильтр, закрыли): выбор с неё снимается
  const visibleNumbers = useMemo(() => new Set(visible.map((t) => t.number)), [visible]);
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((n) => visibleNumbers.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleNumbers]);
  return {
    selected,
    toggle: (n) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(n)) next.delete(n);
        else next.add(n);
        return next;
      }),
    toggleMany: (ns, on) =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const n of ns) if (on) next.add(n);
        else next.delete(n);
        return next;
      }),
    clear: () => setSelected(new Set()),
  };
}

type Kind = "status" | "owner" | "due" | "priority";

export function BulkBar({ selection, tasks }: { selection: Selection; tasks: Task[] }) {
  const { data, applyTasks, notify, manage, leads, teamPeople } = usePrototype();
  const router = useRouter();
  const [kind, setKind] = useState<Kind | null>(null);
  const [status, setStatus] = useState<StatusCode>("in-progress");
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState<Owner | "">(teamPeople[0]?.slug ?? "");
  const [due, setDue] = useState<IsoDate>(addDays(data.today, 7));
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<PriorityCode>("high");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<{ done: number; failed: { number: number; error: string }[] } | null>(null);
  const count = selection.selected.size;
  if (!count && !report) return null;
  const numbers = [...selection.selected];
  const picked = tasks.filter((t) => selection.selected.has(t.number));

  const openKind = (k: Kind) => {
    setError(null);
    setNote("");
    setReason("");
    setKind(k);
  };

  const run = async () => {
    const change: BulkChange | null =
      kind === "status"
        ? { kind: "status", next: status, note: note.trim() || undefined }
        : kind === "owner"
          ? owner
            ? { kind: "owner", owner }
            : null
          : kind === "due"
            ? { kind: "due", to: due, reason: reason.trim() }
            : kind === "priority"
              ? { kind: "priority", next: priority }
              : null;
    if (!change) return setError(kind === "owner" ? "Выберите человека" : null);
    if (change.kind === "status" && statusNeedsNote(change.next) && !change.note) return setError(statusNeedsNote(change.next) === "reason" ? "Нужна причина: она запишется в каждую задачу" : "Нужен итог: он запишется в каждую задачу");
    if (change.kind === "due" && !change.reason) return setError("Нужна причина переноса");
    setBusy(true);
    setError(null);
    try {
      const r = await bulkChangeAction(numbers, change);
      if (!r.ok) return setError(r.error);
      applyTasks(r.value.done);
      setKind(null);
      selection.clear();
      setReport({ done: r.value.done.length, failed: r.value.failed });
      notify(r.value.failed.length ? `Изменено задач: ${r.value.done.length}, не прошло: ${r.value.failed.length}` : `Изменено задач: ${r.value.done.length}`, r.value.failed.length && !r.value.done.length ? "error" : undefined);
      router.refresh();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  };

  const statuses = STATUSES.filter((s) => s.code !== "proposed");

  return (
    <>
      {count ? (
        <div role="region" aria-label="Выбранные задачи" className="fixed inset-x-0 bottom-16 z-20 px-3 lg:bottom-4 lg:left-[248px]">
          <div className="mx-auto flex max-w-page flex-wrap items-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-small text-white shadow-modal">
            <span className="mr-1 font-semibold">Выбрано: {count}</span>
            <Button size="sm" variant="secondary" onClick={() => openKind("status")}>Статус</Button>
            {manage || leads.length ? <Button size="sm" variant="secondary" onClick={() => openKind("owner")}>Ответственный</Button> : null}
            <Button size="sm" variant="secondary" onClick={() => openKind("due")}>Срок</Button>
            <Button size="sm" variant="secondary" onClick={() => openKind("priority")}>Приоритет</Button>
            <button type="button" onClick={selection.clear} className="ml-auto inline-flex h-9 items-center gap-1 rounded-md px-2 text-white/80 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" aria-hidden="true" />
              Снять выделение
            </button>
          </div>
        </div>
      ) : null}

      <Modal open={kind !== null} onOpenChange={(o) => !o && setKind(null)} title={kind === "status" ? `Статус у ${count} задач` : kind === "owner" ? `Ответственный у ${count} задач` : kind === "due" ? `Срок у ${count} задач` : `Приоритет у ${count} задач`} description="Изменение пройдёт по каждой задаче с её правами и правилами. Задачи, где нельзя, останутся как были, вы увидите список">
        <div className="flex flex-col gap-4">
          <p className="max-h-24 overflow-y-auto rounded-lg bg-surface px-3 py-2 text-caption text-muted">{picked.map((t) => `${t.number} ${t.title}`).join("; ")}</p>
          {kind === "status" ? (
            <>
              <SelectField label="Новый статус" id="bulk-status" value={status} onChange={(e) => setStatus(e.target.value as StatusCode)} options={statuses.map((s) => ({ value: s.code, label: s.label }))} />
              {statusNeedsNote(status) ? <TextArea label={statusNeedsNote(status) === "reason" ? "Причина, одна на все" : statusNeedsNote(status) === "partial" ? "Что сделано и что нет, одно на все" : "Итог, один на все"} id="bulk-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} hint={`Статус «${statusOf(status).label}» требует текста. Он запишется в каждую выбранную задачу`} /> : null}
            </>
          ) : null}
          {kind === "owner" ? <PersonSelect id="bulk-owner" label="Новый ответственный" value={owner} onChange={(v) => setOwner(v)} exclude={"" as never} only={teamPeople.map((x) => x.slug)} /> : null}
          {kind === "due" ? (
            <>
              <DueField id="bulk-due" label="Новый срок" value={due} onChange={setDue} today={data.today} />
              <TextArea label="Причина переноса, одна на все" id="bulk-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} hint={`Запишется в историю переносов каждой задачи. Новый срок ${formatLong(due)}`} />
            </>
          ) : null}
          {kind === "priority" ? <SelectField label="Новый приоритет" id="bulk-priority" value={priority} onChange={(e) => setPriority(e.target.value as PriorityCode)} options={PRIORITIES.map((p) => ({ value: p.code, label: p.label }))} /> : null}
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setKind(null)}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void run()} disabled={busy}>
              {busy ? "Меняю…" : `Изменить у ${count}`}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!report && report.failed.length > 0} onOpenChange={(o) => !o && setReport(null)} title="Часть задач не изменилась" description={report ? `Изменено: ${report.done}. Не прошло: ${report.failed.length}. Причина у каждой ниже` : undefined}>
        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto text-small">
          {report?.failed.map((f) => (
            <li key={f.number} className="rounded-lg bg-surface px-3 py-2">
              <span className="font-medium tabular-nums text-ink">Задача {f.number}:</span> <span className="text-ink">{f.error}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={() => setReport(null)}>
            Понятно
          </Button>
        </div>
      </Modal>
    </>
  );
}
