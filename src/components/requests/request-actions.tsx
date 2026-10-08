"use client";

// Кнопки просьбы (этап 21): адресат принимает со сроком, отклоняет с причиной, отмечает выполненной или делает
// своей задачей; автор напоминает и отзывает. Кнопки видны только тем, кому действие доступно.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck, ListPlus, Undo2, X } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { addDays, formatShort } from "@/domain/dates";
import { dictOptions } from "@/domain/dictionaries";
import type { RequestView } from "@/domain/requests";
import type { Result } from "@/lib/action-runner";
import {
  acceptRequestAction,
  completeRequestAction,
  declineRequestAction,
  remindRequestAction,
  requestToTaskAction,
  withdrawRequestAction,
} from "@/app/(app)/requests/actions";
import { Modal } from "@/components/ui/overlays";
import { SelectField, TextArea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { DueField } from "./request-parts";
import { REQUESTS_CHANGED } from "./request-dialog";

type Dialog = "accept" | "decline" | "done" | "task" | "withdraw" | null;

export function RequestActions({ request, size = "sm", onChanged }: { request: RequestView; size?: "sm" | "md"; onChanged?: (r: RequestView) => void }) {
  const { data, notify, me } = usePrototype();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [due, setDue] = useState(request.acceptedDue ?? (request.due >= data.today ? request.due : addDays(data.today, 1)));
  const [text, setText] = useState("");
  const [direction, setDirection] = useState<string>(me.direction);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const can = request.can;
  const n = request.number;
  const quickDue = request.due >= data.today ? request.due : addDays(data.today, 1);

  const open = (d: Dialog) => {
    setError(null);
    setText("");
    setDue(request.acceptedDue ?? (request.due >= data.today ? request.due : addDays(data.today, 1)));
    setDialog(d);
  };

  async function run<T>(fn: () => Promise<Result<T>>, ok: (v: T) => string, view: (v: T) => RequestView) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) {
        if (dialog) setError(r.error);
        else notify(r.error, "error");
        return;
      }
      setDialog(null);
      notify(ok(r.value));
      onChanged?.(view(r.value));
      window.dispatchEvent(new Event(REQUESTS_CHANGED));
      router.refresh();
    } catch {
      const message = "Нет связи с сервером: ответ не сохранился";
      if (dialog) setError(message);
      else notify(message, "error");
    } finally {
      setBusy(false);
    }
  }
  const same = (v: RequestView) => v;

  if (!Object.values(can).some(Boolean)) return null;
  const accepted = request.status === "accepted";
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {can.accept && !accepted ? (
          // Одним нажатием к сроку автора (этап 26): из уведомления на телефоне это второе нажатие. Свой срок: «Другой срок»
          <Button size={size} disabled={busy} onClick={() => void run(() => acceptRequestAction(n, quickDue), () => `Просьба принята, срок ${formatShort(quickDue)}`, same)}>
            <Check className="h-4 w-4" aria-hidden="true" />
            Принять к {formatShort(quickDue)}
          </Button>
        ) : null}
        {can.accept ? (
          <Button size={size} variant={accepted ? "secondary" : "ghost"} onClick={() => open("accept")}>
            {accepted ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
            {accepted ? "Изменить срок" : "Другой срок"}
          </Button>
        ) : null}
        {can.done ? (
          <Button size={size} variant={accepted ? "primary" : "secondary"} onClick={() => open("done")}>
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Выполнено
          </Button>
        ) : null}
        {can.toTask ? (
          <Button size={size} variant="secondary" onClick={() => open("task")}>
            <ListPlus className="h-4 w-4" aria-hidden="true" />
            Сделать задачей
          </Button>
        ) : null}
        {can.decline ? (
          <Button size={size} variant="ghost" onClick={() => open("decline")}>
            <X className="h-4 w-4" aria-hidden="true" />
            Отклонить
          </Button>
        ) : null}
        {can.remind ? (
          <Button size={size} variant="secondary" disabled={busy} onClick={() => void run(() => remindRequestAction(n), () => "Напоминание ушло", same)}>
            <Bell className="h-4 w-4" aria-hidden="true" />
            Напомнить
          </Button>
        ) : null}
        {can.withdraw ? (
          <Button size={size} variant="ghost" onClick={() => open("withdraw")}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            Отозвать
          </Button>
        ) : null}
      </div>

      <Modal open={dialog === "accept"} onOpenChange={(o) => !o && setDialog(null)} title={accepted ? `Новый срок по просьбе ${n}` : `Принять просьбу ${n}`} description="Автор увидит срок в «Жду от коллег». Если срок пройдёт, просьба попадёт на встречу.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => acceptRequestAction(n, due), () => (accepted ? "Срок изменён" : "Просьба принята"), same);
          }}
        >
          <DueField id={`rq-accept-${n}`} label="Сделаю к" value={due} onChange={setDue} today={data.today} />
          <FormError message={error ?? undefined} />
          <Footer busy={busy} onCancel={() => setDialog(null)} submit={accepted ? "Сохранить срок" : "Принять"} />
        </form>
      </Modal>

      <Modal open={dialog === "decline"} onOpenChange={(o) => !o && setDialog(null)} title={`Отклонить просьбу ${n}`} description="Причину увидит автор. Напишите, к кому лучше обратиться, если знаете.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => declineRequestAction(n, text), () => "Просьба отклонена", same);
          }}
        >
          <TextArea label="Причина" id={`rq-decline-${n}`} value={text} onChange={(e) => setText(e.target.value)} counter={{ value: text.length, max: 500 }} />
          <FormError message={error ?? undefined} />
          <Footer busy={busy} onCancel={() => setDialog(null)} submit="Отклонить" danger />
        </form>
      </Modal>

      <Modal open={dialog === "done"} onOpenChange={(o) => !o && setDialog(null)} title={`Просьба ${n} выполнена`} description="Автор получит событие в «Мне». Итог можно не писать.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => completeRequestAction(n, text.trim() ? text : null), () => "Просьба выполнена", same);
          }}
        >
          <TextArea label="Итог или ссылка на результат" id={`rq-done-${n}`} value={text} onChange={(e) => setText(e.target.value)} counter={{ value: text.length, max: 500 }} />
          <FormError message={error ?? undefined} />
          <Footer busy={busy} onCancel={() => setDialog(null)} submit="Выполнено" />
        </form>
      </Modal>

      <Modal open={dialog === "task"} onOpenChange={(o) => !o && setDialog(null)} title={`Задача из просьбы ${n}`} description="Задача встанет на вас в вашей команде со сроком просьбы. Когда вы её выполните, просьба закроется сама.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => requestToTaskAction(n, request.task ? null : direction),
              (v) => `Задача ${v.task} поставлена`,
              (v) => v.request,
            );
          }}
        >
          {request.task ? (
            <p className="text-small text-muted">Направление возьмём из задачи {request.task.number}.</p>
          ) : (
            <SelectField label="Направление" id={`rq-dir-${n}`} value={direction} onChange={(e) => setDirection(e.target.value)} options={dictOptions("DIRECTION", direction)} />
          )}
          <FormError message={error ?? undefined} />
          <Footer busy={busy} onCancel={() => setDialog(null)} submit="Сделать задачей" />
        </form>
      </Modal>

      <Modal open={dialog === "withdraw"} onOpenChange={(o) => !o && setDialog(null)} title={`Отозвать просьбу ${n}?`} description="Адресат узнает, что делать не нужно. Вернуть просьбу нельзя, можно попросить заново.">
        <FormError message={error ?? undefined} />
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Не отзывать
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void run(() => withdrawRequestAction(n), () => "Просьба отозвана", same)}>
            Отозвать
          </Button>
        </div>
      </Modal>
    </>
  );
}

function Footer({ busy, onCancel, submit, danger }: { busy: boolean; onCancel: () => void; submit: string; danger?: boolean }) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <Button type="button" variant="secondary" onClick={onCancel}>
        Отмена
      </Button>
      <Button type="submit" variant={danger ? "danger" : "primary"} disabled={busy}>
        {busy ? "Сохраняем" : submit}
      </Button>
    </div>
  );
}
