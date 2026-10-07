"use client";

// Связи задачи в карточке (этап 21, модуль М5): какие задачи эта ждёт и какие ждут её. Срок той, что ждём, позже
// срока этой: пометка. Передать задачу другому с комментарием.

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Link2, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { formatShort } from "@/domain/dates";
import { statusOf } from "@/domain/dictionaries";
import type { PersonSlug, Task } from "@/domain/types";
import { addDependencyAction, handOverAction, removeDependencyAction, taskLinksAction } from "@/app/(app)/tasks/actions";
import type { TaskLinkView } from "@/lib/tasks/service";
import { Modal } from "@/components/ui/overlays";
import { TextArea, TextInput } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { PersonSelect } from "@/components/requests/request-parts";
import { cn } from "@/lib/cn";
import { useTaskPermissions } from "./task-fields";
import { teamOf, teamPeople } from "@/domain/teams";

/** Люди команды задачи: им ответственный может передать задачу. Нет данных о команде: выбор не сужаем */
function teamPeopleOf(id: string): PersonSlug[] | undefined {
  const team = teamOf(id);
  return team ? teamPeople(team) : undefined;
}

type Links = { waitsFor: TaskLinkView[]; blocks: TaskLinkView[]; canEdit: boolean };

function LinkRow({ t, onRemove, kind }: { t: TaskLinkView; onRemove?: () => void; kind: "waits" | "blocks" }) {
  const closed = t.status === "done" || t.status === "failed" || t.status === "cancelled";
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        {t.title ? (
          <Link href={`/tasks/${t.number}`} className={cn("text-small font-medium hover:underline", closed ? "text-muted" : "text-ink hover:text-blue-700")}>
            <span className="tabular-nums text-muted">{t.number}</span> {t.title}
          </Link>
        ) : (
          <p className="text-small text-muted">
            <span className="tabular-nums">{t.number}</span> задача другой команды
          </p>
        )}
        <p className="text-caption text-muted">
          {statusOf(t.status).label}, срок {formatShort(t.due)}
          {t.owner ? `, ${compactName(t.owner)}` : ""}
          {t.late ? (
            <span className="font-semibold text-danger-ink">
              {kind === "waits" ? ". Её срок позже срока этой задачи" : ". Её срок раньше срока этой задачи"}
            </span>
          ) : null}
        </p>
      </div>
      {onRemove ? (
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Снять связь с задачей ${t.number}`}>
          <X className="h-4 w-4" aria-hidden="true" />
          Снять
        </Button>
      ) : null}
    </li>
  );
}

export function TaskWaits({ task, headingLevel = "h3" }: { task: Task; headingLevel?: "h2" | "h3" }) {
  const { applyTaskResult, notify } = usePrototype();
  const [links, setLinks] = useState<Links | null>(null);
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const waitsKey = (task.waitsFor ?? []).map((w) => `${w.number}:${w.due}:${w.closed}`).join("|");
  useEffect(() => {
    let alive = true;
    taskLinksAction(task.number)
      .then((r) => alive && r.ok && setLinks(r.value))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // Дата «обновлена» в днях: перечитываем по самим связям, сроку, статусу и ответственному
  }, [task.number, task.updatedAt, task.due, task.status, task.owner, waitsKey]);
  if (!links) return null;
  const H = headingLevel;
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(number.replace(/\D/g, ""));
    if (!n) return setError("Укажите номер задачи");
    setBusy(true);
    setError(null);
    try {
      const r = await addDependencyAction(task.number, n);
      if (!r.ok) return setError(r.error);
      applyTaskResult(r, `Задача ${task.number} ждёт задачу ${n}`);
      setAdding(false);
      setNumber("");
    } catch {
      setError("Нет связи с сервером: связь не сохранилась");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (n: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await removeDependencyAction(task.number, n);
      if (!r.ok) return notify(r.error, "error");
      applyTaskResult(r, `Связь с задачей ${n} снята`);
    } catch {
      notify("Нет связи с сервером: связь не снялась", "error");
    } finally {
      setBusy(false);
    }
  };
  if (!links.waitsFor.length && !links.blocks.length && !links.canEdit) return null;
  return (
    <section aria-labelledby={`waits-${task.number}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H id={`waits-${task.number}`} className="text-sm font-medium text-ink">
          Связи с задачами
        </H>
        {links.canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setNumber("");
              setError(null);
              setAdding(true);
            }}
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
            Ждёт задачу
          </Button>
        ) : null}
      </div>
      {links.waitsFor.length ? (
        <div>
          <p className="mb-1 text-caption text-muted">Эта задача ждёт</p>
          <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
            {links.waitsFor.map((t) => (
              <LinkRow key={t.number} t={t} kind="waits" onRemove={links.canEdit ? () => void remove(t.number) : undefined} />
            ))}
          </ul>
        </div>
      ) : null}
      {links.blocks.length ? (
        <div>
          <p className="mb-1 text-caption text-muted">Эту задачу ждут</p>
          <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
            {links.blocks.map((t) => (
              <LinkRow key={t.number} t={t} kind="blocks" />
            ))}
          </ul>
        </div>
      ) : null}
      {!links.waitsFor.length && !links.blocks.length ? <p className="text-small text-muted">Если задача не может двигаться без другой, свяжите их: при переносе срока той задачи вы узнаете об этом.</p> : null}

      <Modal open={adding} onOpenChange={setAdding} title={`Задача ${task.number} ждёт задачу`} description="Ответственный за ту задачу узнает, что её ждут. Перенос её срока позже вашего придёт вам в «Мне».">
        <form onSubmit={add} className="flex flex-col gap-4">
          <TextInput label="Номер задачи" id={`dep-${task.number}`} inputMode="numeric" value={number} onChange={(e) => setNumber(e.target.value)} autoFocus />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Сохраняем" : "Связать"}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

/** «Передать» (этап 21): новый ответственный и комментарий, прежний остаётся соисполнителем */
export function HandOverButton({ task }: { task: Task }) {
  const { applyTaskResult, me, manage, limited } = usePrototype();
  const can = useTaskPermissions(task);
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string>("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // По общему логину передать нельзя (сервер откажет): кнопку не показываем
  if (!can.handover || limited) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to) return setError("Выберите, кому передать");
    if (!comment.trim()) return setError("Напишите, почему передаёте");
    setBusy(true);
    setError(null);
    try {
      const r = await handOverAction(task.number, to, comment);
      if (!r.ok) return setError(r.error);
      applyTaskResult(r, `Задача ${task.number} передана: ${compactName(to as PersonSlug)}`);
      setOpen(false);
    } catch {
      setError("Нет связи с сервером: задача не передана");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setTo("");
          setComment("");
          setError(null);
          setOpen(true);
        }}
      >
        <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
        Передать
      </Button>
      <Modal open={open} onOpenChange={setOpen} title={`Передать задачу ${task.number}`} description="Новый ответственный получит задачу в «Мне» с вашим комментарием. Прежний ответственный останется соисполнителем.">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <PersonSelect
            id={`ho-${task.number}`}
            label="Кому передать"
            value={to}
            onChange={setTo}
            exclude={(task.owner === "all" ? me.slug : task.owner) as PersonSlug}
            only={manage ? undefined : teamPeopleOf(task.team)}
          />
          <TextArea label="Почему передаёте" id={`ho-why-${task.number}`} value={comment} onChange={(e) => setComment(e.target.value)} counter={{ value: comment.length, max: 500 }} />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Передаём" : "Передать"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
