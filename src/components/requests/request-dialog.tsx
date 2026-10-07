"use client";

// «Попросить коллегу» (этап 21): одно окно на всё приложение. Открывается из карточки задачи, из «Мне»,
// с «Моей недели», из записи weekly. Просьба к задаче или записи несёт ссылку на них.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HandHelping } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { addDays } from "@/domain/dates";
import type { PersonSlug } from "@/domain/types";
import { createRequestAction } from "@/app/(app)/requests/actions";
import { Modal } from "@/components/ui/overlays";
import { TextArea } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { DueField, PersonSelect } from "./request-parts";

const OPEN_EVENT = "weekly:new-request";
/** Просьбы поменялись: блоки, которые грузят просьбы сами (карточка задачи), перечитывают их */
export const REQUESTS_CHANGED = "weekly:requests-changed";
const MAX = 500;

export type RequestPrefill = { to?: PersonSlug; text?: string; task?: { number: number; title: string }; entry?: { id: string; what: string } };

export function openRequest(prefill?: RequestPrefill) {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: prefill }));
}

export function AskColleagueButton({ size = "md", variant = "secondary", prefill, label = "Попросить коллегу" }: { size?: "md" | "sm"; variant?: "primary" | "secondary" | "ghost"; prefill?: RequestPrefill; label?: string }) {
  const { observer } = usePrototype();
  if (observer) return null;
  return (
    <Button size={size} variant={variant} onClick={() => openRequest(prefill)}>
      <HandHelping className="h-4 w-4" aria-hidden="true" />
      {label}
    </Button>
  );
}

/** Окно просьбы: живёт один раз в оболочке приложения */
export function RequestDialogHost() {
  const { data, me, notify } = usePrototype();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<string>("");
  const [text, setText] = useState("");
  const [due, setDue] = useState(addDays(data.today, 3));
  const [task, setTask] = useState<RequestPrefill["task"]>();
  const [entry, setEntry] = useState<RequestPrefill["entry"]>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = ((e as CustomEvent).detail ?? {}) as RequestPrefill;
      setTo(detail.to ?? "");
      setText(detail.text ?? "");
      setDue(addDays(data.today, 3));
      setTask(detail.task);
      setEntry(detail.entry);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [data.today]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to) return setError("Выберите, кого просите");
    if (!text.trim()) return setError("Напишите, что нужно");
    setBusy(true);
    setError(null);
    try {
      const r = await createRequestAction({ to, text, due, task: task?.number ?? null, entry: entry?.id ?? null });
      if (!r.ok) return setError(r.error);
      setOpen(false);
      window.dispatchEvent(new Event(REQUESTS_CHANGED));
      notify(`Просьба ${r.value.number} ушла. Ответ придёт в «Мне»`);
      router.refresh();
    } catch {
      setError("Нет связи с сервером: просьба не ушла");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={setOpen} title="Попросить коллегу" description="Адресат увидит просьбу в «Мне», примет её со сроком или ответит отказом. Следить за ответом можно в блоке «Жду от коллег».">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {task ? (
          <p className="rounded-lg bg-field px-3.5 py-2.5 text-small text-ink">
            К задаче <span className="tabular-nums text-muted">{task.number}</span> {task.title}
          </p>
        ) : null}
        {entry ? <p className="rounded-lg bg-field px-3.5 py-2.5 text-small text-ink">К записи weekly: {entry.what}</p> : null}
        <PersonSelect id="rq-to" label="Кого просите" value={to} onChange={setTo} exclude={me.slug} />
        <TextArea
          label="Что нужно"
          id="rq-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          counter={{ value: text.length, max: MAX }}
          hint="Одна-две фразы: что именно и в каком виде. Например: данные по трафику КАСКО за сентябрь в таблице"
        />
        <DueField id="rq-due" label="К какому сроку" value={due} onChange={setDue} today={data.today} />
        <FormError message={error ?? undefined} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Отправляем" : "Попросить"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
